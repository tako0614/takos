/**
 * Tenant worker resource limit configuration, read from environment variables.
 */
export type TenantResourceLimits = {
    /** Request timeout in milliseconds. Default: 30000 (30s). */
    cpuTimeoutMs: number;
    /** Maximum subrequests (fetch calls) per request. Default: 50. 0 = unlimited. */
    maxSubrequests: number;
    /** Maximum incoming request body size in bytes. Default: 1MB. */
    maxRequestSize: number;
    /** Maximum response body size in bytes. Default: 25MB. */
    maxResponseSize: number;
};
export declare function parseTenantResourceLimits(): TenantResourceLimits;
//# sourceMappingURL=tenant-resource-limits.d.ts.map