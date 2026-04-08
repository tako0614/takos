/**
 * Store Inventory Service — manages explicit repo references in a Store's inventory.
 * Each add/remove is recorded as an activity for the store outbox.
 */

import { and, count, desc, eq } from 'drizzle-orm';
import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb, storeInventoryItems } from '../../../infra/db/index.ts';
import { generateId } from '../../../shared/utils/index.ts';

export interface InventoryEntry {
  id: string;
  storeSlug: string;
  accountId: string;
  repoActorUrl: string;
  repoName: string | null;
  repoSummary: string | null;
  repoOwnerSlug: string | null;
  localRepoId: string | null;
  activityType: 'Add' | 'Remove';
  isActive: boolean;
  createdAt: string;
}

export interface AddToInventoryInput {
  accountId: string;
  storeSlug: string;
  repoActorUrl: string;
  repoName?: string;
  repoSummary?: string;
  repoOwnerSlug?: string;
  localRepoId?: string;
}

export async function addToInventory(
  dbBinding: D1Database,
  input: AddToInventoryInput,
): Promise<InventoryEntry> {
  const db = getDb(dbBinding);

  // Check for duplicate active entry
  const existing = await db.select({ id: storeInventoryItems.id })
    .from(storeInventoryItems)
    .where(and(
      eq(storeInventoryItems.accountId, input.accountId),
      eq(storeInventoryItems.storeSlug, input.storeSlug),
      eq(storeInventoryItems.repoActorUrl, input.repoActorUrl),
      eq(storeInventoryItems.isActive, true),
    ))
    .limit(1)
    .get();

  if (existing) {
    throw new Error('Repository is already in this store inventory');
  }

  const id = generateId();
  const timestamp = new Date().toISOString();

  const record = {
    id,
    storeSlug: input.storeSlug,
    accountId: input.accountId,
    repoActorUrl: input.repoActorUrl,
    repoName: input.repoName ?? null,
    repoSummary: input.repoSummary ?? null,
    repoOwnerSlug: input.repoOwnerSlug ?? null,
    localRepoId: input.localRepoId ?? null,
    activityType: 'Add' as const,
    isActive: true,
    createdAt: timestamp,
  };

  await db.insert(storeInventoryItems).values(record);
  return record;
}

/**
 * Look up a single active inventory entry by id, scoped to the owning space
 * (accountId) and store slug. Returns null when no matching active entry
 * exists. Used by the write API DELETE handler so it does not have to scan
 * the full inventory list.
 */
export async function findInventoryItemById(
  dbBinding: D1Database,
  accountId: string,
  storeSlug: string,
  itemId: string,
): Promise<InventoryEntry | null> {
  const db = getDb(dbBinding);
  const row = await db.select()
    .from(storeInventoryItems)
    .where(and(
      eq(storeInventoryItems.id, itemId),
      eq(storeInventoryItems.accountId, accountId),
      eq(storeInventoryItems.storeSlug, storeSlug),
      eq(storeInventoryItems.isActive, true),
    ))
    .limit(1)
    .get();
  return row ? toEntry(row) : null;
}

export async function removeFromInventory(
  dbBinding: D1Database,
  accountId: string,
  storeSlug: string,
  repoActorUrl: string,
): Promise<boolean> {
  const db = getDb(dbBinding);

  // Find and deactivate the active entry
  const existing = await db.select({ id: storeInventoryItems.id })
    .from(storeInventoryItems)
    .where(and(
      eq(storeInventoryItems.accountId, accountId),
      eq(storeInventoryItems.storeSlug, storeSlug),
      eq(storeInventoryItems.repoActorUrl, repoActorUrl),
      eq(storeInventoryItems.isActive, true),
    ))
    .limit(1)
    .get();

  if (!existing) return false;

  // Deactivate existing entry
  await db.update(storeInventoryItems)
    .set({ isActive: false })
    .where(eq(storeInventoryItems.id, existing.id));

  // Insert Remove activity record
  await db.insert(storeInventoryItems).values({
    id: generateId(),
    storeSlug,
    accountId,
    repoActorUrl,
    activityType: 'Remove',
    isActive: false,
    createdAt: new Date().toISOString(),
  });

  return true;
}

