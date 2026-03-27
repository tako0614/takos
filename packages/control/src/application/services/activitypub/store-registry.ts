/**
 * Store Registry Service — manages remote ActivityPub stores known to this instance.
 * Each workspace can register remote stores and switch between them.
 */

import { and, eq, desc } from 'drizzle-orm';
import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb, storeRegistry, storeRegistryUpdates } from '../../../infra/db';
import { generateId, now } from '../../../shared/utils';
import {
  resolveStoreViaWebFinger,
  fetchRemoteStoreActor,
  type RemoteStoreActor,
} from './remote-store-client';

export interface StoreRegistryEntry {
  id: string;
  accountId: string;
  actorUrl: string;
  domain: string;
  storeSlug: string;
  name: string;
  summary: string | null;
  iconUrl: string | null;
  publicKeyPem: string | null;
  repositoriesUrl: string | null;
  searchUrl: string | null;
  outboxUrl: string | null;
  isActive: boolean;
  subscriptionEnabled: boolean;
  lastFetchedAt: string | null;
  lastOutboxCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddRemoteStoreInput {
  /** Store identifier: "slug@domain" or full AP actor URL */
  identifier: string;
  /** Activate immediately */
  setActive?: boolean;
  /** Enable outbox subscription */
  subscribe?: boolean;
}

function rowToEntry(row: typeof storeRegistry.$inferSelect): StoreRegistryEntry {
  return {
    id: row.id,
    accountId: row.accountId,
    actorUrl: row.actorUrl,
    domain: row.domain,
    storeSlug: row.storeSlug,
    name: row.name,
    summary: row.summary ?? null,
    iconUrl: row.iconUrl ?? null,
    publicKeyPem: row.publicKeyPem ?? null,
    repositoriesUrl: row.repositoriesUrl ?? null,
    searchUrl: row.searchUrl ?? null,
    outboxUrl: row.outboxUrl ?? null,
    isActive: !!row.isActive,
    subscriptionEnabled: !!row.subscriptionEnabled,
    lastFetchedAt: row.lastFetchedAt ?? null,
    lastOutboxCheckedAt: row.lastOutboxCheckedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function actorToInsertValues(
  id: string,
  accountId: string,
  domain: string,
  storeSlug: string,
  actor: RemoteStoreActor,
  options: { setActive?: boolean; subscribe?: boolean },
) {
  const timestamp = now();
  return {
    id,
    accountId,
    actorUrl: actor.id,
    domain,
    storeSlug,
    name: actor.name || storeSlug,
    summary: actor.summary || null,
    iconUrl: actor.icon?.url || null,
    publicKeyPem: actor.publicKey?.publicKeyPem || null,
    repositoriesUrl: actor.repositories || null,
    searchUrl: actor.repositorySearch || null,
    outboxUrl: actor.outbox || null,
    isActive: options.setActive ?? false,
    subscriptionEnabled: options.subscribe ?? false,
    lastFetchedAt: timestamp,
    lastOutboxCheckedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/**
 * Add a remote store to the workspace's registry.
 * Resolves via WebFinger, fetches the actor, and persists.
 */
export async function addRemoteStore(
  dbBinding: D1Database,
  accountId: string,
  input: AddRemoteStoreInput,
): Promise<StoreRegistryEntry> {
  // 1. Resolve via WebFinger
  const { actorUrl, domain, storeSlug } = await resolveStoreViaWebFinger(input.identifier);

  // 2. Check for duplicates
  const db = getDb(dbBinding);
  const existing = await db.select({ id: storeRegistry.id })
    .from(storeRegistry)
    .where(and(
      eq(storeRegistry.accountId, accountId),
      eq(storeRegistry.actorUrl, actorUrl),
    ))
    .limit(1)
    .get();

  if (existing) {
    throw new Error(`Store "${input.identifier}" is already registered`);
  }

  // 3. Fetch the actor
  const actor = await fetchRemoteStoreActor(actorUrl);

  // 4. If setting active, deactivate others
  if (input.setActive) {
    await db.update(storeRegistry)
      .set({ isActive: false, updatedAt: now() })
      .where(and(eq(storeRegistry.accountId, accountId), eq(storeRegistry.isActive, true)));
  }

  // 5. Insert
  const id = generateId();
  const values = actorToInsertValues(id, accountId, domain, storeSlug, actor, input);
  await db.insert(storeRegistry).values(values);

  return rowToEntry({
    ...values,
    lastOutboxCheckedAt: null,
  } as typeof storeRegistry.$inferSelect);
}

/**
 * List all registered remote stores for a workspace.
 */
export async function listRegisteredStores(
  dbBinding: D1Database,
  accountId: string,
): Promise<StoreRegistryEntry[]> {
  const db = getDb(dbBinding);
  const rows = await db.select()
    .from(storeRegistry)
    .where(eq(storeRegistry.accountId, accountId))
    .orderBy(desc(storeRegistry.isActive), storeRegistry.name)
    .all();

  return rows.map(rowToEntry);
}

/**
 * Get a single registry entry by ID.
 */
export async function getRegistryEntry(
  dbBinding: D1Database,
  accountId: string,
  entryId: string,
): Promise<StoreRegistryEntry | null> {
  const db = getDb(dbBinding);
  const row = await db.select()
    .from(storeRegistry)
    .where(and(
      eq(storeRegistry.id, entryId),
      eq(storeRegistry.accountId, accountId),
    ))
    .limit(1)
    .get();

  return row ? rowToEntry(row) : null;
}

/**
 * Remove a remote store from the registry.
 */
export async function removeRemoteStore(
  dbBinding: D1Database,
  accountId: string,
  entryId: string,
): Promise<boolean> {
  const db = getDb(dbBinding);
  const existing = await db.select({ id: storeRegistry.id })
    .from(storeRegistry)
    .where(and(
      eq(storeRegistry.id, entryId),
      eq(storeRegistry.accountId, accountId),
    ))
    .limit(1)
    .get();

  if (!existing) return false;

  // Delete associated updates first, then the registry entry
  await db.delete(storeRegistryUpdates).where(eq(storeRegistryUpdates.registryEntryId, entryId));
  await db.delete(storeRegistry).where(eq(storeRegistry.id, entryId));
  return true;
}

/**
 * Set a remote store as the active store for browsing.
 * Deactivates all other stores for this workspace.
 */
export async function setActiveStore(
  dbBinding: D1Database,
  accountId: string,
  entryId: string | null,
): Promise<void> {
  const db = getDb(dbBinding);
  const timestamp = now();

  // Deactivate all
  await db.update(storeRegistry)
    .set({ isActive: false, updatedAt: timestamp })
    .where(and(eq(storeRegistry.accountId, accountId), eq(storeRegistry.isActive, true)));

  // Activate the specified one
  if (entryId) {
    await db.update(storeRegistry)
      .set({ isActive: true, updatedAt: timestamp })
      .where(and(
        eq(storeRegistry.id, entryId),
        eq(storeRegistry.accountId, accountId),
      ));
  }
}

/**
 * Re-fetch a remote store's actor data and update the registry.
 */
export async function refreshRemoteStore(
  dbBinding: D1Database,
  accountId: string,
  entryId: string,
): Promise<StoreRegistryEntry | null> {
  const db = getDb(dbBinding);
  const existing = await db.select()
    .from(storeRegistry)
    .where(and(
      eq(storeRegistry.id, entryId),
      eq(storeRegistry.accountId, accountId),
    ))
    .limit(1)
    .get();

  if (!existing) return null;

  const actor = await fetchRemoteStoreActor(existing.actorUrl);
  const timestamp = now();

  const updates = {
    name: actor.name || existing.name,
    summary: actor.summary || null,
    iconUrl: actor.icon?.url || null,
    publicKeyPem: actor.publicKey?.publicKeyPem || null,
    repositoriesUrl: actor.repositories || null,
    searchUrl: actor.repositorySearch || null,
    outboxUrl: actor.outbox || null,
    lastFetchedAt: timestamp,
    updatedAt: timestamp,
  };

  await db.update(storeRegistry)
    .set(updates)
    .where(eq(storeRegistry.id, entryId));

  return rowToEntry({
    ...existing,
    ...updates,
  } as typeof storeRegistry.$inferSelect);
}

/**
 * Toggle subscription for outbox polling.
 */
export async function setSubscription(
  dbBinding: D1Database,
  accountId: string,
  entryId: string,
  enabled: boolean,
): Promise<boolean> {
  const db = getDb(dbBinding);
  const existing = await db.select({ id: storeRegistry.id })
    .from(storeRegistry)
    .where(and(
      eq(storeRegistry.id, entryId),
      eq(storeRegistry.accountId, accountId),
    ))
    .limit(1)
    .get();

  if (!existing) return false;

  await db.update(storeRegistry)
    .set({ subscriptionEnabled: enabled, updatedAt: now() })
    .where(eq(storeRegistry.id, entryId));

  return true;
}

/**
 * Get all store entries with subscription enabled (for polling worker).
 */
export async function listSubscribedStores(
  dbBinding: D1Database,
): Promise<StoreRegistryEntry[]> {
  const db = getDb(dbBinding);
  const rows = await db.select()
    .from(storeRegistry)
    .where(eq(storeRegistry.subscriptionEnabled, true))
    .all();

  return rows.map(rowToEntry);
}

/**
 * Update the last outbox checked timestamp.
 */
export async function markOutboxChecked(
  dbBinding: D1Database,
  entryId: string,
): Promise<void> {
  const db = getDb(dbBinding);
  const timestamp = now();
  await db.update(storeRegistry)
    .set({ lastOutboxCheckedAt: timestamp, updatedAt: timestamp })
    .where(eq(storeRegistry.id, entryId));
}
