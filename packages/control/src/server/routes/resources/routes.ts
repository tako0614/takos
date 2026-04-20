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
  ConflictError,
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
  buildProvisioningRequest,
  inferResourceBackend,
  resolveRequestedBackingResourceName,
} from "./route-helpers.ts";
import {
  deletePortableManagedResource,
  getPortableSecretValue,
} from "./portable-runtime.ts";

const resourcesBase = new Hono<AuthenticatedRouteEnv>();
type ResourcesContext = Context<AuthenticatedRouteEnv>;
type ResourceRecord = NonNullable<Awaited<ReturnType<typeof getResourceById>>>;
type NamedResourceRecord = NonNullable<
  Awaited<ReturnType<typeof getResourceByName>>
>;

const PUBLIC_BACKING_FIELD_NAMES = new Set([
  "backend",
  "backendName",
  "backend_name",
  "backendState",
  "backendStateJson",
  "backend_state",
  "backend_state_json",
  "backingResourceId",
  "backing_resource_id",
  "backingResourceName",
  "backing_resource_name",
]);

export function stripPublicResourceBackingFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripPublicResourceBackingFields(entry)) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PUBLIC_BACKING_FIELD_NAMES.has(key)) {
      continue;
    }
    result[key] = stripPublicResourceBackingFields(entry);
  }
  return result as T;
}

function toPublicResourcePayload<T>(value: T): T {
  return stripPublicResourceBackingFields(value);
}