export async function listInventoryItems(
  dbBinding: D1Database,
  accountId: string,
  storeSlug: string,
  options: { limit: number; offset: number },
): Promise<{ total: number; items: InventoryEntry[] }> {
  const db = getDb(dbBinding);

  const [rows, totalResult] = await Promise.all([
    db.select()
      .from(storeInventoryItems)
      .where(and(
        eq(storeInventoryItems.accountId, accountId),
        eq(storeInventoryItems.storeSlug, storeSlug),
        eq(storeInventoryItems.isActive, true),
      ))
      .orderBy(desc(storeInventoryItems.createdAt))
      .limit(options.limit)
      .offset(options.offset)
      .all(),
    db.select({ count: count() })
      .from(storeInventoryItems)
      .where(and(
        eq(storeInventoryItems.accountId, accountId),
        eq(storeInventoryItems.storeSlug, storeSlug),
        eq(storeInventoryItems.isActive, true),
      ))
      .get(),
  ]);

  return {
    total: totalResult?.count ?? 0,
    items: rows.map(toEntry),
  };
}

export async function listInventoryActivities(
  dbBinding: D1Database,
  accountId: string,
  storeSlug: string,
  options: { limit: number; offset: number },
): Promise<{ total: number; items: InventoryEntry[] }> {
  const db = getDb(dbBinding);

  const [rows, totalResult] = await Promise.all([
    db.select()
      .from(storeInventoryItems)
      .where(and(
        eq(storeInventoryItems.accountId, accountId),
        eq(storeInventoryItems.storeSlug, storeSlug),
      ))
      .orderBy(desc(storeInventoryItems.createdAt))
      .limit(options.limit)
      .offset(options.offset)
      .all(),
    db.select({ count: count() })
      .from(storeInventoryItems)
      .where(and(
        eq(storeInventoryItems.accountId, accountId),
        eq(storeInventoryItems.storeSlug, storeSlug),
      ))
      .get(),
  ]);

  return {
    total: totalResult?.count ?? 0,
    items: rows.map(toEntry),
  };
}

export async function hasExplicitInventory(
  dbBinding: D1Database,
  accountId: string,
  storeSlug: string,
): Promise<boolean> {
  const db = getDb(dbBinding);
  const row = await db.select({ id: storeInventoryItems.id })
    .from(storeInventoryItems)
    .where(and(
      eq(storeInventoryItems.accountId, accountId),
      eq(storeInventoryItems.storeSlug, storeSlug),
    ))
    .limit(1)
    .get();
  return !!row;
}

export type StoreInventoryMode = 'explicit' | 'auto';

/**
 * Resolve which Store inventory mode to use for a given (space, store).
 *
 * Per docs/platform/store.md, the Store has two inventory modes:
 *   - `explicit`: only entries that have been explicitly registered via the
 *     inventory API are visible. The Store falls into this mode the moment
 *     at least one explicit entry exists.
 *   - `auto`: when no explicit entries exist, the Store can advertise the
 *     space's public repos automatically.
 *
 * The current implementation returns `explicit` whenever any inventory row
 * exists for the (space, slug) pair, otherwise `auto`. Auto-mode collection
 * of public repos is not yet wired into the inventory listing — callers
 * should treat `auto` as "no entries available yet" until the auto-collector
 * lands.
 */
export async function resolveInventoryMode(
  dbBinding: D1Database,
  accountId: string,
  storeSlug: string,
): Promise<StoreInventoryMode> {
  const explicit = await hasExplicitInventory(dbBinding, accountId, storeSlug);
  return explicit ? 'explicit' : 'auto';
}

export async function countActiveItems(
  dbBinding: D1Database,
  accountId: string,
  storeSlug: string,
): Promise<number> {
  const db = getDb(dbBinding);
  const result = await db.select({ count: count() })
    .from(storeInventoryItems)
    .where(and(
      eq(storeInventoryItems.accountId, accountId),
      eq(storeInventoryItems.storeSlug, storeSlug),
      eq(storeInventoryItems.isActive, true),
    ))
    .get();
  return result?.count ?? 0;
}

function toEntry(row: typeof storeInventoryItems.$inferSelect): InventoryEntry {
  return {
    id: row.id,
    storeSlug: row.storeSlug,
    accountId: row.accountId,
    repoActorUrl: row.repoActorUrl,
    repoName: row.repoName,
    repoSummary: row.repoSummary,
    repoOwnerSlug: row.repoOwnerSlug,
    localRepoId: row.localRepoId,
    activityType: row.activityType as 'Add' | 'Remove',
    isActive: !!row.isActive,
    createdAt: row.createdAt,
  };
}
