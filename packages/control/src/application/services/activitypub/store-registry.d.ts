/**
 * Store Registry Service — manages remote ActivityPub stores known to this instance.
 * Each workspace can register remote stores and switch between them.
 */
import type { D1Database } from '../../../shared/types/bindings.ts';
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
/**
 * Add a remote store to the workspace's registry.
 * Resolves via WebFinger, fetches the actor, and persists.
 */
export declare function addRemoteStore(dbBinding: D1Database, accountId: string, input: AddRemoteStoreInput): Promise<StoreRegistryEntry>;
/**
 * List all registered remote stores for a workspace.
 */
export declare function listRegisteredStores(dbBinding: D1Database, accountId: string): Promise<StoreRegistryEntry[]>;
/**
 * Get a single registry entry by ID.
 */
export declare function getRegistryEntry(dbBinding: D1Database, accountId: string, entryId: string): Promise<StoreRegistryEntry | null>;
/**
 * Remove a remote store from the registry.
 */
export declare function removeRemoteStore(dbBinding: D1Database, accountId: string, entryId: string): Promise<boolean>;
/**
 * Set a remote store as the active store for browsing.
 * Deactivates all other stores for this workspace.
 */
export declare function setActiveStore(dbBinding: D1Database, accountId: string, entryId: string | null): Promise<void>;
/**
 * Re-fetch a remote store's actor data and update the registry.
 */
export declare function refreshRemoteStore(dbBinding: D1Database, accountId: string, entryId: string): Promise<StoreRegistryEntry | null>;
/**
 * Toggle subscription for outbox polling.
 */
export declare function setSubscription(dbBinding: D1Database, accountId: string, entryId: string, enabled: boolean): Promise<boolean>;
/**
 * Get all store entries with subscription enabled (for polling worker).
 */
export declare function listSubscribedStores(dbBinding: D1Database): Promise<StoreRegistryEntry[]>;
/**
 * Update the last outbox checked timestamp.
 */
export declare function markOutboxChecked(dbBinding: D1Database, entryId: string): Promise<void>;
//# sourceMappingURL=store-registry.d.ts.map