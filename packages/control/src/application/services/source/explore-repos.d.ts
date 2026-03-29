import type { Env } from '../../../shared/types';
import type { ExploreReposResult } from './explore-types';
export declare function listExploreRepos(dbBinding: Env['DB'], options: {
    sort: string;
    order: string;
    limit: number;
    offset: number;
    searchQuery: string;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    userId?: string;
}): Promise<ExploreReposResult>;
export declare function listTrendingRepos(dbBinding: Env['DB'], options: {
    limit: number;
    offset: number;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    userId?: string;
}): Promise<ExploreReposResult>;
export declare function listNewRepos(dbBinding: Env['DB'], options: {
    limit: number;
    offset: number;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    userId?: string;
}): Promise<ExploreReposResult>;
export declare function listRecentRepos(dbBinding: Env['DB'], options: {
    limit: number;
    offset: number;
    category?: string;
    language?: string;
    license?: string;
    since?: string;
    userId?: string;
}): Promise<ExploreReposResult>;
//# sourceMappingURL=explore-repos.d.ts.map