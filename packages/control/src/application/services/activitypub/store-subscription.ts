/**
 * Store Subscription Service — polls remote store outboxes for new activities
 * and caches them as updates for the subscribing workspace.
 */

import { and, count as countFn, desc, eq } from "drizzle-orm";
import type { D1Database } from "../../../shared/types/bindings.ts";
import {
  getDb,
  storeRegistry,
  storeRegistryUpdates,
} from "../../../infra/db/index.ts";
import { generateId } from "../../../shared/utils/index.ts";
import {
  fetchRemoteOutbox,
  fetchRemoteRepositoryActor,
  type RemoteRepository,
} from "./remote-store-client.ts";
import {
  listSubscribedStores,
  markOutboxChecked,
  type StoreRegistryEntry,
} from "./store-registry.ts";
import { logError } from "../../../shared/utils/logger.ts";

export interface StoreUpdate {
  id: string;
  registryEntryId: string;
  storeName: string;
  storeDomain: string;
  activityId: string;
  activityType: string;
  objectId: string;
  objectType: string | null;
  objectName: string | null;
  objectSummary: string | null;
  published: string | null;
  seen: boolean;
  createdAt: string;
}

/**
 * Poll all subscribed remote stores for new outbox activities.
 * Intended to be called by a scheduled worker (cron).
 */
export async function pollAllSubscribedStores(
  dbBinding: D1Database,
): Promise<{ polled: number; newUpdates: number }> {
  const entries = await listSubscribedStores(dbBinding);
  let totalNew = 0;

  for (const entry of entries) {
    try {
      const count = await pollSingleStore(dbBinding, entry);
      totalNew += count;
    } catch (err) {
      logError("Failed to poll remote store", err, {
        module: "store-subscription",
        storeId: entry.id,
        domain: entry.domain,
      });
    }
  }

  return { polled: entries.length, newUpdates: totalNew };
}

/**
 * Poll a single remote store's outbox and save new activities.
 */
export async function pollSingleStore(
  dbBinding: D1Database,
  entry: StoreRegistryEntry,
): Promise<number> {
  if (!entry.outboxUrl) {
    return 0;
  }

  // Fetch the first page of the outbox (preserves activity wrapper)
  const result = await fetchRemoteOutbox(entry.outboxUrl, {
    page: 1,
    limit: 50,
  });
  if (!result.activities || result.activities.length === 0) {
    await markOutboxChecked(dbBinding, entry.id);
    return 0;
  }

  const db = getDb(dbBinding);
  let newCount = 0;

  for (const activity of result.activities) {
    const activityId = activity.activityId;
    if (!activityId) continue;

    // Check if we already have this activity
    const existing = await db.select({ id: storeRegistryUpdates.id })
      .from(storeRegistryUpdates)
      .where(and(
        eq(storeRegistryUpdates.registryEntryId, entry.id),
        eq(storeRegistryUpdates.activityId, activityId),
      ))
      .limit(1)
      .get();

    if (existing) {
      continue;
    }

    const obj = await hydrateRepositoryReference(activity.object);
    const objectType = Array.isArray(obj.type)
      ? obj.type.join(",")
      : String(obj.type || "");

    await db.insert(storeRegistryUpdates).values({
      id: generateId(),
      registryEntryId: entry.id,
      accountId: entry.accountId,
      activityId,
      activityType: activity.activityType,
      objectId: obj.id,
      objectType,
      objectName: obj.name || null,
      objectSummary: obj.summary || null,
      published: activity.published || null,
      seen: false,
      rawJson: JSON.stringify(activity),
      createdAt: new Date().toISOString(),
    });
    newCount++;
  }

  await markOutboxChecked(dbBinding, entry.id);
  return newCount;
}

async function hydrateRepositoryReference(
  obj: RemoteRepository,
): Promise<RemoteRepository> {
  if (!obj.id || obj.name) return obj;
  try {
    const fetched = await fetchRemoteRepositoryActor(obj.id);
    return {
      ...obj,
      ...fetched,
      id: fetched.id || obj.id,
      url: fetched.url || obj.url,
      published: fetched.published || obj.published,
      updated: fetched.updated || obj.updated,
    };
  } catch {
    return obj;
  }
}

