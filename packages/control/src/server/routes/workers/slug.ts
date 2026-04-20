import { Hono } from "hono";
import { z } from "zod";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { BadRequestError } from "takos-common/errors";
import { zValidator } from "../zod-validator.ts";
import {
  getServiceForUserWithRole,
  slugifyServiceName,
} from "../../../application/services/platform/workers.ts";
import {
  buildManagedSlug,
  parseManagedServiceConfig,
} from "../../../application/services/entities/group-managed-services.ts";
import { getDb } from "../../../infra/db/index.ts";
import { and, eq, ne, or } from "drizzle-orm";
import { services } from "../../../infra/db/schema-services.ts";
import {
  deleteHostnameRouting,
  resolveHostnameRouting,
  upsertHostnameRouting,
} from "../../../application/services/routing/service.ts";
import {
  getGroupAutoHostname,
  getGroupCustomSlugHostname,
} from "../../../application/services/routing/group-hostnames.ts";
import type { RoutingTarget } from "../../../application/services/routing/routing-models.ts";
import { ServiceDesiredStateService } from "../../../application/services/platform/worker-desired-state.ts";
import { logError } from "../../../shared/utils/logger.ts";
import {
  ConflictError,
  InternalError,
  NotFoundError,
} from "takos-common/errors";

function applyCustomSlugToConfig(
  configJson: string | null,
  customSlug: string | null,
): string {
  const config = parseManagedServiceConfig(configJson);
  if (customSlug) {
    return JSON.stringify({ ...config, customSlug });
  }
  const { customSlug: _customSlug, ...rest } = config;
  return JSON.stringify(rest);
}

function managedDefaultSlug(
  groupId: string,
  configJson: string | null,
): string | null {
  const config = parseManagedServiceConfig(configJson);
  if (!config.managedBy || !config.manifestName || !config.componentKind) {
    return null;
  }
  return buildManagedSlug(
    groupId,
    config.envName ?? "default",
    config.componentKind,
    config.manifestName,
  );
}

