import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Database } from '../../../infra/db';
type TakopackRatingStats = {
    rating_avg: number | null;
    rating_count: number;
};
export declare function getTakopackRatingStats(_db: Database, repoIds: string[]): Promise<Map<string, TakopackRatingStats>>;
export declare function getTakopackRatingSummary(_db: Database, _repoId: string): Promise<TakopackRatingStats>;
export interface SearchPackagesParams {
    searchQuery: string;
    sortParamRaw: string;
    limit: number;
    offset: number;
    category: string | undefined;
    tags: string[];
    certifiedOnly: boolean;
}
export interface PackageDto {
    id: string;
    name: string;
    app_id: string;
    version: string;
    description: string | null;
    icon: string | undefined;
    category: string | undefined;
    tags: string[] | undefined;
    repository: {
        id: string;
        name: string;
        description: string | null;
        stars: number;
    };
    owner: {
        id: string;
        name: string;
        username: string;
        avatar_url: string | null;
    } | null;
    release: {
        id: string;
        tag: string;
        published_at: string | null;
    };
    asset: {
        id: string;
        name: string;
        size: number;
        download_count: number;
    };
    total_downloads: number;
    published_at: string | null;
    rating_avg: number | null;
    rating_count: number;
    publish_status: string;
    certified: boolean;
}
export interface SearchPackagesResult {
    packages: PackageDto[];
    has_more: boolean;
}
/**
 * Search, filter, sort, and paginate takopack packages.
 */
export declare function searchPackages(d1: D1Database, params: SearchPackagesParams): Promise<SearchPackagesResult>;
export interface SuggestPackageDto {
    id: string;
    name: string;
    app_id: string;
    version: string;
    description: string | null;
    icon: string | undefined;
    category: string | undefined;
    tags: string[] | undefined;
    repository: {
        id: string;
        name: string;
        description: string | null;
        stars: number;
    };
    owner: {
        id: string;
        name: string;
        username: string;
        avatar_url: string | null;
    } | null;
    release: {
        id: string;
        tag: string;
        published_at: string | null;
    };
    asset: {
        id: string;
        name: string;
        size: number;
        download_count: number;
    };
    total_downloads: number;
    published_at: string | null;
}
export interface SuggestPackagesParams {
    query: string;
    limit: number;
    category: string | undefined;
    tags: string[];
}
export declare function suggestPackages(d1: D1Database, params: SuggestPackagesParams): Promise<SuggestPackageDto[]>;
export {};
//# sourceMappingURL=explore-packages.d.ts.map