import type { D1Database } from '../../../shared/types/bindings.ts';
export interface ActivityPubStoreDefinition {
    accountId: string;
    accountSlug: string;
    slug: string;
    name: string;
    summary: string | null;
    iconUrl: string | null;
    createdAt: string;
    updatedAt: string;
    isDefault: boolean;
}
export interface UpsertActivityPubStoreInput {
    slug: string;
    name?: string | null;
    summary?: string | null;
    iconUrl?: string | null;
}
export declare function normalizeActivityPubStoreSlug(value: string): string;
export declare function listActivityPubStoresForWorkspace(dbBinding: D1Database, accountId: string): Promise<ActivityPubStoreDefinition[]>;
export declare function findActivityPubStoreBySlug(dbBinding: D1Database, storeSlug: string): Promise<ActivityPubStoreDefinition | null>;
export declare function createActivityPubStore(dbBinding: D1Database, accountId: string, input: UpsertActivityPubStoreInput): Promise<ActivityPubStoreDefinition>;
export declare function updateActivityPubStore(dbBinding: D1Database, accountId: string, storeSlug: string, input: Omit<UpsertActivityPubStoreInput, 'slug'>): Promise<ActivityPubStoreDefinition | null>;
export declare function deleteActivityPubStore(dbBinding: D1Database, accountId: string, storeSlug: string): Promise<boolean>;
//# sourceMappingURL=stores.d.ts.map