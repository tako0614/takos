import type { D1Database } from '../../../shared/types/bindings.ts';
import type { ResourcePermission } from '../../../shared/types';
import { getDb, resourceAccess } from '../../../infra/db';
import { eq, and, inArray } from 'drizzle-orm';
import { generateId, toIsoString } from '../../../shared/utils';
import { toApiResourceAccess } from './format';
import { getResourceById } from './store';
import { resolveAccessibleAccountIds } from '../identity/membership-resolver';

const RESOURCE_PERMISSIONS: readonly string[] = ['read', 'write', 'admin'];

function isResourcePermission(value: string): value is ResourcePermission {
  return RESOURCE_PERMISSIONS.includes(value);
}

export async function listResourceAccess(db: D1Database, resourceId: string) {
  const drizzle = getDb(db);

  // We need account name, so join with accounts
  const { accounts } = await import('../../../infra/db');
  const accessGrants = await drizzle.select({
    id: resourceAccess.id,
    resourceId: resourceAccess.resourceId,
    accountId: resourceAccess.accountId,
    permission: resourceAccess.permission,
    grantedByAccountId: resourceAccess.grantedByAccountId,
    createdAt: resourceAccess.createdAt,
    accountName: accounts.name,
  }).from(resourceAccess)
    .leftJoin(accounts, eq(resourceAccess.accountId, accounts.id))
    .where(eq(resourceAccess.resourceId, resourceId))
    .orderBy(resourceAccess.createdAt)
    .all();

  return accessGrants.map((ra) => ({
    ...toApiResourceAccess({
      id: ra.id,
      resourceId: ra.resourceId,
      accountId: ra.accountId,
      permission: ra.permission,
      grantedByAccountId: ra.grantedByAccountId,
      createdAt: toIsoString(ra.createdAt),
    }),
    workspace_name: ra.accountName,
  }));
}

export async function upsertResourceAccess(
  db: D1Database,
  input: { resource_id: string; space_id: string; permission: ResourcePermission; granted_by: string }
) {
  const drizzle = getDb(db);
  const id = generateId();
  const timestamp = new Date().toISOString();

  try {
    await drizzle.insert(resourceAccess).values({
      id,
      resourceId: input.resource_id,
      accountId: input.space_id,
      permission: input.permission,
      grantedByAccountId: input.granted_by,
      createdAt: timestamp,
    });

    return {
      created: true,
      access: {
        id,
        resource_id: input.resource_id,
        space_id: input.space_id,
        permission: input.permission,
        granted_by: input.granted_by,
        created_at: timestamp,
      },
    };
  } catch (err) {
    if (String(err).includes('UNIQUE constraint')) {
      await drizzle.update(resourceAccess)
        .set({ permission: input.permission })
        .where(and(
          eq(resourceAccess.resourceId, input.resource_id),
          eq(resourceAccess.accountId, input.space_id),
        ));

      return {
        created: false,
        permission: input.permission,
      };
    }
    throw err;
  }
}

export async function deleteResourceAccess(db: D1Database, resourceId: string, spaceId: string) {
  const drizzle = getDb(db);
  await drizzle.delete(resourceAccess)
    .where(and(
      eq(resourceAccess.resourceId, resourceId),
      eq(resourceAccess.accountId, spaceId),
    ));
}

export async function checkResourceAccess(
  db: D1Database,
  resourceId: string,
  userId: string,
  requiredPermissions?: ResourcePermission[]
): Promise<boolean> {
  const drizzle = getDb(db);

  // Find accounts the user is a member of
  const accountIds = await resolveAccessibleAccountIds(db, userId, { activeOnly: true });

  const access = await drizzle.select({ permission: resourceAccess.permission })
    .from(resourceAccess)
    .where(and(
      eq(resourceAccess.resourceId, resourceId),
      inArray(resourceAccess.accountId, accountIds),
    ))
    .get();

  if (!access) return false;

  if (!requiredPermissions || requiredPermissions.length === 0) return true;

  if (!isResourcePermission(access.permission)) return false;

  return requiredPermissions.includes(access.permission);
}

export async function canAccessResource(
  db: D1Database,
  resourceId: string,
  userId: string,
  requiredPermissions?: ResourcePermission[]
): Promise<{ canAccess: boolean; isOwner: boolean; permission?: ResourcePermission }> {
  const resource = await getResourceById(db, resourceId);

  if (!resource) {
    return { canAccess: false, isOwner: false };
  }

  if (resource.owner_id === userId) {
    return { canAccess: true, isOwner: true, permission: 'admin' };
  }

  const drizzle = getDb(db);

  // Find accounts the user is a member of
  const accountIds = await resolveAccessibleAccountIds(db, userId, { activeOnly: true });

  const access = await drizzle.select({ permission: resourceAccess.permission })
    .from(resourceAccess)
    .where(and(
      eq(resourceAccess.resourceId, resourceId),
      inArray(resourceAccess.accountId, accountIds),
    ))
    .get();

  if (!access) {
    return { canAccess: false, isOwner: false };
  }

  if (!isResourcePermission(access.permission)) {
    return { canAccess: false, isOwner: false };
  }

  const permission = access.permission;

  if (!requiredPermissions || requiredPermissions.length === 0) {
    return { canAccess: true, isOwner: false, permission };
  }

  return {
    canAccess: requiredPermissions.includes(permission),
    isOwner: false,
    permission,
  };
}
