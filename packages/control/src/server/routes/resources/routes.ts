import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";
import type {
  ResourceCapability,
  ResourceType,
} from "../../../shared/types/index.ts";
import { generateId } from "../../../shared/utils/index.ts";
import {
  type AuthenticatedRouteEnv,
  requireSpaceAccess,
} from "../route-auth.ts";
import { AppError, BadRequestError } from "takos-common/errors";
import { zValidator } from "../zod-validator.ts";
import {
  checkResourceAccess,
  countResourceBindings,
  deleteManagedResource,
  deleteResource,
  getResourceById,
  getResourceByName,
  listResourceAccess,
  listResourceBindings,
  listResourcesByType,
  listResourcesForUser,
  listResourcesForWorkspace,
  markResourceDeleting,
  provisionManagedResource,
  updateResourceMetadata,
} from "../../../application/services/resources/index.ts";
import { getDb } from "../../../infra/db/index.ts";
import {
  accountMemberships,
  accounts,
  groups,
  resourceAccess,
  resources,
} from "../../../infra/db/schema.ts";
import { and, eq } from "drizzle-orm";
import { resolveActorPrincipalId } from "../../../application/services/identity/principals.ts";
import { logError } from "../../../shared/utils/logger.ts";
import {
  AuthorizationError,
  InternalError,
  NotFoundError,
} from "takos-common/errors";
import { getPlatformServices } from "../../../platform/accessors.ts";
import {
  getStoredResourceImplementation,
  toPublicResourceType,
  toResourceCapability,
} from "../../../application/services/resources/capabilities.ts";
import {
  removeGroupDesiredResource,
  upsertGroupDesiredResource,
} from "../../../application/services/deployment/group-desired-projector.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import {
  buildProjectedResourceSpec,
  buildProvisioningRequest,
  inferResourceProvider,
  normalizeResourceProvider,
  resolveRequestedProviderResourceName,
} from "./route-helpers.ts";

const resourcesBase = new Hono<AuthenticatedRouteEnv>();
type ResourcesContext = Context<AuthenticatedRouteEnv>;
type ResourceRecord = NonNullable<Awaited<ReturnType<typeof getResourceById>>>;
type NamedResourceRecord = NonNullable<
  Awaited<ReturnType<typeof getResourceByName>>
>;

function requireDbBinding(c: ResourcesContext) {
  const dbBinding = getPlatformServices(c).sql?.binding;
  if (!dbBinding) {
    throw new InternalError("Database binding unavailable");
  }
  return dbBinding;
}

function parseStoredResourceConfig(
  config: unknown,
): Record<string, unknown> {
  if (typeof config === "string") {
    return safeJsonParseOrDefault<Record<string, unknown>>(config, {});
  }
  return config && typeof config === "object" && !Array.isArray(config)
    ? config as Record<string, unknown>
    : {};
}

function toStoredResourceConfig(
  config: unknown,
): string | Record<string, unknown> | undefined {
  if (typeof config === "string") {
    return config;
  }
  if (config && typeof config === "object" && !Array.isArray(config)) {
    return config as Record<string, unknown>;
  }
  return undefined;
}

async function requireOwnedResource(
  dbBinding: ReturnType<typeof requireDbBinding>,
  userId: string,
  resourceId: string,
  errorMessage = "Only the owner can operate on this resource",
): Promise<ResourceRecord> {
  const resource = await getResourceById(dbBinding, resourceId);
  if (!resource) {
    throw new NotFoundError("Resource");
  }
  if (resource.owner_id !== userId) {
    throw new AuthorizationError(errorMessage);
  }
  return resource;
}

async function requireAccessibleResource(
  dbBinding: ReturnType<typeof requireDbBinding>,
  userId: string,
  resourceId: string,
): Promise<ResourceRecord> {
  const resource = await getResourceById(dbBinding, resourceId);
  if (!resource) {
    throw new NotFoundError("Resource");
  }
  const hasAccess = resource.owner_id === userId ||
    await checkResourceAccess(dbBinding, resourceId, userId);
  if (!hasAccess) {
    throw new NotFoundError("Resource");
  }
  return resource;
}

