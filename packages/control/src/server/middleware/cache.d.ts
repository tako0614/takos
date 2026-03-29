import type { Context, MiddlewareHandler } from 'hono';
declare global {
    interface CacheStorage {
        readonly default: Cache;
    }
}
export interface CacheConfig {
    ttl: number;
    includeQueryParams?: boolean;
    queryParamsToInclude?: string[];
    cacheTag?: string;
    cacheKeyGenerator?: (c: Context) => string;
}
export declare const CacheTTL: {
    readonly PUBLIC_LISTING: 300;
    readonly SEARCH: 60;
    readonly PUBLIC_CONTENT: 600;
};
export declare const CacheTags: {
    readonly EXPLORE: "explore";
    readonly SEARCH: "search";
};
export declare function withCache(config: CacheConfig): MiddlewareHandler;
export declare function invalidateCache(urls: string[]): Promise<void>;
export declare function invalidateCacheOnMutation(urlGenerators: Array<(c: Context) => string | string[]>): MiddlewareHandler;
//# sourceMappingURL=cache.d.ts.map