const workersSlug = new Hono<AuthenticatedRouteEnv>()
  .patch(
    "/:id/slug",
    zValidator(
      "json",
      z.object({
        slug: z.string(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const workerId = c.req.param("id");
      const body = c.req.valid("json");

      if (!body.slug) {
        throw new BadRequestError("slug is required");
      }

      const newSlug = slugifyServiceName(body.slug);
      if (newSlug.length < 3 || newSlug.length > 32) {
        throw new BadRequestError("Slug must be between 3 and 32 characters");
      }

      const reserved = [
        "admin",
        "api",
        "www",
        "mail",
        "smtp",
        "pop",
        "imap",
        "ftp",
        "app",
        "apps",
      ];
      if (reserved.includes(newSlug)) {
        throw new BadRequestError("This subdomain is reserved");
      }

      const worker = await getServiceForUserWithRole(
        c.env.DB,
        workerId,
        user.id,
        ["owner", "admin", "editor"],
      );

      if (!worker) {
        throw new NotFoundError("Service");
      }

      const db = getDb(c.env.DB);
      const desiredState = new ServiceDesiredStateService(c.env);
      const platformDomain = c.env.TENANT_BASE_DOMAIN?.trim()
        .replace(/^\.+/, "")
        .toLowerCase();
      if (!platformDomain) {
        throw new BadRequestError("TENANT_BASE_DOMAIN is not configured");
      }
      const newHostname = `${newSlug}.${platformDomain}`;

      const serviceRecord = await db.select({
        groupId: services.groupId,
        config: services.config,
      })
        .from(services)
        .where(eq(services.id, workerId))
        .get() ?? null;
      const groupId = serviceRecord?.groupId ?? null;
      const isGroupManaged = Boolean(groupId);

      const oldHostname = worker.hostname;
      const groupAutoHostname = groupId
        ? await getGroupAutoHostname(c.env, {
          groupId,
          spaceId: worker.space_id,
        })
        : null;
      const previousGroupCustomSlug = groupId
        ? await getGroupCustomSlugHostname(c.env, groupId)
        : null;
      const oldCustomHostname = isGroupManaged
        ? previousGroupCustomSlug?.hostname ?? null
        : worker.slug
        ? `${worker.slug}.${platformDomain}`
        : null;
      const existing = await db.select({
        id: services.id,
        groupId: services.groupId,
      })
        .from(services)
        .where(and(
          or(
            eq(services.slug, newSlug),
            eq(services.hostname, newHostname),
          ),
          ne(services.id, workerId),
        ))
        .get() ?? null;

      if (
        existing &&
        (
          !isGroupManaged || existing.groupId !== groupId ||
          existing.id !== previousGroupCustomSlug?.sourceServiceId
        )
      ) {
        throw new ConflictError("Slug or hostname already taken");
      }

      let oldRoutingTarget: RoutingTarget | null = null;
      let oldCustomRoutingTarget: RoutingTarget | null = null;
      let groupServiceSnapshots: Array<{
        id: string;
        slug: string | null;
        config: string | null;
        hostname: string | null;
      }> = [];

      try {
        const oldPrimaryHostname = isGroupManaged
          ? groupAutoHostname
          : oldHostname;
        if (oldPrimaryHostname) {
          const resolved = await resolveHostnameRouting({
            env: c.env,
            hostname: oldPrimaryHostname,
            executionCtx: c.executionCtx,
          });
          oldRoutingTarget = resolved.tombstone ? null : resolved.target;
          if (!isGroupManaged) {
            await deleteHostnameRouting({
              env: c.env,
              hostname: oldPrimaryHostname,
              executionCtx: c.executionCtx,
            });
          }
        }

        if (
          isGroupManaged && oldHostname &&
          oldHostname !== groupAutoHostname &&
          oldHostname !== oldCustomHostname
        ) {
          await deleteHostnameRouting({
            env: c.env,
            hostname: oldHostname,
            executionCtx: c.executionCtx,
          });
        }

        if (
          isGroupManaged && oldCustomHostname &&
          oldCustomHostname !== oldPrimaryHostname &&
          oldCustomHostname !== newHostname
        ) {
          const resolved = await resolveHostnameRouting({
            env: c.env,
            hostname: oldCustomHostname,
            executionCtx: c.executionCtx,
          });
          oldCustomRoutingTarget = resolved.tombstone ? null : resolved.target;
          await deleteHostnameRouting({
            env: c.env,
            hostname: oldCustomHostname,
            executionCtx: c.executionCtx,
          });
        }

        const now = new Date().toISOString();
        if (isGroupManaged && groupId) {
          const groupServices = await db.select({
            id: services.id,
            config: services.config,
            slug: services.slug,
            hostname: services.hostname,
          })
            .from(services)
            .where(eq(services.groupId, groupId))
            .all();
          groupServiceSnapshots = groupServices;
          for (const row of groupServices) {
            if (row.id === workerId) continue;
            const defaultSlug = managedDefaultSlug(groupId, row.config);
            await db.update(services)
              .set({
                slug: defaultSlug,
                config: applyCustomSlugToConfig(row.config, null),
                updatedAt: now,
              })
              .where(eq(services.id, row.id))
              .run();
          }
          const current = groupServices.find((row) => row.id === workerId);
          await db.update(services)
            .set({
              slug: newSlug,
              config: applyCustomSlugToConfig(
                current?.config ?? serviceRecord?.config ?? null,
                newSlug,
              ),
              hostname: oldHostname === groupAutoHostname ? oldHostname : null,
              updatedAt: now,
            })
            .where(eq(services.id, workerId))
            .run();
        } else {
          await db.update(services)
            .set({
              slug: newSlug,
              hostname: newHostname,
              updatedAt: now,
            })
            .where(eq(services.id, workerId))
            .run();
        }

        const fallbackTarget = oldCustomRoutingTarget ?? oldRoutingTarget ??
          await desiredState.getRoutingTarget(worker.id);
        if (fallbackTarget) {
          try {
            await upsertHostnameRouting({
              env: c.env,
              hostname: newHostname,
              target: fallbackTarget,
              executionCtx: c.executionCtx,
            });
          } catch (kvError) {
            logError("KV put failed, rolling back DB", kvError, {
              module: "routes/services/slug",
            });
            await db.update(services)
              .set({
                slug: worker.slug,
                ...(isGroupManaged
                  ? {
                    config: serviceRecord?.config ?? null,
                    hostname: oldHostname,
                  }
                  : { hostname: oldHostname }),
                updatedAt: new Date().toISOString(),
              })
              .where(eq(services.id, workerId))
              .run();
            if (isGroupManaged && groupServiceSnapshots.length > 0) {
              for (const row of groupServiceSnapshots) {
                await db.update(services)
                  .set({
                    slug: row.slug,
                    config: row.config,
                    hostname: row.hostname,
                    updatedAt: new Date().toISOString(),
                  })
                  .where(eq(services.id, row.id))
                  .run();
              }
            }
            if (!isGroupManaged && oldHostname) {
              await upsertHostnameRouting({
                env: c.env,
                hostname: oldHostname,
                target: oldRoutingTarget ?? fallbackTarget,
                executionCtx: c.executionCtx,
              });
            }
            if (isGroupManaged && oldCustomHostname && oldCustomRoutingTarget) {
              await upsertHostnameRouting({
                env: c.env,
                hostname: oldCustomHostname,
                target: oldCustomRoutingTarget,
                executionCtx: c.executionCtx,
              });
            }
            throw kvError;
          }
        }

        return c.json({
          success: true,
          slug: newSlug,
          hostname: isGroupManaged ? groupAutoHostname : newHostname,
          custom_hostname: isGroupManaged ? newHostname : undefined,
        });
      } catch (err) {
        if (!isGroupManaged && oldHostname) {
          try {
            const fallbackTarget = oldRoutingTarget ??
              await desiredState.getRoutingTarget(worker.id);
            if (!fallbackTarget) {
              throw new Error("No active deployment routing target available");
            }
            await upsertHostnameRouting({
              env: c.env,
              hostname: oldHostname,
              target: oldRoutingTarget ?? fallbackTarget,
              executionCtx: c.executionCtx,
            });
          } catch (restoreErr) {
            logError("Failed to restore old hostname routing", restoreErr, {
              module: "routes/services/slug",
            });
          }
        }
        if (isGroupManaged && oldCustomHostname && oldCustomRoutingTarget) {
          try {
            await upsertHostnameRouting({
              env: c.env,
              hostname: oldCustomHostname,
              target: oldCustomRoutingTarget,
              executionCtx: c.executionCtx,
            });
          } catch (restoreErr) {
            logError(
              "Failed to restore old custom hostname routing",
              restoreErr,
              {
                module: "routes/services/slug",
              },
            );
          }
        }
        logError("Failed to update slug", err, {
          module: "routes/services/slug",
        });
        throw new InternalError("Failed to update slug");
      }
    },
  );

export default workersSlug;
