import type { D1Database } from "../../../shared/types/bindings.ts";
import type {
  Resource,
  ResourceCapability,
  ResourcePermission,
  ResourceStatus,
  ResourceType,
} from "../../../shared/types/index.ts";
import type { SelectOf } from "../../../shared/types/drizzle-utils.ts";
import { getDb, resourceAccess, resources } from "../../../infra/db/index.ts";
import {
  and,
  asc,
  type count as _count,
  desc,
  eq,
  inArray,
  ne,
} from "drizzle-orm";
import { toApiResource } from "./format.ts";
import { resolveAccessibleAccountIds } from "../identity/membership-resolver.ts";
import { textDateNullable } from "../../../shared/utils/db-guards.ts";
import { getResourceTypeQueryValues } from "./capabilities.ts";

export const resourceStoreDeps = {
  getDb,
  resolveAccessibleAccountIds,
  now: () => new Date().toISOString(),
};

function buildAccessMap(
  grants: { resourceId: string; permission: string }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const grant of grants) map.set(grant.resourceId, grant.permission);
  return map;
}

function toApiResourceRow(r: {
  id: string;
  ownerAccountId: string;
  accountId: string | null;
  groupId?: string | null;
  name: string;
  type: string;
  semanticType?: string | null;
  driver?: string | null;
  backendName?: string | null;
  status: string;
  backingResourceId?: string | null;
  backingResourceName?: string | null;
  config: string;
  metadata: string;
  sizeBytes: number | null;
  itemCount: number | null;
  lastUsedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}): Resource {
  return toApiResource({
    ...r,
    ownerId: r.ownerAccountId,
    spaceId: r.accountId,
    groupId: r.groupId ?? null,
    semanticType: r.semanticType ?? null,
    driver: r.driver ?? null,
    backendName: r.backendName ?? null,
    backingResourceId: r.backingResourceId ?? null,
    backingResourceName: r.backingResourceName ?? null,
    lastUsedAt: textDateNullable(r.lastUsedAt),
    createdAt: textDateNullable(r.createdAt) ?? new Date(0).toISOString(),
    updatedAt: textDateNullable(r.updatedAt) ?? new Date(0).toISOString(),
  });
}

export async function listResourcesForWorkspace(
  db: D1Database,
  _userId: string,
  spaceId: string,
) {
  const drizzle = resourceStoreDeps.getDb(db);

  const ownedResources = await drizzle.select().from(resources)
    .where(and(
      eq(resources.accountId, spaceId),
      ne(resources.status, "deleted"),
    ))
    .orderBy(desc(resources.updatedAt))
    .all();

  // For shared resources, use a subquery approach since Drizzle doesn't support relation filters in where
  const sharedAccessGrants = await drizzle.select({
    resourceId: resourceAccess.resourceId,
  })
    .from(resourceAccess)
    .where(eq(resourceAccess.accountId, spaceId))
    .all();
  const sharedResourceIds = sharedAccessGrants.map((a) => a.resourceId);

  let sharedResources: Array<
    SelectOf<typeof resources> & { accessPermission?: string }
  > = [];
  if (sharedResourceIds.length > 0) {
    const rawShared = await drizzle.select().from(resources)
      .where(and(
        ne(resources.status, "deleted"),
        inArray(resources.id, sharedResourceIds),
      ))
      .orderBy(desc(resources.updatedAt))
      .all();

    sharedResources = rawShared.filter((r) => r.accountId !== spaceId);
  }

  // Get access permissions for shared resources
  let sharedResourceAccessMap = new Map<string, string>();
  if (sharedResources.length > 0) {
    const accessRecords = await drizzle.select({
      resourceId: resourceAccess.resourceId,
      permission: resourceAccess.permission,
    }).from(resourceAccess)
      .where(and(
        eq(resourceAccess.accountId, spaceId),
        inArray(resourceAccess.resourceId, sharedResources.map((r) => r.id)),
      ))
      .all();
    sharedResourceAccessMap = buildAccessMap(accessRecords);
  }

  const ownedWithLevel = ownedResources.map((r) => ({
    ...toApiResourceRow(r),
    access_level: "owner",
  }));

  const sharedWithLevel = sharedResources.map((r) => ({
    ...toApiResourceRow(r),
    access_level: sharedResourceAccessMap.get(r.id) || "read",
  }));

  const combined = [...ownedWithLevel, ...sharedWithLevel];
  combined.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return combined;
}

