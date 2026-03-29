/**
 * Store Subscription Service — polls remote store outboxes for new activities
 * and caches them as updates for the subscribing workspace.
 */
import type { D1Database } from '../../../shared/types/bindings.ts';
import { type StoreRegistryEntry } from './store-registry';
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
export declare function pollAllSubscribedStores(dbBinding: D1Database): Promise<{
    polled: number;
    newUpdates: number;
}>;
/**
 * Poll a single remote store's outbox and save new activities.
 */
export declare function pollSingleStore(dbBinding: D1Database, entry: StoreRegistryEntry): Promise<number>;
/**
 * Get updates for a workspace, across all subscribed stores.
 */
export declare function getStoreUpdates(dbBinding: D1Database, accountId: string, options?: {
    unseenOnly?: boolean;
    limit?: number;
    offset?: number;
}): Promise<{
    total: number;
    items: StoreUpdate[];
}>;
/**
 * Mark specific updates as seen. Returns the number actually changed.
 */
export declare function markUpdatesSeen(dbBinding: D1Database, accountId: string, updateIds: string[]): Promise<number>;
/**
 * Mark all updates as seen for a workspace.
 */
export declare function markAllUpdatesSeen(dbBinding: D1Database, accountId: string): Promise<void>;
//# sourceMappingURL=store-subscription.d.ts.map