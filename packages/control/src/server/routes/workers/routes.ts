import { Hono } from "hono";
import { z } from "zod";
import { requireSpaceAccess } from "../route-auth.ts";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import { parsePagination } from "../../../shared/utils/index.ts";
import { zValidator } from "../zod-validator.ts";
import {
  countServicesInSpace,
  createService,
  deleteService,
  getServiceForUser,
  getServiceForUserWithRole,
  listServicesForSpace,
  listServicesForUser,
  WORKSPACE_SERVICE_LIMITS,
} from "../../../application/services/platform/workers.ts";
import { getDb } from "../../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import {
  deployments,
  groups,
  serviceCustomDomains,
  serviceDeployments,
  services,
} from "../../../infra/db/schema.ts";
import { deleteHostnameRouting } from "../../../application/services/routing/service.ts";
import { createCloudflareApiClient } from "../../../platform/providers/cloudflare/api-client.ts";
import { deleteCloudflareCustomHostname } from "../../../application/services/platform/custom-domains.ts";
import {
  createCommonEnvDeps,
  deleteServiceTakosAccessTokenConfig,
} from "../../../application/services/common-env/index.ts";
import { ServiceDesiredStateService } from "../../../application/services/platform/worker-desired-state.ts";
import { createOptionalCloudflareWfpProvider } from "../../../platform/providers/cloudflare/wfp.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { InternalError, NotFoundError } from "takos-common/errors";
import { parseDeploymentTargetConfig } from "../../../application/services/deployment/provider.ts";
import {
  removeGroupDesiredWorkload,
  upsertGroupDesiredWorkload,
} from "../../../application/services/deployment/group-desired-projector.ts";

function parseServiceConfig(config: string | null): Record<string, unknown> {
  if (!config) return {};
  try {
    return JSON.parse(config) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildProjectedWorkerSpec(input: {
  deploymentId?: string | null;
  artifactRef?: string | null;
}) {
  return {
    artifact: {
      kind: "bundle" as const,
      ...(input.deploymentId ? { deploymentId: input.deploymentId } : {}),
      ...(input.artifactRef ? { artifactRef: input.artifactRef } : {}),
    },
  };
}

function buildProjectedServiceSpec(
  config: Record<string, unknown>,
  deploymentTarget?: ReturnType<typeof parseDeploymentTargetConfig>,
) {
  const imageRef = deploymentTarget?.artifact?.image_ref ??
    (typeof config.imageRef === "string" ? config.imageRef : undefined);
  const provider = deploymentTarget?.artifact?.kind === "container-image" &&
      deploymentTarget?.artifact?.image_ref
    ? undefined
    : (config.provider === "oci" || config.provider === "ecs" ||
        config.provider === "cloud-run" || config.provider === "k8s"
      ? config.provider
      : undefined);
  const port = typeof deploymentTarget?.artifact?.exposed_port === "number"
    ? deploymentTarget.artifact.exposed_port
    : (typeof config.port === "number" ? config.port : 80);
  const healthPath = typeof deploymentTarget?.artifact?.health_path === "string"
    ? deploymentTarget.artifact.health_path
    : (typeof config.healthPath === "string" ? config.healthPath : undefined);

  return {
    port,
    ...(config.ipv4 === true ? { ipv4: true } : {}),
    ...(provider ? { provider } : {}),
    ...(imageRef
      ? {
        artifact: {
          kind: "image" as const,
          imageRef,
          ...(provider ? { provider } : {}),
        },
      }
      : {}),
    ...(healthPath
      ? { healthCheck: { path: healthPath, type: "http" as const } }
      : {}),
  };
}

/** Shape of a single invocation record from the Cloudflare GraphQL Analytics API */
interface CfInvocationRecord {
  datetime: string;
  status: string;
  cpuTime: number;
  responseStatus: number;
  clientRequestMethod: string;
  clientRequestPath: string;
}

/** Response shape from the Cloudflare GraphQL Analytics API */
interface CfGraphQLResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        workersInvocationsAdaptive?: CfInvocationRecord[];
      }>;
    };
  };
  errors?: Array<{ message: string }>;
}

