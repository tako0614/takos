import type { Env } from '../../../shared/types';
import type { SQL, SQLWrapper } from 'drizzle-orm';
import type { ExploreRepoResponse, ExploreReposResult, RepositoryWithAccount, ParsedCatalogTags } from './explore-types';
export declare const ALLOWED_ORDER_BY_COLUMNS: {
    readonly updated: "updatedAt";
    readonly created: "createdAt";
    readonly forks: "forks";
    readonly stars: "stars";
};
export declare function resolveOrderByColumn(sort: string): keyof typeof ALLOWED_ORDER_BY_COLUMNS | 'stars';
export declare function resolveOrderDirection(order: string): 'asc' | 'desc';
export declare function resolveAccountOwner(account: RepositoryWithAccount['account']): {
    id: string;
    name: string;
    username: string;
    avatar_url: string | null;
};
export declare function parseCatalogTags(raw: string | undefined): ParsedCatalogTags;
export declare function computeTrendingScore(options: {
    stars: number;
    downloads: number;
    updatedAtMs: number;
}): number;
export declare function getStarredRepoIds(dbBinding: Env['DB'], userId: string | undefined, repoIds: string[]): Promise<Set<string>>;
export declare function mapExploreRepos(repos: RepositoryWithAccount[], starredIds: Set<string>): ExploreRepoResponse[];
export declare function buildExploreResult(dbBinding: Env['DB'], repos: RepositoryWithAccount[], total: number, offset: number, userId?: string): Promise<ExploreReposResult>;
export declare function queryReposWithAccount(dbBinding: Env['DB'], options: {
    conditions: (SQLWrapper | undefined)[];
    orderBy: SQL[];
    limit?: number;
    offset?: number;
}): Promise<RepositoryWithAccount[]>;
export declare function countRepos(dbBinding: Env['DB'], conditions: (SQLWrapper | undefined)[]): Promise<number>;
export declare function buildBaseConditions(options: {
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    sinceField?: 'createdAt' | 'updatedAt';
    searchQuery?: string;
}): SQL[];
//# sourceMappingURL=source-exploration.d.ts.map