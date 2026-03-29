export declare class RateLimiterDO implements DurableObject {
    private state;
    private entries;
    private tokenBuckets;
    private lastCleanup;
    private static readonly CLEANUP_INTERVAL_MS;
    private static readonly MAX_KEYS;
    constructor(state: DurableObjectState);
    private persist;
    private maybeCleanup;
    /**
     * Enforce the key limit on both entries and tokenBuckets maps.
     * Uses try/catch to ensure that a failure in enforceKeyLimit() never
     * silently allows maps to grow unbounded -- if enforcement throws,
     * we fall back to a brute-force eviction of the oldest keys.
     */
    private checkKeyLimit;
    fetch(request: Request): Promise<Response>;
    private handleCheck;
    private handleHit;
    alarm(): Promise<void>;
    private handleReset;
}
//# sourceMappingURL=rate-limiter.d.ts.map