import { Hono } from "hono";
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
import { AppError, BadRequestError } from "@takos/worker-platform-utils/errors";
import { zValidator } from "../zod-validator.ts";
import {
  getResourceById,
  listResourceAccess,
  listResourceBindings,
  listResourcesByType,
  listResourcesForUser,
  listResourcesForWorkspace,
  provisionManagedResource,
  updateResourceMetadata,
} from "../../../application/services/resources/index.ts";
import { getDb } from "../../../infra/db/index.ts";
import {
  accountMemberships,
  accounts,
  resourceAccess,
  resources,
} from "../../../infra/db/schema.ts";
import { and, eq } from "drizzle-orm";
import { resolveActorPrincipalId } from "../../../application/services/identity/principals.ts";
import { logError } from "../../../shared/utils/logger.ts";
import {
  ConflictError,
  InternalError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import {
  currentResourceTypeList,
  getStoredResourceImplementation,
  toCurrentResourceCapability,
  toPublicResourceType,
} from "../../../application/services/resources/capabilities.ts";
import {
  buildProvisioningRequest,
  inferResourceBackend,
  resolveRequestedBackingResourceName,
} from "./route-helpers.ts";
import {
  deleteOwnedResourceRecord,
  requireAccessibleResource,
  requireDbBinding,
  requireOwnedNamedResource,
  requireOwnedResource,
  stripPublicResourceBackingFields,
  toPublicResourcePayload,
  validateGroupForWorkspace,
} from "./route-internals.ts";
import {
  getSecretRotationState,
  isSecretResource,
  readResourceSecretValue,
  recordSecretRotationAudit,
  rotateResourceSecretValue,
} from "./secret-rotation.ts";

export { stripPublicResourceBackingFields };
export { verifyResourceSecretValue } from "./secret-rotation.ts";

const resourcesBase = new Hono<AuthenticatedRouteEnv>();

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

    const resourceType = toCurrentResourceCapability(requestedType);
    if (!resourceType) {
      throw new BadRequestError(
        `Invalid resource type. Valid resource types: ${currentResourceTypeList()}`,
      );
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

      const resourceCapability = toCurrentResourceCapability(body.type);
      if (!resourceCapability) {
        throw new BadRequestError(
          `Invalid resource type. Valid resource types: ${currentResourceTypeList()}`,
        );
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

    const rotation = await rotateResourceSecretValue(
      dbBinding,
      resource,
    );
    await recordSecretRotationAudit(
      dbBinding,
      resource,
      user.id,
      rotation,
    ).catch((error) => {
      logError("Secret rotation audit write failed", error, {
        module: "routes/resources",
        resourceId: resource.id,
      });
    });
    return c.json({
      id: resource.id,
      name: resource.name,
      rotated_at: rotation.rotatedAt,
      value: rotation.value,
      previous_value_expires_at: rotation.previousValueExpiresAt,
    });
  });

export default resourcesBase;
