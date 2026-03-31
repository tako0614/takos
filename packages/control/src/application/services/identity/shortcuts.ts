import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb, shortcuts as shortcutsTable, services as servicesTable, resources as resourcesTable } from '../../../infra/db/index.ts';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { textDate } from '../../../shared/utils/db-guards.ts';

export const ALLOWED_SHORTCUT_RESOURCE_TYPES = ['service', 'resource', 'link'] as const;
export type ShortcutResourceType = (typeof ALLOWED_SHORTCUT_RESOURCE_TYPES)[number];

export interface ShortcutInput {
  name: string;
  resourceType: ShortcutResourceType;
  resourceId: string;
  icon?: string;
}

export interface ShortcutUpdateInput {
  name?: string;
  icon?: string;
  position?: number;
}

export interface ShortcutResponse {
  id: string;
  user_id: string;
  space_id: string;
  resource_type: string;
  resource_id: string;
  name: string;
  icon: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  // Joined fields
  service_hostname?: string | null;
  service_status?: string | null;
  resource_name?: string | null;
  resource_type_name?: string | null;
}

export function generateShortcutId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(36)).join('');
}

export function isShortcutResourceType(value: string): value is ShortcutResourceType {
  return ALLOWED_SHORTCUT_RESOURCE_TYPES.includes(value as ShortcutResourceType);
}

function toApiShortcut(s: {
  id: string;
  userAccountId: string;
  accountId: string;
  resourceType: string;
  resourceId: string;
  name: string;
  icon: string | null;
  position: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}, extra?: {
  serviceHostname?: string | null;
  serviceStatus?: string | null;
  resourceName?: string | null;
  resourceTypeName?: string | null;
}): ShortcutResponse {
  return {
    id: s.id,
    user_id: s.userAccountId,
    space_id: s.accountId,
    resource_type: s.resourceType,
    resource_id: s.resourceId,
    name: s.name,
    icon: s.icon,
    position: s.position,
    created_at: textDate(s.createdAt),
    updated_at: textDate(s.updatedAt),
    service_hostname: extra?.serviceHostname,
    service_status: extra?.serviceStatus,
    resource_name: extra?.resourceName,
    resource_type_name: extra?.resourceTypeName,
  };
}

export async function listShortcuts(db: D1Database, userId: string, spaceId: string): Promise<ShortcutResponse[]> {
  const drizzle = getDb(db);

  const rows = await drizzle.select().from(shortcutsTable).where(and(eq(shortcutsTable.userAccountId, userId), eq(shortcutsTable.accountId, spaceId))).orderBy(asc(shortcutsTable.position), asc(shortcutsTable.createdAt)).all();

  // Collect resource IDs for batch lookup
  const serviceIds: string[] = [];
  const resourceIds: string[] = [];

  for (const s of rows) {
    if (s.resourceType === 'service' || s.resourceType === 'worker') {
      serviceIds.push(s.resourceId);
    } else if (s.resourceType === 'resource') {
      resourceIds.push(s.resourceId);
    }
  }

  // Batch fetch services
  const services = serviceIds.length > 0
    ? await drizzle.select({ id: servicesTable.id, hostname: servicesTable.hostname, status: servicesTable.status }).from(servicesTable).where(inArray(servicesTable.id, serviceIds)).all()
    : [];
  const serviceMap = new Map(services.map((service) => [service.id, service]));

  // Batch fetch resources
  const resources = resourceIds.length > 0
    ? await drizzle.select({ id: resourcesTable.id, name: resourcesTable.name, type: resourcesTable.type }).from(resourcesTable).where(inArray(resourcesTable.id, resourceIds)).all()
    : [];
  const resourceMap = new Map(resources.map(r => [r.id, r]));

  return rows.map(s => {
    const extra: {
      serviceHostname?: string | null;
      serviceStatus?: string | null;
      resourceName?: string | null;
      resourceTypeName?: string | null;
    } = {};

    const resourceType = s.resourceType === 'worker' ? 'service' : s.resourceType;

    if (resourceType === 'service') {
      const service = serviceMap.get(s.resourceId);
      if (service) {
        extra.serviceHostname = service.hostname;
        extra.serviceStatus = service.status;
      }
    } else if (s.resourceType === 'resource') {
      const resource = resourceMap.get(s.resourceId);
      if (resource) {
        extra.resourceName = resource.name;
        extra.resourceTypeName = resource.type;
      }
    }

    return toApiShortcut({
      ...s,
      resourceType,
    }, extra);
  });
}

export async function createShortcut(
  db: D1Database,
  userId: string,
  spaceId: string,
  input: ShortcutInput
): Promise<ShortcutResponse> {
  if (!isShortcutResourceType(input.resourceType)) {
    throw new Error(`Invalid shortcut resource type: ${input.resourceType}`);
  }

  const drizzle = getDb(db);
  const id = generateShortcutId();
  const timestamp = new Date().toISOString();

  const shortcut = await drizzle.insert(shortcutsTable).values({
    id,
    userAccountId: userId,
    accountId: spaceId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    name: input.name,
    icon: input.icon || null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).returning().get();

  return toApiShortcut(shortcut);
}

export async function updateShortcut(
  db: D1Database,
  userId: string,
  spaceId: string,
  id: string,
  updates: ShortcutUpdateInput
): Promise<boolean> {
  const drizzle = getDb(db);

  const data: {
    name?: string;
    icon?: string;
    position?: number;
    updatedAt?: string;
  } = {};

  if (updates.name !== undefined) {
    data.name = updates.name;
  }
  if (updates.icon !== undefined) {
    data.icon = updates.icon;
  }
  if (updates.position !== undefined) {
    data.position = updates.position;
  }

  if (Object.keys(data).length === 0) {
    return false;
  }

  data.updatedAt = new Date().toISOString();

  await drizzle.update(shortcutsTable).set(data).where(and(eq(shortcutsTable.id, id), eq(shortcutsTable.userAccountId, userId), eq(shortcutsTable.accountId, spaceId)));

  return true;
}

export async function deleteShortcut(db: D1Database, userId: string, spaceId: string, id: string): Promise<void> {
  const drizzle = getDb(db);

  await drizzle.delete(shortcutsTable).where(and(eq(shortcutsTable.id, id), eq(shortcutsTable.userAccountId, userId), eq(shortcutsTable.accountId, spaceId)));
}

export async function reorderShortcuts(
  db: D1Database,
  userId: string,
  spaceId: string,
  orderedIds: string[],
): Promise<void> {
  if (orderedIds.length === 0) return;

  const timestamp = new Date().toISOString();
  const statements = orderedIds.map((id, position) =>
    db.prepare(
      'UPDATE shortcuts SET position = ?, updated_at = ? WHERE id = ? AND user_account_id = ? AND account_id = ?'
    ).bind(position, timestamp, id, userId, spaceId)
  );

  await db.batch(statements);
}
