/**
 * WFP (Workers for Platforms) HTTP client and configuration.
 *
 * Provides the low-level authenticated HTTP transport for all Cloudflare API
 * calls made by the WFP module. Handles configuration resolution from
 * environment variables (CF_ACCOUNT_ID, CF_API_TOKEN, WFP_DISPATCH_NAMESPACE),
 * error classification with rate-limit / retry-after metadata, timeout
 * handling, and sensitive-data sanitisation of error messages.
 */
import type { Env } from '../../../shared/types';
export type WfpEnv = Pick<Env, 'CF_ACCOUNT_ID' | 'CF_API_TOKEN' | 'WFP_DISPATCH_NAMESPACE'>;
export declare const CF_API_BASE = "https://api.cloudflare.com/client/v4";
export interface WFPConfig {
    accountId: string;
    apiToken: string;
    dispatchNamespace: string;
}
export interface CFAPIResponse<T = unknown> {
    success: boolean;
    errors: Array<{
        code: number;
        message: string;
    }>;
    messages: string[];
    result: T;
}
export declare function resolveWfpConfig(env: WfpEnv): WFPConfig | null;
/**
 * C3: Extended error interface for Cloudflare API errors
 * Provides classification for rate limiting, retryable errors, etc.
 */
export interface CloudflareAPIError extends Error {
    /** HTTP status code */
    statusCode?: number;
    /** Cloudflare-specific error code */
    code?: number;
    /** Whether this is a rate limit (429) error */
    isRateLimited?: boolean;
    /** Whether this error can be retried (5xx, timeout, rate limit) */
    isRetryable?: boolean;
    /** Seconds to wait before retrying (from Retry-After header) */
    retryAfter?: number;
}
/**
 * S7 Fix: Sanitize error messages to remove sensitive information
 * Removes API tokens, credentials, and internal paths from error messages
 */
export declare function sanitizeErrorMessage(message: string): string;
/**
 * C3: Classify API errors based on response status and data
 * C5: Handles rate limiting (429) with Retry-After header extraction
 * S7 Fix: Sanitizes error messages to prevent sensitive information exposure
 */
export declare function classifyAPIError(response: Response, data?: CFAPIResponse): CloudflareAPIError;
/**
 * Create a CloudflareAPIError for timeout scenarios
 */
export declare function createTimeoutError(timeoutMs: number): CloudflareAPIError;
/**
 * WfpClient uses Cloudflare-specific error handling (classifyAPIError /
 * CloudflareAPIError) that carries rate-limit and retry metadata. This is
 * intentionally separate from the generic ServiceCallError / parseServiceResponse
 * in shared/utils/service-client.ts, which targets non-Cloudflare upstreams.
 *
 * The inline AbortController/setTimeout pattern mirrors the shared withTimeout
 * utility but is kept inline here because the AbortError catch must produce a
 * CloudflareAPIError (via createTimeoutError) rather than a plain Error.
 */
export declare class WfpClient {
    private config;
    constructor(config: WFPConfig);
    fetch<T>(path: string, options?: RequestInit, timeoutMs?: number): Promise<CFAPIResponse<T>>;
}
export declare function createWfpConfig(env: WfpEnv): WFPConfig;
//# sourceMappingURL=client.d.ts.map