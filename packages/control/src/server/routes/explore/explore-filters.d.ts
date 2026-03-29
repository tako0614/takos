import type { Database } from '../../../infra/db';
export interface ReleaseAsset {
    id: string;
    name: string;
    content_type: string;
    size: number;
    r2_key: string;
    download_count: number;
    bundle_format?: string;
    bundle_meta?: {
        name?: string;
        app_id?: string;
        version: string;
        description?: string;
        icon?: string;
        category?: 'app' | 'service' | 'library' | 'template' | 'social';
        tags?: string[];
        dependencies?: Array<{
            repo: string;
            version: string;
        }>;
    };
    created_at: string;
}
export type RepoByNameLookup = {
    id: string;
    name: string;
    description: string | null;
    visibility: string;
    default_branch: string;
    stars: number;
    forks: number;
    created_at: string;
    updated_at: string;
    space_id: string;
    workspace_name: string;
    owner_id: string;
    owner_name: string;
    owner_username: string;
    owner_avatar_url: string | null;
};
export interface ExploreFilterParams {
    category: string | undefined;
    language: string | undefined;
    license: string | undefined;
    since: string | undefined;
}
export declare const EXPLORE_CATEGORIES: readonly ["app", "service", "library", "template", "social"];
export declare const CATEGORY_FILTER_OPTS: {
    readonly maxLen: 32;
    readonly pattern: RegExp;
};
export declare const LANG_LICENSE_FILTER_OPTS: {
    readonly maxLen: 64;
    readonly pattern: RegExp;
};
export declare function normalizeSimpleFilter(value: string | undefined, opts: {
    maxLen: number;
    pattern: RegExp;
}): string | undefined;
export declare function parseSinceDateToIsoStart(value: string | undefined): string | undefined;
export declare function parseExploreFilters(c: {
    req: {
        query: (key: string) => string | undefined;
    };
}): ExploreFilterParams;
export declare function validateExploreFilters(c: {
    req: {
        query: (key: string) => string | undefined;
    };
}, filters: ExploreFilterParams): void;
export declare function parseTags(tagsRaw: string | undefined): string[];
export declare function findRepoByUsernameAndName(db: Database, username: string, repoName: string): Promise<RepoByNameLookup>;
export declare function buildCatalogSuggestions(db: Database, q: string, limit: number): Promise<{
    users: {
        username: string;
        name: string;
        avatar_url: string | null;
    }[];
    repos: {
        id: string;
        name: string;
        description: string | null;
        stars: number;
        updated_at: string;
        owner: {
            username: string;
            name: string | null;
            avatar_url: string | null;
        };
    }[];
}>;
export declare function loadReleasesWithAssets(db: Database, repoId: string, opts?: {
    includePrerelease?: boolean;
    limit?: number;
}): Promise<{
    repoReleaseAssets: {
        createdAt: string;
        id: string;
        releaseId: string;
        assetKey: string;
        name: string;
        contentType: string | null;
        sizeBytes: number | null;
        checksumSha256: string | null;
        downloadCount: number;
        bundleFormat: string | null;
        bundleMetaJson: string | null;
    }[];
    updatedAt: string;
    createdAt: string;
    id: string;
    repoId: string;
    tag: string;
    name: string | null;
    description: string | null;
    commitSha: string | null;
    isPrerelease: boolean;
    isDraft: boolean;
    downloads: number;
    authorAccountId: string | null;
    publishedAt: string | null;
}[]>;
//# sourceMappingURL=explore-filters.d.ts.map