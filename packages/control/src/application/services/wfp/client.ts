import type { Env } from '../../../shared/types';

export type WfpEnv = Pick<Env, 'CF_ACCOUNT_ID' | 'CF_API_TOKEN' | 'WFP_DISPATCH_NAMESPACE'>;

export const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export interface WFPConfig {
  accountId: string;
  apiToken: string;
  dispatchNamespace: string;
}

export interface CFAPIResponse<T = unknown> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: string[];
  result: T;
}

function readRequiredCloudflareValue(value: string | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveWfpConfig(env: WfpEnv): WFPConfig | null {
  const accountId = readRequiredCloudflareValue(env.CF_ACCOUNT_ID);
  const apiToken = readRequiredCloudflareValue(env.CF_API_TOKEN);
  const dispatchNamespace = readRequiredCloudflareValue(env.WFP_DISPATCH_NAMESPACE);
  if (!accountId || !apiToken || !dispatchNamespace) {
    return null;
  }
  return {
    accountId,
    apiToken,
    dispatchNamespace,
  };
}

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
export function sanitizeErrorMessage(message: string): string {
  // Remove potential API tokens (Bearer tokens, API keys)
  let sanitized = message.replace(/Bearer\s+[A-Za-z0-9_-]+/gi, 'Bearer [REDACTED]');
  sanitized = sanitized.replace(/api[_-]?token[=:]\s*['"]?[A-Za-z0-9_-]+['"]?/gi, 'api_token=[REDACTED]');
  sanitized = sanitized.replace(/authorization[=:]\s*['"]?[A-Za-z0-9_-]+['"]?/gi, 'authorization=[REDACTED]');
  // Remove potential secret keys
  sanitized = sanitized.replace(/secret[_-]?key[=:]\s*['"]?[A-Za-z0-9_-]+['"]?/gi, 'secret_key=[REDACTED]');
  // Remove potential passwords
  sanitized = sanitized.replace(/password[=:]\s*['"]?[^\s'"]+['"]?/gi, 'password=[REDACTED]');
  // Remove potential account IDs that might be in paths
  sanitized = sanitized.replace(/accounts\/[a-f0-9]{32}/gi, 'accounts/[REDACTED]');
  return sanitized;
}

/**
 * C3: Classify API errors based on response status and data
 * C5: Handles rate limiting (429) with Retry-After header extraction
 * S7 Fix: Sanitizes error messages to prevent sensitive information exposure
 */
export function classifyAPIError(response: Response, data?: CFAPIResponse): CloudflareAPIError {
  const error = new Error() as CloudflareAPIError;
  error.statusCode = response.status;

  // Extract error message from response data or use status text
  // S7 Fix: Sanitize all error messages before including them
  if (data?.errors?.length) {
    const sanitizedMessages = data.errors.map(e => sanitizeErrorMessage(e.message)).join(', ');
    error.message = `Cloudflare API error: ${sanitizedMessages}`;
    error.code = data.errors[0]?.code;
  } else {
    error.message = `Cloudflare API error: ${response.status} ${response.statusText}`;
  }

  // C5: Handle rate limiting (429) with Retry-After header
  if (response.status === 429) {
    error.isRateLimited = true;
    error.isRetryable = true;
    const retryAfterHeader = response.headers.get('Retry-After');
    if (retryAfterHeader) {
      // Retry-After can be seconds or HTTP-date; we handle seconds
      const seconds = parseInt(retryAfterHeader, 10);
      error.retryAfter = isNaN(seconds) ? 60 : seconds;
    } else {
      error.retryAfter = 60; // Default to 60 seconds if no header
    }
  }
  // C6: Server errors (5xx) are retryable
  else if (response.status >= 500) {
    error.isRetryable = true;
  }
  // Client errors (4xx except 429) are not retryable
  else if (response.status >= 400) {
    error.isRetryable = false;
  }

  return error;
}

/**
 * Create a CloudflareAPIError for timeout scenarios
 */
export function createTimeoutError(timeoutMs: number): CloudflareAPIError {
  const error = new Error(`Cloudflare API timeout after ${timeoutMs / 1000} seconds`) as CloudflareAPIError;
  error.isRetryable = true; // Timeouts are retryable
  return error;
}

export class WfpClient {
  constructor(private config: WFPConfig) {}

  async fetch<T>(
    path: string,
    options: RequestInit = {},
    timeoutMs: number = 600000
  ): Promise<CFAPIResponse<T>> {
    const url = `${CF_API_BASE}${path}`;

    // S22: Add timeout to prevent hanging on slow/unresponsive API
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.config.apiToken}`,
          ...options.headers,
        },
        signal: controller.signal,
      });

      // C3: Handle non-OK responses with proper error classification
      if (!response.ok) {
        let data: CFAPIResponse<T> | undefined;
        try {
          data = await response.json() as CFAPIResponse<T>;
        } catch {
          // JSON parse failed, will use status text
        }
        throw classifyAPIError(response, data);
      }

      const data = await response.json() as CFAPIResponse<T>;

      if (!data.success) {
        // Create a mock response for API-level failures
        const mockResponse = new Response(null, { status: 400, statusText: 'Bad Request' });
        throw classifyAPIError(mockResponse, data);
      }

      return data;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw createTimeoutError(timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export function createWfpConfig(env: WfpEnv): WFPConfig {
  const config = resolveWfpConfig(env);
  if (!config) {
    throw new Error('Cloudflare WFP is not configured');
  }
  return config;
}
