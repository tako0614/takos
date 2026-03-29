/**
 * Centralized Cloudflare Management API client.
 *
 * All direct calls to `api.cloudflare.com` should go through this client
 * to ensure consistent auth, timeout, error handling, and retry logic.
 *
 * Timeout: delegates to the shared withTimeout utility (shared/utils/with-timeout)
 * and converts timeout errors to CloudflareAPIError for retry metadata.
 *
 * Error handling: uses CloudflareAPIError / classifyAPIError from wfp/client.ts,
 * intentionally separate from the generic ServiceCallError in
 * shared/utils/service-client.ts (see that file's doc comment for rationale).
 */
import { type CFAPIResponse } from '../wfp/client';
export interface CloudflareApiConfig {
    accountId: string;
    apiToken: string;
    zoneId?: string;
}
/**
 * Generic Cloudflare REST API client (account-level + zone-level).
 * Unlike WfpClient, this does not require a dispatch namespace.
 */
export declare class CloudflareApiClient {
    private config;
    constructor(config: CloudflareApiConfig);
    /**
     * Delegates to the shared withTimeout utility, re-throwing timeouts as
     * CloudflareAPIError (via createTimeoutError) to preserve the isRetryable
     * flag expected by callers.
     */
    private withTimeout;
    get accountId(): string;
    get zoneId(): string | undefined;
    /**
     * JSON API call — parses response as CFAPIResponse<T>.
     */
    fetch<T>(path: string, options?: RequestInit, timeoutMs?: number): Promise<CFAPIResponse<T>>;
    /**
     * Raw fetch (for endpoints that return non-JSON, e.g. KV values).
     */
    fetchRaw(path: string, options?: RequestInit, timeoutMs?: number): Promise<Response>;
    /** GET /accounts/{accountId}/... */
    accountGet<T>(subpath: string, timeoutMs?: number): Promise<T>;
    /** POST /accounts/{accountId}/... */
    accountPost<T>(subpath: string, body?: unknown, timeoutMs?: number): Promise<T>;
    /** DELETE /accounts/{accountId}/... */
    accountDelete<T = unknown>(subpath: string, timeoutMs?: number): Promise<T>;
    /** POST /zones/{zoneId}/... */
    zonePost<T>(subpath: string, body?: unknown, timeoutMs?: number): Promise<T>;
    /** GET /zones/{zoneId}/... */
    zoneGet<T>(subpath: string, timeoutMs?: number): Promise<T>;
    /** DELETE /zones/{zoneId}/... */
    zoneDelete<T = unknown>(subpath: string, timeoutMs?: number): Promise<T>;
}
export declare function createCloudflareApiClient(env: {
    CF_ACCOUNT_ID?: string;
    CF_API_TOKEN?: string;
    CF_ZONE_ID?: string;
}): CloudflareApiClient | null;
//# sourceMappingURL=api-client.d.ts.map