import type { D1Database } from "../../../shared/types/bindings.ts";
import {
  getDb,
  shortcutGroupItems,
  shortcutGroups,
} from "../../../infra/db/index.ts";
import { and, asc, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";

export interface ShortcutItem {
  type: "service" | "ui" | "d1" | "r2" | "kv" | "link";
  id: string;
  label: string;
  icon?: string;
  // Type-specific fields
  serviceId?: string;
  uiPath?: string;
  resourceId?: string;
  url?: string;
}

export interface ShortcutGroup {
  id: string;
  spaceId: string;
  name: string;
  icon?: string;
  items: ShortcutItem[];
  bundleDeploymentId?: string;
  createdAt: string;
  updatedAt: string;
}

interface CreateGroupInput {
  name: string;
  icon?: string;
  items?: ShortcutItem[];
}

interface UpdateGroupInput {
  name?: string;
  icon?: string;
  items?: ShortcutItem[];
}

function dbItemToShortcutItem(row: {
  id: string;
  type: string;
  label: string;
  icon: string | null;
  serviceId: string | null;
  uiPath: string | null;
  resourceId: string | null;
  url: string | null;
}): ShortcutItem {
  const type = row.type === "worker" ? "service" : row.type;
  return {
    type: type as ShortcutItem["type"],
    id: row.id,
    label: row.label,
    icon: row.icon || undefined,
    serviceId: row.serviceId || undefined,
    uiPath: row.uiPath || undefined,
    resourceId: row.resourceId || undefined,
    url: row.url || undefined,
  };
}

function mapGroup(g: {
  id: string;
  accountId: string;
  name: string;
  icon: string | null;
  bundleDeploymentId: string | null;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    type: string;
    label: string;
    icon: string | null;
    position: number;
    serviceId: string | null;
    uiPath: string | null;
    resourceId: string | null;
    url: string | null;
  }>;
}): ShortcutGroup {
  return {
    id: g.id,
    spaceId: g.accountId,
    name: g.name,
    icon: g.icon || undefined,
    items: g.items.slice().sort((a, b) => a.position - b.position).map(
      dbItemToShortcutItem,
    ),
    bundleDeploymentId: g.bundleDeploymentId || undefined,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
  };
}

async function fetchGroupWithItems(
  db: ReturnType<typeof getDb>,
  groupId: string,
) {
  const group = await db
    .select()
    .from(shortcutGroups)
    .where(eq(shortcutGroups.id, groupId))
    .get();
  if (!group) return null;

  const items = await db
    .select()
    .from(shortcutGroupItems)
    .where(eq(shortcutGroupItems.groupId, groupId))
    .orderBy(asc(shortcutGroupItems.position))
    .all();

  return { ...group, items };
}

export async function listShortcutGroups(
  d1: D1Database,
  spaceId: string,
): Promise<ShortcutGroup[]> {
  const db = getDb(d1);

  const groups = await db
    .select()
    .from(shortcutGroups)
    .where(eq(shortcutGroups.accountId, spaceId))
    .orderBy(asc(shortcutGroups.createdAt))
    .all();

  const result: ShortcutGroup[] = [];
  for (const group of groups) {
    const items = await db
      .select()
      .from(shortcutGroupItems)
      .where(eq(shortcutGroupItems.groupId, group.id))
      .orderBy(asc(shortcutGroupItems.position))
      .all();
    result.push(mapGroup({ ...group, items }));
  }

  return result;
}

export async function getShortcutGroup(
  d1: D1Database,
  spaceId: string,
  groupId: string,
): Promise<ShortcutGroup | null> {
  const db = getDb(d1);

  const group = await db
    .select()
    .from(shortcutGroups)
    .where(
      and(
        eq(shortcutGroups.id, groupId),
        eq(shortcutGroups.accountId, spaceId),
      ),
    )
    .get();

  if (!group) return null;

  const items = await db
    .select()
    .from(shortcutGroupItems)
    .where(eq(shortcutGroupItems.groupId, groupId))
    .orderBy(asc(shortcutGroupItems.position))
    .all();

  return mapGroup({ ...group, items });
}