function requireDbBinding(c: ResourcesContext) {
  const dbBinding = getPlatformServices(c).sql?.binding;
  if (!dbBinding) {
    throw new InternalError("Database binding unavailable");
  }
  return dbBinding;
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

async function deleteManagedResourceSafely(
  env: AuthenticatedRouteEnv["Bindings"],
  resource: {
    type: string;
    config: unknown;
    backend_name?: string | null;
    backing_resource_id?: string | null;
    backing_resource_name?: string | null;
  },
): Promise<void> {
  try {
    await deleteManagedResource(env, {
      type: getStoredResourceImplementation(
        resource.type,
        toStoredResourceConfig(resource.config),
      ) ??
        resource.type,
      backendName: resource.backend_name ?? undefined,
      backingResourceId: resource.backing_resource_id ?? null,
      backingResourceName: resource.backing_resource_name ?? null,
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
    backend_name?: string | null;
    backing_resource_id?: string | null;
    backing_resource_name?: string | null;
  },
): Promise<number | null> {
  const bindingsCount = await countResourceBindings(dbBinding, resourceId);
  if (bindingsCount && bindingsCount.count > 0) {
    return bindingsCount.count;
  }

  await markResourceDeleting(dbBinding, resourceId);
  await deleteManagedResourceSafely(env, resource);
  await deleteResource(dbBinding, resourceId);
  return null;
}

// ── Secret resources (storage.<name>.type: secret) ──────────────────────────

const SECRET_ROTATION_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

function isSecretResource(resource: ResourceRecord): boolean {
  const capability = toResourceCapability(resource.type, resource.config);
  return capability === "secret";
}

function generateSecretTokenHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface SecretRotationState {
  previousValue: string | null;
  previousExpiresAt: string | null;
}

/**
 * Fetch the raw rotation-grace state for a resource. The public Resource API
 * type intentionally does not expose the previous secret material, so we
 * query the underlying row directly when needed.
 */
async function getSecretRotationState(
  dbBinding: ReturnType<typeof requireDbBinding>,
  resourceId: string,
): Promise<SecretRotationState> {
  const row = await getDb(dbBinding).select({
    previousSecretValue: resources.previousSecretValue,
    previousSecretExpiresAt: resources.previousSecretExpiresAt,
  }).from(resources).where(eq(resources.id, resourceId)).get();
  return {
    previousValue: row?.previousSecretValue ?? null,
    previousExpiresAt: row?.previousSecretExpiresAt ?? null,
  };
}

/**
 * Lazy-clear the previous secret value if its grace period has elapsed.
 * Returns the post-clear state so callers can inspect or surface the value.
 */
async function clearExpiredPreviousSecret(
  dbBinding: ReturnType<typeof requireDbBinding>,
  resourceId: string,
  state: SecretRotationState,
  now: Date = new Date(),
): Promise<SecretRotationState> {
  if (!state.previousExpiresAt) return state;
  const expiresAt = Date.parse(state.previousExpiresAt);
  if (Number.isNaN(expiresAt) || expiresAt > now.getTime()) return state;

  await getDb(dbBinding).update(resources)
    .set({
      previousSecretValue: null,
      previousSecretExpiresAt: null,
    })
    .where(eq(resources.id, resourceId))
    .run();
  return { previousValue: null, previousExpiresAt: null };
}

/**
 * Verify a presented secret value against both the current value and the
 * (still in-grace) previous value. Exposed so future authentication paths
 * can perform dual-value verification without re-reading the schema.
 */
export async function verifyResourceSecretValue(
  dbBinding: ReturnType<typeof requireDbBinding>,
  resource: ResourceRecord,
  presented: string,
): Promise<boolean> {
  if (!presented) return false;
  const current = await readResourceSecretValue(dbBinding, resource);
  if (current && presented === current) return true;

  const initial = await getSecretRotationState(dbBinding, resource.id);
  const state = await clearExpiredPreviousSecret(
    dbBinding,
    resource.id,
    initial,
  );
  return state.previousValue !== null && presented === state.previousValue;
}

async function readResourceSecretValue(
  dbBinding: ReturnType<typeof requireDbBinding>,
  resource: ResourceRecord,
): Promise<string> {
  // Lazy-clear any expired previous secret value while we are touching this
  // row. This keeps the grace-period state from lingering past 24h even if
  // no rotate call comes through.
  const initial = await getSecretRotationState(dbBinding, resource.id);
  await clearExpiredPreviousSecret(dbBinding, resource.id, initial);

  const backendName = resource.backend_name;
  if (backendName && backendName !== "cloudflare") {
    return await getPortableSecretValue({
      id: resource.id,
      backend_name: backendName,
      backing_resource_id: resource.backing_resource_id,
      backing_resource_name: resource.backing_resource_name,
      ...(resource.config ? { config: resource.config } : {}),
    });
  }
  return resource.backing_resource_id ?? "";
}

interface SecretRotationResult {
  value: string;
  rotatedAt: string;
  previousValueExpiresAt: string;
}

async function rotateResourceSecretValue(
  dbBinding: ReturnType<typeof requireDbBinding>,
  resource: ResourceRecord,
): Promise<SecretRotationResult> {
  const rotatedAt = new Date().toISOString();
  const previousValueExpiresAt = new Date(
    Date.parse(rotatedAt) + SECRET_ROTATION_GRACE_PERIOD_MS,
  ).toISOString();
  const newValue = generateSecretTokenHex();
  const backendName = resource.backend_name;

  // 24h grace period: capture the current value before mutating, then store
  // it as `previous_secret_value` with an expiry of `now + 24h`. Any read or
  // rotate operation after the expiry will lazy-clear these columns. Future
  // verification paths should use `verifyResourceSecretValue` to check both
  // the current and grace-period value.
  if (backendName && backendName !== "cloudflare") {
    // For portable backends we must capture the existing value BEFORE the
    // delete-and-regenerate cycle, otherwise the old material is lost.
    let oldValue = "";
    try {
      oldValue = await getPortableSecretValue({
        id: resource.id,
        backend_name: backendName,
        backing_resource_id: resource.backing_resource_id,
        backing_resource_name: resource.backing_resource_name,
        ...(resource.config ? { config: resource.config } : {}),
      });
    } catch (_err) {
      // If the previous value is unavailable for some reason (e.g. the
      // marker file was hand-deleted), proceed with rotation but skip the
      // grace-period record — we cannot retain a value we never had.
      oldValue = "";
    }

    // Delete + lazy-regenerate via the existing portable secret store path.
    await deletePortableManagedResource(
      {
        id: resource.id,
        backend_name: backendName,
        backing_resource_id: resource.backing_resource_id,
        backing_resource_name: resource.backing_resource_name,
        ...(resource.config ? { config: resource.config } : {}),
      },
      "secret",
    );
    const regenerated = await getPortableSecretValue({
      id: resource.id,
      backend_name: backendName,
      backing_resource_id: resource.backing_resource_id,
      backing_resource_name: resource.backing_resource_name,
      ...(resource.config ? { config: resource.config } : {}),
    });
    await getDb(dbBinding).update(resources)
      .set({
        updatedAt: rotatedAt,
        previousSecretValue: oldValue || null,
        previousSecretExpiresAt: oldValue ? previousValueExpiresAt : null,
      })
      .where(eq(resources.id, resource.id))
      .run();
    return {
      value: regenerated,
      rotatedAt,
      previousValueExpiresAt,
    };
  }

  // Cloudflare backend: the secret value lives in backing_resource_id.
  const oldValue = resource.backing_resource_id ?? "";
  await getDb(dbBinding).update(resources)
    .set({
      backingResourceId: newValue,
      updatedAt: rotatedAt,
      previousSecretValue: oldValue || null,
      previousSecretExpiresAt: oldValue ? previousValueExpiresAt : null,
    })
    .where(eq(resources.id, resource.id))
    .run();
  return {
    value: newValue,
    rotatedAt,
    previousValueExpiresAt,
  };
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

      return c.json({ resources: toPublicResourcePayload(resourceList) });
    }

    const { owned, shared } = await listResourcesForUser(dbBinding, user.id);

    return c.json({
      owned: toPublicResourcePayload(owned),
      shared: toPublicResourcePayload(shared),
    });
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

    return c.json({ resources: toPublicResourcePayload(resourceList) });
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
      resource: toPublicResourcePayload(resource),
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
        space_id: z.string().optional(),
        group_id: z.string().optional(),
      }).strict(),
    ),
    async (c) => {
      const dbBinding = requireDbBinding(c);
      const user = c.get("user");
      const body = c.req.valid("json") as {
        name: string;
        type: ResourceType;
        config?: Record<string, unknown>;
        space_id?: string;
        group_id?: string;
      };
      if (!body.name?.trim()) {
        throw new BadRequestError("name is required");
      }

      const backendName = inferResourceBackend(c.env);

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
          "Space not found or insufficient permissions",
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
          "group_id must belong to the selected space",
        );
      }

      const id = generateId();
      const timestamp = new Date().toISOString();
      const name = body.name.trim();
      const backingResourceName = resolveRequestedBackingResourceName(
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
          backendName,
          backingResourceName,
          config: body.config || {},
          recordFailure: true,
          ...buildProvisioningRequest(resourceCapability, body.config),
        });
        return c.json({
          resource: toPublicResourcePayload(
            await getResourceById(dbBinding, id),
          ),
        }, 201);
      } catch (err) {
        logError("Resource creation failed", err, {
          module: "routes/resources/base",
        });

        throw new InternalError("Failed to provision resource", {
          resource_id: id,
        });
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
      await requireOwnedResource(
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

      return c.json({ resource: toPublicResourcePayload(updated) });
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
          "group_id must belong to the same space as the resource",
        );
      }

      await getDb(dbBinding).update(resources)
        .set({
          groupId: nextGroupId,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(resources.id, resourceId))
        .run();

      return c.json({
        resource: toPublicResourcePayload(
          await getResourceById(dbBinding, resourceId),
        ),
      });
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
      throw new ConflictError("Resource is in use by workers", {
        binding_count: bindingCount,
      });
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
      resource: toPublicResourcePayload(apiResource),
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
      throw new ConflictError("Resource is in use by workers", {
        binding_count: bindingCount,
      });
    }

    return c.json({ success: true });
  })
  // Read the value of a secret-typed resource. Restricted to the resource
  // owner (admin/owner role on the space).
  .get("/:id/secret-value", async (c) => {
    const dbBinding = requireDbBinding(c);
    const user = c.get("user");
    const resourceId = c.req.param("id");
    const resource = await requireOwnedResource(
      dbBinding,
      user.id,
      resourceId,
      "Only the owner can read this secret",
    );

    if (!isSecretResource(resource)) {
      throw new BadRequestError(
        "Resource is not a secret-typed resource",
      );
    }

    const value = await readResourceSecretValue(dbBinding, resource);
    // Surface the in-grace previous value (if any) so callers can perform
    // dual-value verification while consumers are reloading after a recent
    // rotation. Reads also lazy-clear expired previous values inside
    // `readResourceSecretValue`, so the state we fetch here is always fresh.
    const rotationState = await getSecretRotationState(dbBinding, resource.id);
    return c.json({
      id: resource.id,
      name: resource.name,
      value,
      ...(rotationState.previousValue
        ? {
          previous_value: rotationState.previousValue,
          previous_value_expires_at: rotationState.previousExpiresAt,
        }
        : {}),
    });
  })
  // Rotate the value of a secret-typed resource. Restricted to the resource
  // owner (admin/owner role on the space).
  .post("/:id/rotate-secret", async (c) => {
    const dbBinding = requireDbBinding(c);
    const user = c.get("user");
    const resourceId = c.req.param("id");
    const resource = await requireOwnedResource(
      dbBinding,
      user.id,
      resourceId,
      "Only the owner can rotate this secret",
    );

    if (!isSecretResource(resource)) {
      throw new BadRequestError(
        "Resource is not a secret-typed resource",
      );
    }

    const { value, rotatedAt, previousValueExpiresAt } =
      await rotateResourceSecretValue(
        dbBinding,
        resource,
      );
    return c.json({
      id: resource.id,
      name: resource.name,
      rotated_at: rotatedAt,
      value,
      previous_value_expires_at: previousValueExpiresAt,
    });
  });

export default resourcesBase;