export async function listResourcesForUser(db: D1Database, userId: string) {
  const drizzle = resourceStoreDeps.getDb(db);
  const accessibleAccountIds = await resourceStoreDeps
    .resolveAccessibleAccountIds(db, userId);

  const ownedResources = await drizzle.select().from(resources)
    .where(eq(resources.ownerAccountId, userId))
    .orderBy(desc(resources.updatedAt))
    .all();

  // Get shared resources via access grants
  const accessGrants = await drizzle.select({
    resourceId: resourceAccess.resourceId,
    permission: resourceAccess.permission,
  })
    .from(resourceAccess)
    .where(inArray(resourceAccess.accountId, accessibleAccountIds))
    .all();
  const sharedResourceIds = [...new Set(accessGrants.map((a) => a.resourceId))];
  const accessMap = buildAccessMap(accessGrants);

  let sharedResources: Array<SelectOf<typeof resources>> = [];
  if (sharedResourceIds.length > 0) {
    sharedResources = await drizzle.select().from(resources)
      .where(and(
        ne(resources.ownerAccountId, userId),
        inArray(resources.id, sharedResourceIds),
      ))
      .orderBy(desc(resources.updatedAt))
      .all();
  }

  return {
    owned: ownedResources.map((r) => ({
      ...toApiResourceRow(r),
      access_level: "owner",
    })),
    shared: sharedResources.map((r) => ({
      ...toApiResourceRow(r),
      access_level: accessMap.get(r.id) || "read",
    })),
  };
}

export async function listResourcesByType(
  db: D1Database,
  userId: string,
  resourceType: ResourceType | ResourceCapability,
) {
  const drizzle = resourceStoreDeps.getDb(db);
  const accessibleAccountIds = await resourceStoreDeps
    .resolveAccessibleAccountIds(db, userId);
  const typeQueryValues = getResourceTypeQueryValues(resourceType);

  const ownedResources = await drizzle.select().from(resources)
    .where(and(
      inArray(resources.type, typeQueryValues),
      eq(resources.ownerAccountId, userId),
    ))
    .orderBy(desc(resources.updatedAt))
    .all();

  // Get shared resources via access grants
  const accessGrants = await drizzle.select({
    resourceId: resourceAccess.resourceId,
    permission: resourceAccess.permission,
  })
    .from(resourceAccess)
    .where(inArray(resourceAccess.accountId, accessibleAccountIds))
    .all();
  const sharedResourceIds = [...new Set(accessGrants.map((a) => a.resourceId))];
  const accessPermMap = buildAccessMap(accessGrants);

  let sharedResources: Array<SelectOf<typeof resources>> = [];
  if (sharedResourceIds.length > 0) {
    sharedResources = await drizzle.select().from(resources)
      .where(and(
        inArray(resources.type, typeQueryValues),
        ne(resources.ownerAccountId, userId),
        inArray(resources.id, sharedResourceIds),
      ))
      .orderBy(desc(resources.updatedAt))
      .all();
  }

  const ownedWithLevel = ownedResources.map((r) => ({
    ...toApiResourceRow(r),
    access_level: "owner",
  }));

  const sharedWithLevel = sharedResources.map((r) => ({
    ...toApiResourceRow(r),
    access_level: accessPermMap.get(r.id) || "read",
  }));

  const combined = [...ownedWithLevel, ...sharedWithLevel];
  combined.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return combined;
}

export async function getResourceById(db: D1Database, resourceId: string) {
  const drizzle = resourceStoreDeps.getDb(db);
  const resource = await drizzle.select().from(resources)
    .where(eq(resources.id, resourceId))
    .get();

  if (!resource) return null;
  return toApiResourceRow(resource);
}

export async function getResourceByName(
  db: D1Database,
  userId: string,
  resourceName: string,
) {
  const drizzle = resourceStoreDeps.getDb(db);
  const resource = await drizzle.select().from(resources)
    .where(and(
      eq(resources.name, resourceName),
      eq(resources.ownerAccountId, userId),
    ))
    .get();

  if (!resource) return null;
  return {
    ...toApiResourceRow(resource),
    _internal_id: resource.id,
  };
}

export async function insertResource(
  db: D1Database,
  input: {
    id: string;
    owner_id: string;
    name: string;
    type: ResourceType;
    semantic_type?: ResourceCapability | null;
    driver?: string | null;
    backend_name?: string | null;
    status: ResourceStatus;
    backing_resource_id?: string | null;
    backing_resource_name?: string | null;
    config: Record<string, unknown>;
    space_id?: string | null;
    group_id?: string | null;
    created_at: string;
    updated_at: string;
  },
) {
  const drizzle = resourceStoreDeps.getDb(db);
  await drizzle.insert(resources).values({
    id: input.id,
    ownerAccountId: input.owner_id,
    name: input.name,
    type: input.type,
    semanticType: input.semantic_type ?? null,
    driver: input.driver ?? null,
    backendName: input.backend_name ?? null,
    status: input.status,
    backingResourceId: input.backing_resource_id ?? null,
    backingResourceName: input.backing_resource_name ?? null,
    config: JSON.stringify(input.config || {}),
    metadata: "{}",
    accountId: input.space_id || null,
    groupId: input.group_id || null,
    createdAt: input.created_at,
    updatedAt: input.updated_at,
  });

  return getResourceById(db, input.id);
}