/**
 * Get updates for a workspace, across all subscribed stores.
 */
export async function getStoreUpdates(
  dbBinding: D1Database,
  accountId: string,
  options: { unseenOnly?: boolean; limit?: number; offset?: number } = {},
): Promise<{ total: number; items: StoreUpdate[] }> {
  const db = getDb(dbBinding);
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const baseWhere = options.unseenOnly
    ? and(
      eq(storeRegistryUpdates.accountId, accountId),
      eq(storeRegistryUpdates.seen, false),
    )
    : eq(storeRegistryUpdates.accountId, accountId);

  // Get total count with same JOIN as data query for consistency
  const [totalResult, rows] = await Promise.all([
    db.select({ count: countFn() })
      .from(storeRegistryUpdates)
      .innerJoin(
        storeRegistry,
        eq(storeRegistryUpdates.registryEntryId, storeRegistry.id),
      )
      .where(baseWhere)
      .get(),
    db.select({
      id: storeRegistryUpdates.id,
      registryEntryId: storeRegistryUpdates.registryEntryId,
      activityId: storeRegistryUpdates.activityId,
      activityType: storeRegistryUpdates.activityType,
      objectId: storeRegistryUpdates.objectId,
      objectType: storeRegistryUpdates.objectType,
      objectName: storeRegistryUpdates.objectName,
      objectSummary: storeRegistryUpdates.objectSummary,
      published: storeRegistryUpdates.published,
      seen: storeRegistryUpdates.seen,
      createdAt: storeRegistryUpdates.createdAt,
      storeName: storeRegistry.name,
      storeDomain: storeRegistry.domain,
    })
      .from(storeRegistryUpdates)
      .innerJoin(
        storeRegistry,
        eq(storeRegistryUpdates.registryEntryId, storeRegistry.id),
      )
      .where(baseWhere)
      .orderBy(desc(storeRegistryUpdates.createdAt))
      .limit(limit)
      .offset(offset)
      .all(),
  ]);

  return {
    total: totalResult?.count ?? 0,
    items: rows.map((row) => ({
      id: row.id,
      registryEntryId: row.registryEntryId,
      storeName: row.storeName,
      storeDomain: row.storeDomain,
      activityId: row.activityId,
      activityType: row.activityType,
      objectId: row.objectId,
      objectType: row.objectType ?? null,
      objectName: row.objectName ?? null,
      objectSummary: row.objectSummary ?? null,
      published: row.published ?? null,
      seen: !!row.seen,
      createdAt: row.createdAt,
    })),
  };
}

/**
 * Mark specific updates as seen. Returns the number actually changed.
 */
export async function markUpdatesSeen(
  dbBinding: D1Database,
  accountId: string,
  updateIds: string[],
): Promise<number> {
  if (updateIds.length === 0) return 0;

  const db = getDb(dbBinding);
  // Batch into a single query: mark seen where id IN (...) and accountId matches
  // Drizzle doesn't have inArray for all drivers, so iterate but don't fake count
  let changed = 0;
  for (const id of updateIds) {
    const row = await db.select({ id: storeRegistryUpdates.id })
      .from(storeRegistryUpdates)
      .where(and(
        eq(storeRegistryUpdates.id, id),
        eq(storeRegistryUpdates.accountId, accountId),
        eq(storeRegistryUpdates.seen, false),
      ))
      .limit(1)
      .get();

    if (row) {
      await db.update(storeRegistryUpdates)
        .set({ seen: true })
        .where(eq(storeRegistryUpdates.id, id));
      changed++;
    }
  }
  return changed;
}

/**
 * Mark all updates as seen for a workspace.
 */
export async function markAllUpdatesSeen(
  dbBinding: D1Database,
  accountId: string,
): Promise<void> {
  const db = getDb(dbBinding);
  await db.update(storeRegistryUpdates)
    .set({ seen: true })
    .where(and(
      eq(storeRegistryUpdates.accountId, accountId),
      eq(storeRegistryUpdates.seen, false),
    ));
}
