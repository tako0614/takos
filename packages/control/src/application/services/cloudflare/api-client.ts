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

import {
  CF_API_BASE,
  type CFAPIResponse,
  classifyAPIError,
  createTimeoutError,
} from "../wfp/client.ts";
import { withTimeout } from "../../../shared/utils/with-timeout.ts";

export interface CloudflareApiConfig {
  accountId: string;
  apiToken: string;
  zoneId?: string;
}

/**
 * Generic Cloudflare REST API client (account-level + zone-level).
 * Unlike WfpClient, this does not require a dispatch namespace.
 */
export class CloudflareApiClient {
  constructor(private config: CloudflareApiConfig) {}

  /**
   * Delegates to the shared withTimeout utility, re-throwing timeouts as
   * CloudflareAPIError (via createTimeoutError) to preserve the isRetryable
   * flag expected by callers.
   */
  private async withTimeout<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    try {
      return await withTimeout(
        (signal) => fn(signal!),
        timeoutMs,
        `Cloudflare API timeout after ${timeoutMs / 1000} seconds`,
      );
    } catch (error) {
      // The shared withTimeout throws a plain Error on timeout.
      // Convert to CloudflareAPIError so callers get isRetryable metadata.
      if (
        error instanceof Error &&
        error.message.startsWith("Cloudflare API timeout after")
      ) {
        throw createTimeoutError(timeoutMs);
      }
      throw error;
    }
  }

  get accountId(): string {
    return this.config.accountId;
  }

  get zoneId(): string | undefined {
    return this.config.zoneId;
  }

  /**
   * JSON API call — parses response as CFAPIResponse<T>.
   */
  async fetch<T>(
    path: string,
    options: RequestInit = {},
    timeoutMs = 600_000,
  ): Promise<CFAPIResponse<T>> {
    const url = `${CF_API_BASE}${path}`;

    return this.withTimeout(async (signal) => {
      const response = await globalThis.fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
        signal,
      });

      if (!response.ok) {
        let data: CFAPIResponse<T> | undefined;
        try {
          data = (await response.json()) as CFAPIResponse<T>;
        } catch {
          // JSON parse failed
        }
        throw classifyAPIError(response, data);
      }

      const data = (await response.json()) as CFAPIResponse<T>;
      if (!data.success) {
        const mockResponse = new Response(null, {
          status: 400,
          statusText: "Bad Request",
        });
        throw classifyAPIError(mockResponse, data);
      }

      return data;
    }, timeoutMs);
  }

  /**
   * Raw fetch (for endpoints that return non-JSON, e.g. KV values).
   */
  async fetchRaw(
    path: string,
    options: RequestInit = {},
    timeoutMs = 600_000,
  ): Promise<Response> {
    const url = `${CF_API_BASE}${path}`;

    return this.withTimeout(async (signal) => {
      return await globalThis.fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          ...options.headers,
        },
        signal,
      });
    }, timeoutMs);
  }

  // ------- Account-scoped helpers -------

  /** GET /accounts/{accountId}/... */
  async accountGet<T>(subpath: string, timeoutMs?: number): Promise<T> {
    const res = await this.fetch<T>(
      `/accounts/${this.config.accountId}${subpath}`,
      { method: "GET" },
      timeoutMs,
    );
    return res.result;
  }

  /** POST /accounts/{accountId}/... */
  async accountPost<T>(
    subpath: string,
    body?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const res = await this.fetch<T>(
      `/accounts/${this.config.accountId}${subpath}`,
      {
        method: "POST",
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      timeoutMs,
    );
    return res.result;
  }

  /** DELETE /accounts/{accountId}/... */
  async accountDelete<T = unknown>(
    subpath: string,
    timeoutMs?: number,
  ): Promise<T> {
    const res = await this.fetch<T>(
      `/accounts/${this.config.accountId}${subpath}`,
      { method: "DELETE" },
      timeoutMs,
    );
    return res.result;
  }

  // ------- Zone-scoped helpers (custom hostnames, etc.) -------

  /** POST /zones/{zoneId}/... */
  async zonePost<T>(
    subpath: string,
    body?: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    if (!this.config.zoneId) throw new Error("CF_ZONE_ID not configured");
    const res = await this.fetch<T>(
      `/zones/${this.config.zoneId}${subpath}`,
      {
        method: "POST",
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
      timeoutMs,
    );
    return res.result;
  }

  /** GET /zones/{zoneId}/... */
  async zoneGet<T>(subpath: string, timeoutMs?: number): Promise<T> {
    if (!this.config.zoneId) throw new Error("CF_ZONE_ID not configured");
    const res = await this.fetch<T>(`/zones/${this.config.zoneId}${subpath}`, {
      method: "GET",
    }, timeoutMs);
    return res.result;
  }

  /** DELETE /zones/{zoneId}/... */
  async zoneDelete<T = unknown>(
    subpath: string,
    timeoutMs?: number,
  ): Promise<T> {
    if (!this.config.zoneId) throw new Error("CF_ZONE_ID not configured");
    const res = await this.fetch<T>(`/zones/${this.config.zoneId}${subpath}`, {
      method: "DELETE",
    }, timeoutMs);
    return res.result;
  }
}

export function createCloudflareApiClient(env: {
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
}): CloudflareApiClient | null {
  if (!env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return null;
  return new CloudflareApiClient({
    accountId: env.CF_ACCOUNT_ID,
    apiToken: env.CF_API_TOKEN,
    zoneId: env.CF_ZONE_ID,
  });
}
