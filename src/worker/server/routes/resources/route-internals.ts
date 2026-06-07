import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import {
  AuthorizationError,
  BadRequestError,
  InternalError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import type { Resource } from "../../../shared/types/index.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";
import { getPlatformServices } from "../../../platform/accessors.ts";
import {
  checkResourceAccess,
  countResourceBindings,
  deleteManagedResource,
  deleteResource,
  getResourceById,
  getResourceByName,
  markResourceDeleting,
} from "../../../application/services/resources/index.ts";
import { getDb } from "../../../infra/db/index.ts";
import { groups } from "../../../infra/db/schema.ts";
import { getStoredResourceImplementation } from "../../../application/services/resources/capabilities.ts";
import { logError } from "../../../shared/utils/logger.ts";

export type ResourcesContext = Context<AuthenticatedRouteEnv>;
export type ResourceRecord = NonNullable<
  Awaited<ReturnType<typeof getResourceById>>
>;
export type NamedResourceRecord = NonNullable<
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

export function toPublicResourcePayload<T>(value: T): T {
  return stripPublicResourceBackingFields(value);
}

/**
 * Shared drizzle-`resources`-row → public `Resource` mapper.
 *
 * Used by the per-capability resource routes (r2 / kv / d1) which all read the
 * same `resources` row via `db.select().from(resources).get()` and emit the
 * same snake_case `Resource` shape. `config`/`metadata` are NOT NULL with a
 * `'{}'` default at the schema level, so the `?? "{}"` fallbacks are defensive
 * only; the `?? null` on the backing fields mirrors their nullable text column.
 */
export function toResource(row: {
  id: string;
  ownerAccountId: string;
  accountId: string | null;
  backendName?: string | null;
  name: string;
  type: string;
  status: string;
  backingResourceId?: string | null;
  backingResourceName?: string | null;
  config: string | null;
  metadata: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}): Resource {
  return {
    id: row.id,
    owner_id: row.ownerAccountId,
    space_id: row.accountId,
    ...(row.backendName !== undefined ? { backend_name: row.backendName } : {}),
    name: row.name,
    type: row.type as Resource["type"],
    status: row.status as Resource["status"],
    backing_resource_id: row.backingResourceId ?? null,
    backing_resource_name: row.backingResourceName ?? null,
    config: row.config ?? "{}",
    metadata: row.metadata ?? "{}",
    created_at: textDate(row.createdAt),
    updated_at: textDate(row.updatedAt),
  };
}

export function requireDbBinding(c: ResourcesContext) {
  const dbBinding = getPlatformServices(c).sql?.binding;
  if (!dbBinding) {
    throw new InternalError("Database binding unavailable");
  }
  return dbBinding;
}

export function toStoredResourceConfig(
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

export async function requireOwnedResource(
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

export async function requireAccessibleResource(
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

export async function requireOwnedNamedResource(
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

export async function validateGroupForWorkspace(
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

export async function deleteOwnedResourceRecord(
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

export { and, eq };