async function requireOwnedNamedResource(
  dbBinding: ReturnType<typeof requireDbBinding>,
  userId: string,
  resourceName: string,
): Promise<NamedResourceRecord> {
  const resource = await getResourceByName(dbBinding, userId, resourceName);
  if (!resource) {
    throw new NotFoundError("Resource");
  }
  return resource;
}

async function validateGroupForWorkspace(
  dbBinding: ReturnType<typeof requireDbBinding>,
  groupId: string,
  spaceId: string,
  errorMessage: string,
): Promise<string> {
  const db = getDb(dbBinding);
  const group = await db.select({
    id: groups.id,
    spaceId: groups.spaceId,
  })
    .from(groups)
    .where(eq(groups.id, groupId))
    .get();
  if (!group || group.spaceId !== spaceId) {
    throw new BadRequestError(errorMessage);
  }
  return group.id;
}

async function upsertProjectedGroupResourceFromRecord(
  env: AuthenticatedRouteEnv["Bindings"],
  groupId: string,
  name: string,
  type: ResourceType,
  config: unknown,
): Promise<void> {
  await upsertGroupDesiredResource(env, {
    groupId,
    name,
    resource: buildProjectedResourceSpec(
      name,
      { type, config: parseStoredResourceConfig(config) },
    ) as never,
  });
}

async function removeProjectedGroupResourceIfPresent(
  env: AuthenticatedRouteEnv["Bindings"],
  groupId: string | null | undefined,
  name: string,
): Promise<void> {
  if (!groupId) return;
  await removeGroupDesiredResource(env, { groupId, name });
}

async function reconcileProjectedGroupResourceUpdate(
  env: AuthenticatedRouteEnv["Bindings"],
  resource: ResourceRecord,
  updates: {
    name?: string;
    config?: Record<string, unknown>;
  },
): Promise<void> {
  if (!resource.group_id) return;

  const nextName = updates.name?.trim() || resource.name;
  const nextConfig = updates.config ??
    parseStoredResourceConfig(resource.config);

  if (nextName !== resource.name) {
    await removeProjectedGroupResourceIfPresent(
      env,
      resource.group_id,
      resource.name,
    );
  }

  await upsertProjectedGroupResourceFromRecord(
    env,
    resource.group_id,
    nextName,
    resource.type as ResourceType,
    nextConfig,
  );
}

async function moveProjectedGroupResource(
  env: AuthenticatedRouteEnv["Bindings"],
  resource: ResourceRecord,
  nextGroupId: string | null,
): Promise<void> {
  if (nextGroupId) {
    await upsertProjectedGroupResourceFromRecord(
      env,
      nextGroupId,
      resource.name,
      resource.type as ResourceType,
      resource.config,
    );
    return;
  }
  await removeProjectedGroupResourceIfPresent(
    env,
    resource.group_id,
    resource.name,
  );
}

async function deleteManagedResourceSafely(
  env: AuthenticatedRouteEnv["Bindings"],
  resource: {
    type: string;
    config: unknown;
    provider_name?: string | null;
    provider_resource_id?: string | null;
    provider_resource_name?: string | null;
  },
): Promise<void> {
  try {
    await deleteManagedResource(env, {
      type: getStoredResourceImplementation(
        resource.type,
        toStoredResourceConfig(resource.config),
      ) ??
        resource.type,
      providerName: resource.provider_name ?? undefined,
      providerResourceId: resource.provider_resource_id ?? null,
      providerResourceName: resource.provider_resource_name ?? null,
    });
  } catch (err) {
    logError("Failed to delete managed resource", err, {
      module: "routes/resources/base",
    });
  }
}

