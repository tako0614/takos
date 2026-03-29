import type { Env } from '../../../shared/types';
export interface StoreRecord {
    accountId: string;
    accountSlug: string;
    slug: string;
    name: string;
    description: string | null;
    picture: string | null;
    createdAt: string;
    updatedAt: string;
    publicRepoCount: number;
    isDefault: boolean;
}
export interface StoreRepositoryRecord {
    id: string;
    ownerId: string;
    ownerSlug: string;
    ownerName: string;
    name: string;
    description: string | null;
    visibility: string;
    defaultBranch: string;
    stars: number;
    forks: number;
    gitEnabled: boolean;
    createdAt: string;
    updatedAt: string;
}
export declare function findStoreBySlug(env: Pick<Env, 'DB'>, storeSlug: string): Promise<StoreRecord | null>;
export declare function listStoreRepositories(env: Pick<Env, 'DB'>, storeSlug: string, options: {
    limit: number;
    offset: number;
}): Promise<{
    total: number;
    items: StoreRepositoryRecord[];
}>;
export declare function searchStoreRepositories(env: Pick<Env, 'DB'>, storeSlug: string, query: string, options: {
    limit: number;
    offset: number;
}): Promise<{
    total: number;
    items: StoreRepositoryRecord[];
}>;
export declare function findStoreRepository(env: Pick<Env, 'DB'>, storeSlug: string, ownerSlug: string, repoName: string): Promise<StoreRepositoryRecord | null>;
//# sourceMappingURL=activitypub-queries.d.ts.map