const workersBase = new Hono<AuthenticatedRouteEnv>()
  .get("/", async (c) => {
    const user = c.get("user");

    const workersList = await listServicesForUser(c.env.DB, user.id);

    return c.json({ services: workersList });
  })
  .get("/space/:spaceId", async (c) => {
    const user = c.get("user");
    const spaceId = c.req.param("spaceId");

    const access = await requireSpaceAccess(c, spaceId, user.id);

    const workersList = await listServicesForSpace(c.env.DB, access.space.id);

    return c.json({ services: workersList });
  })
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        space_id: z.string().optional(),
        group_id: z.string().optional(),
        service_type: z.enum(["app", "service"]).optional(),
        slug: z.string().optional(),
        config: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");

      const spaceId = body.space_id || null;

      let resolvedSpaceId: string;
      if (spaceId) {
        const access = await requireSpaceAccess(
          c,
          spaceId,
          user.id,
          ["owner", "admin", "editor"],
          "Space not found or insufficient permissions",
        );
        resolvedSpaceId = access.space.id;
      } else {
        // Default to user's own account
        resolvedSpaceId = user.id;
      }

      const serviceType = body.service_type || "app";
      let groupId: string | null = null;
      if (body.group_id?.trim()) {
        const db = getDb(c.env.DB);
        const group = await db.select({
          id: groups.id,
          spaceId: groups.spaceId,
        })
          .from(groups)
          .where(eq(groups.id, body.group_id.trim()))
          .get();
        if (!group || group.spaceId !== resolvedSpaceId) {
          return c.json({
            error: "group_id must belong to the selected workspace",
          }, 400);
        }
        groupId = group.id;
      }

      const currentCount = await countServicesInSpace(
        c.env.DB,
        resolvedSpaceId,
      );
      if (currentCount >= WORKSPACE_SERVICE_LIMITS.maxServices) {
        return c.json({
          error:
            `Space has reached the maximum number of services (${WORKSPACE_SERVICE_LIMITS.maxServices})`,
        }, 429);
      }

      const platformDomain = c.env.TENANT_BASE_DOMAIN;

      const result = await createService(c.env.DB, {
        spaceId: resolvedSpaceId,
        groupId,
        workerType: serviceType,
        slug: body.slug,
        config: body.config || null,
        platformDomain,
      });
      if (!result.service) {
        throw new InternalError("Failed to create service");
      }

      if (groupId) {
        if (serviceType === "app") {
          await upsertGroupDesiredWorkload(c.env, {
            groupId,
            category: "worker",
            name: result.service.slug ?? result.service.id,
            workload: buildProjectedWorkerSpec({}),
          });
        } else {
          await upsertGroupDesiredWorkload(c.env, {
            groupId,
            category: "service",
            name: result.service.slug ?? result.service.id,
            workload: buildProjectedServiceSpec(
              parseServiceConfig(body.config ?? null),
            ) as never,
          });
        }
      }

      return c.json({ service: result.service }, 201);
    },
  )
  .get("/:id", async (c) => {
    const user = c.get("user");
    const workerId = c.req.param("id");

    const worker = await getServiceForUser(c.env.DB, workerId, user.id);
    if (!worker) {
      throw new NotFoundError("Service");
    }

    return c.json({ service: worker });
  })
  .patch(
    "/:id/group",
    zValidator(
      "json",
      z.object({
        group_id: z.string().nullable().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const workerId = c.req.param("id");
      const body = c.req.valid("json") as { group_id?: string | null };

      const worker = await getServiceForUserWithRole(
        c.env.DB,
        workerId,
        user.id,
        ["owner", "admin", "editor"],
      );
      if (!worker) {
        throw new NotFoundError("Service");
      }

      const nextGroupId = body.group_id?.trim() || null;
      const db = getDb(c.env.DB);
      if (nextGroupId) {
        const group = await db.select({
          id: groups.id,
          spaceId: groups.spaceId,
        })
          .from(groups)
          .where(eq(groups.id, nextGroupId))
          .get();
        if (!group || group.spaceId !== worker.space_id) {
          return c.json({
            error: "group_id must belong to the same workspace as the service",
          }, 400);
        }
      }

      await db.update(services)
        .set({
          groupId: nextGroupId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(services.id, worker.id))
        .run();

      if (nextGroupId) {
        const updatedService = await db.select({
          id: services.id,
          serviceType: services.serviceType,
          config: services.config,
          activeDeploymentId: services.activeDeploymentId,
        }).from(services)
          .where(eq(services.id, worker.id))
          .get();
        const activeDeployment = updatedService?.activeDeploymentId
          ? await db.select().from(deployments).where(
            eq(deployments.id, updatedService.activeDeploymentId),
          ).get()
          : null;
        if (updatedService?.serviceType === "app") {
          await upsertGroupDesiredWorkload(c.env, {
            groupId: nextGroupId,
            category: "worker",
            name: worker.slug ?? worker.id,
            workload: buildProjectedWorkerSpec({
              deploymentId: activeDeployment?.id ?? undefined,
              artifactRef: activeDeployment?.artifactRef ?? worker.service_name,
            }),
          });
        } else {
          const config = parseServiceConfig(updatedService?.config ?? null);
          await upsertGroupDesiredWorkload(c.env, {
            groupId: nextGroupId,
            category: "service",
            name: worker.slug ?? worker.id,
            workload: buildProjectedServiceSpec(
              config,
              activeDeployment
                ? parseDeploymentTargetConfig({
                  provider_name: activeDeployment.providerName as never,
                  target_json: activeDeployment.targetJson,
                })
                : undefined,
            ) as never,
          });
        }
      } else if (worker.group_id) {
        await removeGroupDesiredWorkload(c.env, {
          groupId: worker.group_id,
          category: worker.service_type === "app" ? "worker" : "service",
          name: worker.slug ?? worker.id,
        });
      }

      const updated = await getServiceForUser(c.env.DB, workerId, user.id);
      return c.json({ service: updated });
    },
  )
  .get("/:id/logs", async (c) => {
    const user = c.get("user");
    const workerId = c.req.param("id");
    const { limit } = parsePagination(c.req.query());
    const sinceRaw = Number.parseInt(c.req.query("since") ?? "", 10);
    const sinceHours = Number.isFinite(sinceRaw) && sinceRaw > 0
      ? Math.min(sinceRaw, 72)
      : 1;

    if (!c.env.CF_ACCOUNT_ID || !c.env.CF_API_TOKEN) {
      throw new InternalError("Cloudflare API not configured");
    }

    const worker = await getServiceForUser(c.env.DB, workerId, user.id);
    if (!worker) {
      throw new NotFoundError("Service");
    }

    const desiredState = new ServiceDesiredStateService(c.env);
    const scriptName = await desiredState.getCurrentDeploymentArtifactRef(
      worker.id,
    );

    if (!scriptName) {
      return c.json({ invocations: [] });
    }

    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - sinceHours * 60 * 60 * 1000);

    const query = `
    query GetWorkerInvocations($accountTag: String!, $scriptName: String!, $startTime: Time!, $endTime: Time!, $limit: Int!) {
      viewer {
        accounts(filter: { accountTag: $accountTag }) {
          workersInvocationsAdaptive(
            filter: {
              scriptName: $scriptName
              datetime_geq: $startTime
              datetime_leq: $endTime
            }
            limit: $limit
            orderBy: [datetime_DESC]
          ) {
            datetime
            status
            cpuTime
            responseStatus
            clientRequestMethod
            clientRequestPath
          }
        }
      }
    }
  `;

    const cfClient = createCloudflareApiClient(c.env);
    if (!cfClient) {
      throw new InternalError("Cloudflare API not configured");
    }

    const gqlResponse = await cfClient.fetchRaw("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: c.env.CF_ACCOUNT_ID,
          scriptName,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          limit,
        },
      }),
    });

    const result = await gqlResponse.json() as CfGraphQLResponse;

    if (result.errors?.length) {
      throw new InternalError(result.errors[0].message);
    }

    const invocations =
      result.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive || [];
    return c.json({ invocations });
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const workerId = c.req.param("id");

    const worker = await getServiceForUserWithRole(
      c.env.DB,
      workerId,
      user.id,
      ["owner", "admin"],
    );

    if (!worker) {
      throw new NotFoundError("Service");
    }

    if (worker.group_id) {
      await removeGroupDesiredWorkload(c.env, {
        groupId: worker.group_id,
        category: worker.service_type === "app" ? "worker" : "service",
        name: worker.slug ?? worker.id,
      });
    }

    const db = getDb(c.env.DB);

    const workerCustomDomains = db.select({
      id: serviceCustomDomains.id,
      domain: serviceCustomDomains.domain,
      cfCustomHostnameId: serviceCustomDomains.cfCustomHostnameId,
    }).from(serviceCustomDomains).where(
      eq(serviceCustomDomains.serviceId, workerId),
    ).all();

    const resolvedCustomDomains = await workerCustomDomains;

    for (const customDomain of resolvedCustomDomains) {
      try {
        await deleteHostnameRouting({
          env: c.env,
          hostname: customDomain.domain,
          executionCtx: c.executionCtx,
        });
      } catch (e) {
        logWarn("Failed to delete custom domain routing", {
          module: "routes/services/base",
          error: e instanceof Error ? e.message : String(e),
        });
      }
      if (customDomain.cfCustomHostnameId) {
        try {
          await deleteCloudflareCustomHostname(
            c.env,
            customDomain.cfCustomHostnameId,
          );
        } catch (e) {
          logWarn("Failed to delete CF custom hostname", {
            module: "routes/services/base",
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    if (resolvedCustomDomains.length > 0) {
      await db.delete(serviceCustomDomains).where(
        eq(serviceCustomDomains.serviceId, workerId),
      );
    }

    if (worker.hostname) {
      try {
        await deleteHostnameRouting({
          env: c.env,
          hostname: worker.hostname,
          executionCtx: c.executionCtx,
        });
      } catch (e) {
        logWarn("Failed to delete hostname routing", {
          module: "routes/services/base",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const deploymentArtifacts = await db.select({
      artifactRef: deployments.artifactRef,
    }).from(deployments).where(eq(serviceDeployments.serviceId, workerId))
      .all();

    const artifactRefs = new Set<string>();
    if (worker.service_name) {
      artifactRefs.add(worker.service_name);
    }
    for (const deployment of deploymentArtifacts) {
      if (deployment.artifactRef) {
        artifactRefs.add(deployment.artifactRef);
      }
    }

    if (artifactRefs.size > 0) {
      const wfp = createOptionalCloudflareWfpProvider(c.env);
      if (!wfp) {
        logWarn(
          "Skipping WFP artifact cleanup because Cloudflare WFP is not configured",
          {
            module: "routes/services/base",
            details: Array.from(artifactRefs),
          },
        );
      } else {
        for (const artifactRef of artifactRefs) {
          try {
            await wfp.workers.deleteWorker(artifactRef);
          } catch (e) {
            logWarn("Failed to delete WFP artifact", {
              module: "routes/services/base",
              details: [
                artifactRef,
                e instanceof Error ? e.message : String(e),
              ],
            });
          }
        }
      }
    }

    const deps = createCommonEnvDeps(c.env);
    await deleteServiceTakosAccessTokenConfig(deps.manualLink, {
      spaceId: worker.space_id,
      serviceId: worker.id,
    });
    await deleteService(c.env.DB, workerId);

    return c.json({ success: true });
  });

export default workersBase;