async function deleteOwnedResourceRecord(
  env: AuthenticatedRouteEnv["Bindings"],
  dbBinding: ReturnType<typeof requireDbBinding>,
  resourceId: string,
  resource: {
    group_id?: string | null;
    name: string;
    type: string;
    config: unknown;
    provider_name?: string | null;
    provider_resource_id?: string | null;
    provider_resource_name?: string | null;
  },
): Promise<number | null> {
  await removeProjectedGroupResourceIfPresent(
    env,
    resource.group_id,
    resource.name,
  );

  const bindingsCount = await countResourceBindings(dbBinding, resourceId);
  if (bindingsCount && bindingsCount.count > 0) {
    return bindingsCount.count;
  }

  await markResourceDeleting(dbBinding, resourceId);
  await deleteManagedResourceSafely(env, resource);
  await deleteResource(dbBinding, resourceId);
  return null;
}

resourcesBase.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(err.toResponse(), err.statusCode as ContentfulStatusCode);
  }
  logError("Unhandled resources route error", err, {
    module: "routes/resources/base",
  });
  return c.json(
    new InternalError("Internal server error").toResponse(),
    500,
  );
});

resourcesBase
  .get("/", async (c) => {
    const dbBinding = requireDbBinding(c);
    const user = c.get("user");
    const spaceId = c.req.query("space_id");

    if (spaceId) {
      const access = await requireSpaceAccess(
        c,
        spaceId,
        user.id,
        ["owner", "admin", "editor", "viewer"],
        "Workspace not found or access denied",
        404,
      );

      const resourceList = await listResourcesForWorkspace(
        dbBinding,
        user.id,
        access.space.id,
      );

      return c.json({ resources: resourceList });
    }

    const { owned, shared } = await listResourcesForUser(dbBinding, user.id);

    return c.json({ owned, shared });
  })
  .get("/shared/:spaceId", async (c) => {
    const dbBinding = requireDbBinding(c);
    const user = c.get("user");
    const spaceId = c.req.param("spaceId");
    const db = getDb(dbBinding);
    const principalId = await resolveActorPrincipalId(dbBinding, user.id);
    if (!principalId) {
      throw new InternalError("User principal not found");
    }

    const isMember = await db.select({ id: accountMemberships.id }).from(
      accountMemberships,
    ).where(
      and(
        eq(accountMemberships.accountId, spaceId),
        eq(accountMemberships.memberId, principalId),
      ),
    ).get();

    if (!isMember) {
      throw new NotFoundError("Workspace");
    }

    // Get resource access entries for this space
    const accessList = await db.select().from(resourceAccess).where(
      eq(resourceAccess.accountId, spaceId),
    ).all();

    // Load resources and owner info for each access entry
    const sharedResources: Array<{
      name: string;
      type: string;
      capability?: string;
      implementation?: string | null;
      status: string;
      provider_resource_id: string | null;
      provider_resource_name: string | null;
      access_level: string;
      owner_name: string;
      owner_email: string | null;
    }> = [];

    for (const a of accessList) {
      const resource = await db.select().from(resources).where(
        eq(resources.id, a.resourceId),
      ).get();
      if (
        !resource || resource.status === "deleted" ||
        resource.accountId === spaceId
      ) continue;

      const owner = await db.select({
        name: accounts.name,
        email: accounts.email,
      }).from(accounts).where(
        eq(accounts.id, resource.ownerAccountId),
      ).get();

      sharedResources.push({
        name: resource.name,
        type: toPublicResourceType(resource.type, resource.config) ??
          resource.type,
        ...(resource.semanticType ? { capability: resource.semanticType } : {}),
        ...(getStoredResourceImplementation(resource.type, resource.config)
          ? {
            implementation: getStoredResourceImplementation(
              resource.type,
              resource.config,
            ),
          }
          : {}),
        status: resource.status,
        provider_resource_id: resource.providerResourceId,
        provider_resource_name: resource.providerResourceName,
        access_level: a.permission,
        owner_name: owner?.name ?? "",
        owner_email: owner?.email ?? null,
      });
    }

    return c.json({ shared_resources: sharedResources });
  })
  .get("/type/:type", async (c) => {
    const dbBinding = requireDbBinding(c);
    const user = c.get("user");
    const requestedType = c.req.param("type");

    const resourceType = toResourceCapability(requestedType);
    if (!resourceType) {
      throw new BadRequestError("Invalid resource type");
    }

    const resourceList = await listResourcesByType(
      dbBinding,
      user.id,
      resourceType as ResourceCapability,
    );

    return c.json({ resources: resourceList });
  })
  .get("/:id", async (c) => {
    const dbBinding = requireDbBinding(c);
    const user = c.get("user");
    const resourceId = c.req.param("id");
    const resource = await requireAccessibleResource(
      dbBinding,
      user.id,
      resourceId,
    );

    const access = await listResourceAccess(dbBinding, resourceId);
    const resourceBindings = await listResourceBindings(dbBinding, resourceId);

    return c.json({
      resource,
      access,
      bindings: resourceBindings,
      is_owner: resource.owner_id === user.id,
    });
  })
  .post(
    "/",
    zValidator(
      "json",
      z.object({
        name: z.string(),
        type: z.string(),
        config: z.record(z.unknown()).optional(),
        provider: z.string().optional(),
        space_id: z.string().optional(),
        group_id: z.string().optional(),
      }),
    ),
    async (c) => {
      const dbBinding = requireDbBinding(c);
      const user = c.get("user");
      const body = c.req.valid("json") as {
        name: string;
        type: ResourceType;
        config?: Record<string, unknown>;
        provider?: string;
        space_id?: string;
        group_id?: string;
      };
      if (!body.name?.trim()) {
        throw new BadRequestError("name is required");
      }

      const providerName = normalizeResourceProvider(body.provider) ??
        inferResourceProvider(c.env);
      if (body.provider && !normalizeResourceProvider(body.provider)) {
        throw new BadRequestError(`Invalid provider: ${body.provider}`);
      }

      const resourceCapability = toResourceCapability(body.type);
      if (!resourceCapability) {
        throw new BadRequestError("Invalid resource type");
      }

      let spaceId = body.space_id?.trim() || "";

      if (spaceId) {
        const access = await requireSpaceAccess(
          c,
          spaceId,
          user.id,
          ["owner", "admin", "editor"],
          "Workspace not found or insufficient permissions",
          403,
        );

        spaceId = access.space.id;
      } else {
        // Default to user's own account
        spaceId = user.id;
      }

      let groupId: string | null = null;
      if (body.group_id?.trim()) {
        groupId = await validateGroupForWorkspace(
          dbBinding,
          body.group_id.trim(),
          spaceId,
          "group_id must belong to the selected workspace",
        );
      }

      const id = generateId();
      const timestamp = new Date().toISOString();
      const name = body.name.trim();
      const providerResourceName = resolveRequestedProviderResourceName(
        body.type,
        `takos-${body.type}-${id}`,
        body.config,
      );

      try {
        await provisionManagedResource(c.env, {
          id,
          timestamp,
          ownerId: user.id,
          spaceId,
          groupId,
          name,
          type: resourceCapability,
          publicType: body.type,
          semanticType: resourceCapability,
          providerName,
          providerResourceName,
          config: body.config || {},
          recordFailure: true,
          ...buildProvisioningRequest(resourceCapability, body.config),
        });
        if (groupId) {
          await upsertProjectedGroupResourceFromRecord(
            c.env,
            groupId,
            name,
            body.type,
            body.config,
          );
        }
        return c.json({ resource: await getResourceById(dbBinding, id) }, 201);
      } catch (err) {
        logError("Resource creation failed", err, {
          module: "routes/resources/base",
        });

        return c.json({
          error: "Failed to provision resource",
          resource_id: id,
        }, 500);
      }
    },
  )
  .patch(
    "/:id",
    zValidator(
      "json",
      z.object({
        name: z.string().optional(),
        config: z.record(z.unknown()).optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
    ),
    async (c) => {
      const dbBinding = requireDbBinding(c);
      const user = c.get("user");
      const resourceId = c.req.param("id");
      const body = c.req.valid("json");
      const resource = await requireOwnedResource(
        dbBinding,
        user.id,
        resourceId,
        "Only the owner can update this resource",
      );

      if (body.name?.trim()) {
        body.name = body.name.trim();
      }

      const updated = await updateResourceMetadata(dbBinding, resourceId, {
        name: body.name,
        config: body.config,
        metadata: body.metadata,
      });

      if (!updated) {
        throw new BadRequestError("No valid updates provided");
      }

      await reconcileProjectedGroupResourceUpdate(c.env, resource, {
        name: body.name,
        config: body.config,
      });

      return c.json({ resource: updated });
    },
  )
  .patch(
    "/:id/group",
    zValidator(
      "json",
      z.object({
        group_id: z.string().nullable().optional(),
      }),
    ),
    async (c) => {
      const dbBinding = requireDbBinding(c);
      const user = c.get("user");
      const resourceId = c.req.param("id");
      const body = c.req.valid("json") as { group_id?: string | null };
      const resource = await requireOwnedResource(
        dbBinding,
        user.id,
        resourceId,
        "Only the owner can move this resource",
      );

      const nextGroupId = body.group_id?.trim() || null;
      if (nextGroupId) {
        await validateGroupForWorkspace(
          dbBinding,
          nextGroupId,
          resource.space_id ?? resource.owner_id,
          "group_id must belong to the same workspace as the resource",
        );
      }

      await getDb(dbBinding).update(resources)
        .set({
          groupId: nextGroupId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(resources.id, resourceId))
        .run();

      await moveProjectedGroupResource(c.env, resource, nextGroupId);

      return c.json({ resource: await getResourceById(dbBinding, resourceId) });
    },
  )
  .delete("/:id", async (c) => {
    const dbBinding = requireDbBinding(c);
    const user = c.get("user");
    const resourceId = c.req.param("id");
    const resource = await requireOwnedResource(
      dbBinding,
      user.id,
      resourceId,
      "Only the owner can delete this resource",
    );
    const bindingCount = await deleteOwnedResourceRecord(
      c.env,
      dbBinding,
      resourceId,
      resource,
    );
    if (bindingCount !== null) {
      return c.json({
        error: "Resource is in use by workers",
        binding_count: bindingCount,
      }, 409);
    }

    return c.json({ success: true });
  })
  .get("/by-name/:name", async (c) => {
    const dbBinding = requireDbBinding(c);
    const user = c.get("user");
    const resourceName = decodeURIComponent(c.req.param("name"));
    const resource = await requireOwnedNamedResource(
      dbBinding,
      user.id,
      resourceName,
    );

    const { _internal_id, ...apiResource } = resource;
    const access = await listResourceAccess(dbBinding, _internal_id);
    const resourceBindings = await listResourceBindings(
      dbBinding,
      _internal_id,
    );

    return c.json({
      resource: apiResource,
      access,
      bindings: resourceBindings,
      is_owner: true,
    });
  })
  // Delete resource by name
  .delete("/by-name/:name", async (c) => {
    const dbBinding = requireDbBinding(c);
    const user = c.get("user");
    const resourceName = decodeURIComponent(c.req.param("name"));
    const resource = await requireOwnedNamedResource(
      dbBinding,
      user.id,
      resourceName,
    );
    const bindingCount = await deleteOwnedResourceRecord(
      c.env,
      dbBinding,
      resource._internal_id,
      resource,
    );
    if (bindingCount !== null) {
      return c.json({
        error: "Resource is in use by workers",
        binding_count: bindingCount,
      }, 409);
    }

    return c.json({ success: true });
  });

export default resourcesBase;