export async function insertFailedResource(
  db: D1Database,
  input: {
    id: string;
    owner_id: string;
    name: string;
    type: ResourceType;
    semantic_type?: ResourceCapability | null;
    driver?: string | null;
    backend_name?: string | null;
    backing_resource_name?: string | null;
    config: Record<string, unknown>;
    space_id?: string | null;
    group_id?: string | null;
    created_at: string;
    updated_at: string;
  },
) {
  const drizzle = resourceStoreDeps.getDb(db);
  await drizzle.insert(resources).values({
    id: input.id,
    ownerAccountId: input.owner_id,
    name: input.name,
    type: input.type,
    semanticType: input.semantic_type ?? null,
    driver: input.driver ?? null,
    backendName: input.backend_name ?? null,
    status: "failed",
    backingResourceName: input.backing_resource_name ?? null,
    config: JSON.stringify(input.config || {}),
    metadata: "{}",
    accountId: input.space_id || null,
    groupId: input.group_id || null,
    createdAt: input.created_at,
    updatedAt: input.updated_at,
  });
}

export async function updateResourceMetadata(
  db: D1Database,
  resourceId: string,
  updates: {
    name?: string;
    config?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
) {
  const drizzle = resourceStoreDeps.getDb(db);

  const data: Record<string, unknown> = {
    updatedAt: resourceStoreDeps.now(),
  };

  if (updates.name !== undefined) {
    data.name = updates.name;
  }
  if (updates.config !== undefined) {
    data.config = JSON.stringify(updates.config);
  }
  if (updates.metadata !== undefined) {
    data.metadata = JSON.stringify(updates.metadata);
  }

  if (Object.keys(data).length === 1) {
    return null;
  }

  await drizzle.update(resources)
    .set(data)
    .where(eq(resources.id, resourceId));

  return getResourceById(db, resourceId);
}

export async function markResourceDeleting(db: D1Database, resourceId: string) {
  const drizzle = resourceStoreDeps.getDb(db);
  await drizzle.update(resources)
    .set({
      status: "deleting",
      updatedAt: resourceStoreDeps.now(),
    })
    .where(eq(resources.id, resourceId));
}

export async function deleteResource(db: D1Database, resourceId: string) {
  const drizzle = resourceStoreDeps.getDb(db);
  await drizzle.delete(resources).where(eq(resources.id, resourceId));
}

export async function getAvailableResourcesForWorkspace(
  db: D1Database,
  spaceId: string,
  resourceType: ResourceType,
): Promise<Array<Resource & { access_level: "owner" | ResourcePermission }>> {
  const drizzle = resourceStoreDeps.getDb(db);

  const ownedResources = await drizzle.select().from(resources)
    .where(and(
      eq(resources.type, resourceType),
      eq(resources.status, "active"),
      eq(resources.accountId, spaceId),
    ))
    .orderBy(asc(resources.name))
    .all();

  // Get shared resources via access grants
  const accessGrants = await drizzle.select({
    resourceId: resourceAccess.resourceId,
    permission: resourceAccess.permission,
  })
    .from(resourceAccess)
    .where(eq(resourceAccess.accountId, spaceId))
    .all();
  const sharedResourceIds = [...new Set(accessGrants.map((a) => a.resourceId))];
  const accessPermMap = buildAccessMap(accessGrants);

  let sharedResources: Array<SelectOf<typeof resources>> = [];
  if (sharedResourceIds.length > 0) {
    sharedResources = await drizzle.select().from(resources)
      .where(and(
        eq(resources.type, resourceType),
        eq(resources.status, "active"),
        ne(resources.accountId, spaceId),
        inArray(resources.id, sharedResourceIds),
      ))
      .orderBy(asc(resources.name))
      .all();
  }

  const ownedWithLevel = ownedResources.map((r) => ({
    ...toApiResourceRow(r),
    access_level: "owner" as const,
  }));

  const sharedWithLevel = sharedResources.map((r) => ({
    ...toApiResourceRow(r),
    access_level: (accessPermMap.get(r.id) || "read") as ResourcePermission,
  }));

  return [...ownedWithLevel, ...sharedWithLevel];
}