export async function createShortcutGroup(
  d1: D1Database,
  spaceId: string,
  input: CreateGroupInput,
): Promise<ShortcutGroup> {
  const db = getDb(d1);

  const id = nanoid();
  const items = input.items || [];

  // Ensure each item has an id
  const itemsWithIds = items.map((item, i) => ({
    ...item,
    id: item.id || nanoid(),
    position: i,
  }));

  const timestamp = new Date().toISOString();

  await db.insert(shortcutGroups).values({
    id,
    accountId: spaceId,
    name: input.name,
    icon: input.icon ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  if (itemsWithIds.length > 0) {
    await db.insert(shortcutGroupItems).values(
      itemsWithIds.map((item, i) => ({
        id: item.id,
        groupId: id,
        type: item.type,
        label: item.label,
        icon: item.icon ?? null,
        position: i,
        serviceId: item.serviceId ?? null,
        uiPath: item.uiPath ?? null,
        resourceId: item.resourceId ?? null,
        url: item.url ?? null,
      })),
    );
  }

  const created = await fetchGroupWithItems(db, id);
  return mapGroup(created!);
}

export async function updateShortcutGroup(
  d1: D1Database,
  spaceId: string,
  groupId: string,
  input: UpdateGroupInput,
): Promise<ShortcutGroup | null> {
  const db = getDb(d1);

  // Check ownership and ensure the group is not managed by a bundle deployment
  const existing = await db
    .select()
    .from(shortcutGroups)
    .where(
      and(
        eq(shortcutGroups.id, groupId),
        eq(shortcutGroups.accountId, spaceId),
        isNull(shortcutGroups.bundleDeploymentId),
      ),
    )
    .get();

  if (!existing) {
    return null;
  }

  const updateData: {
    name?: string;
    icon?: string | null;
    updatedAt?: string;
  } = {};

  if (input.name !== undefined) {
    updateData.name = input.name;
  }

  if (input.icon !== undefined) {
    updateData.icon = input.icon || null;
  }

  if (input.items !== undefined) {
    const itemsWithIds = input.items.map((item, i) => ({
      ...item,
      id: item.id || nanoid(),
      position: i,
    }));

    // Replace all items in the relation
    await db.delete(shortcutGroupItems).where(
      eq(shortcutGroupItems.groupId, groupId),
    );
    if (itemsWithIds.length > 0) {
      await db.insert(shortcutGroupItems).values(
        itemsWithIds.map((item, i) => ({
          id: item.id,
          groupId,
          type: item.type,
          label: item.label,
          icon: item.icon ?? null,
          position: i,
          serviceId: item.serviceId ?? null,
          uiPath: item.uiPath ?? null,
          resourceId: item.resourceId ?? null,
          url: item.url ?? null,
        })),
      );
    }
  }

  updateData.updatedAt = new Date().toISOString();

  await db
    .update(shortcutGroups)
    .set(updateData)
    .where(eq(shortcutGroups.id, groupId));

  const updated = await fetchGroupWithItems(db, groupId);
  return mapGroup(updated!);
}

export async function deleteShortcutGroup(
  d1: D1Database,
  spaceId: string,
  groupId: string,
): Promise<boolean> {
  const db = getDb(d1);

  // Check ownership and ensure the group is not managed by a bundle deployment
  const existing = await db
    .select()
    .from(shortcutGroups)
    .where(
      and(
        eq(shortcutGroups.id, groupId),
        eq(shortcutGroups.accountId, spaceId),
        isNull(shortcutGroups.bundleDeploymentId),
      ),
    )
    .get();

  if (!existing) {
    return false;
  }

  // Items deleted via CASCADE
  await db.delete(shortcutGroups).where(eq(shortcutGroups.id, groupId));

  return true;
}

export async function addItemToGroup(
  d1: D1Database,
  spaceId: string,
  groupId: string,
  item: Omit<ShortcutItem, "id">,
): Promise<ShortcutItem | null> {
  const db = getDb(d1);

  const group = await db
    .select()
    .from(shortcutGroups)
    .where(
      and(
        eq(shortcutGroups.id, groupId),
        eq(shortcutGroups.accountId, spaceId),
        isNull(shortcutGroups.bundleDeploymentId),
      ),
    )
    .get();

  if (!group) return null;

  const existingItems = await db
    .select()
    .from(shortcutGroupItems)
    .where(eq(shortcutGroupItems.groupId, groupId))
    .all();

  const newItem: ShortcutItem = {
    ...item,
    id: nanoid(),
  };

  const maxPosition = existingItems.reduce(
    (max, i) => Math.max(max, i.position),
    -1,
  );

  await db.insert(shortcutGroupItems).values({
    id: newItem.id,
    groupId,
    type: newItem.type,
    label: newItem.label,
    icon: newItem.icon ?? null,
    position: maxPosition + 1,
    serviceId: newItem.serviceId ?? null,
    uiPath: newItem.uiPath ?? null,
    resourceId: newItem.resourceId ?? null,
    url: newItem.url ?? null,
  });

  await db
    .update(shortcutGroups)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(shortcutGroups.id, groupId));

  return newItem;
}

export async function removeItemFromGroup(
  d1: D1Database,
  spaceId: string,
  groupId: string,
  itemId: string,
): Promise<boolean> {
  const db = getDb(d1);

  const group = await db
    .select()
    .from(shortcutGroups)
    .where(
      and(
        eq(shortcutGroups.id, groupId),
        eq(shortcutGroups.accountId, spaceId),
        isNull(shortcutGroups.bundleDeploymentId),
      ),
    )
    .get();

  if (!group) return false;

  const itemToDelete = await db
    .select()
    .from(shortcutGroupItems)
    .where(
      and(
        eq(shortcutGroupItems.id, itemId),
        eq(shortcutGroupItems.groupId, groupId),
      ),
    )
    .get();

  if (!itemToDelete) {
    return false;
  }

  await db.delete(shortcutGroupItems).where(
    and(
      eq(shortcutGroupItems.id, itemId),
      eq(shortcutGroupItems.groupId, groupId),
    ),
  );

  await db
    .update(shortcutGroups)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(shortcutGroups.id, groupId));

  return true;
}
