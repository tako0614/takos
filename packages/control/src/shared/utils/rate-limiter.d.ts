import type { Context, Next } from 'hono';
/**
 * Result of a sliding-window rate-limit check, indicating whether the
 * request is allowed and how many requests remain in the current window.
 */
export interface SlidingWindowResult {
    remaining: number;
    reset: number;
    total: number;
    allowed: boolean;
}
/**
 * Configuration for both sliding-window and token-bucket rate limiters.
 */
export interface SlidingWindowConfig {
    maxRequests: number;
    windowMs: number;
}
/**
 * Evaluate a sliding-window rate limit against a list of request timestamps.
 *
 * Returns the (possibly updated) timestamp list and the rate-limit verdict.
 * When `dryRun` is true the timestamp list is not mutated.
 */
export declare function hitSlidingWindow(timestamps: number[], config: SlidingWindowConfig, now?: number, dryRun?: boolean): {
    timestamps: number[];
    result: SlidingWindowResult;
};
/**
 * Remove entries whose timestamps have all expired outside the given window.
 * Entries with at least one valid timestamp are pruned to only valid ones.
 */
export declare function cleanupExpiredEntries(entries: Map<string, number[]>, windowMs: number, now?: number): void;
/**
 * Evict the oldest keys from a Map when its size exceeds `maxKeys`.
 * Returns the number of entries removed.
 */
export declare function enforceKeyLimit(entries: Map<string, number[]>, maxKeys: number): number;
export interface TokenBucketState {
    tokens: number;
    lastRefillMs: number;
}
export declare function hitTokenBucket(state: TokenBucketState | undefined, config: SlidingWindowConfig, now?: number, dryRun?: boolean): {
    state: TokenBucketState;
    result: SlidingWindowResult;
};
export interface RateLimitConfig {
    maxRequests: number;
    windowMs: number;
    keyGenerator?: (c: Context) => string;
    message?: string;
    skip?: (c: Context) => boolean;
}
export interface RateLimitInfo {
    remaining: number;
    reset: number;
    total: number;
}
export declare class InMemoryRateLimiter {
    private requests;
    private config;
    private lastCleanup;
    private static readonly MAX_KEYS;
    private static readonly CLEANUP_INTERVAL_MS;
    constructor(config: RateLimitConfig);
    private maybeCleanup;
    private checkKeyLimit;
    check(key: string): RateLimitInfo;
    hit(key: string): RateLimitInfo;
    middleware(): (c: Context, next: Next) => Promise<void | (Response & import("hono").TypedResponse<{
        error: string;
        retryAfter: number;
    }, 429, "json">)>;
    cleanup(): void;
}
export declare const RateLimiters: {
    auth: () => InMemoryRateLimiter;
    sensitive: () => InMemoryRateLimiter;
    oauthToken: () => InMemoryRateLimiter;
    oauthAuthorize: () => InMemoryRateLimiter;
    oauthRevoke: () => InMemoryRateLimiter;
    oauthRegister: () => InMemoryRateLimiter;
    oauthDeviceCode: () => InMemoryRateLimiter;
    oauthDeviceVerify: () => InMemoryRateLimiter;
};
//# sourceMappingURL=rate-limiter.d.ts.map