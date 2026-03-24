/**
 * Centralized Cloudflare Management API client.
 *
 * All direct calls to `api.cloudflare.com` should go through this client
 * to ensure consistent auth, timeout, error handling, and retry logic.
 */

import {
  CF_API_BASE,
  type CFAPIResponse,
  classifyAPIError,
  createTimeoutError,
} from '../wfp/client';

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

  private async withTimeout<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fn(controller.signal);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw createTimeoutError(timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
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
    timeoutMs = 600_000
  ): Promise<CFAPIResponse<T>> {
    const url = `${CF_API_BASE}${path}`;

    return this.withTimeout(async (signal) => {
      const response = await globalThis.fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          'Content-Type': 'application/json',
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
        const mockResponse = new Response(null, { status: 400, statusText: 'Bad Request' });
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
    timeoutMs = 600_000
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
    const res = await this.fetch<T>(`/accounts/${this.config.accountId}${subpath}`, { method: 'GET' }, timeoutMs);
    return res.result;
  }

  /** POST /accounts/{accountId}/... */
  async accountPost<T>(subpath: string, body?: unknown, timeoutMs?: number): Promise<T> {
    const res = await this.fetch<T>(
      `/accounts/${this.config.accountId}${subpath}`,
      { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined },
      timeoutMs,
    );
    return res.result;
  }

  /** DELETE /accounts/{accountId}/... */
  async accountDelete<T = unknown>(subpath: string, timeoutMs?: number): Promise<T> {
    const res = await this.fetch<T>(`/accounts/${this.config.accountId}${subpath}`, { method: 'DELETE' }, timeoutMs);
    return res.result;
  }

  // ------- Zone-scoped helpers (custom hostnames, etc.) -------

  /** POST /zones/{zoneId}/... */
  async zonePost<T>(subpath: string, body?: unknown, timeoutMs?: number): Promise<T> {
    if (!this.config.zoneId) throw new Error('CF_ZONE_ID not configured');
    const res = await this.fetch<T>(
      `/zones/${this.config.zoneId}${subpath}`,
      { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined },
      timeoutMs,
    );
    return res.result;
  }

  /** GET /zones/{zoneId}/... */
  async zoneGet<T>(subpath: string, timeoutMs?: number): Promise<T> {
    if (!this.config.zoneId) throw new Error('CF_ZONE_ID not configured');
    const res = await this.fetch<T>(`/zones/${this.config.zoneId}${subpath}`, { method: 'GET' }, timeoutMs);
    return res.result;
  }

  /** DELETE /zones/{zoneId}/... */
  async zoneDelete<T = unknown>(subpath: string, timeoutMs?: number): Promise<T> {
    if (!this.config.zoneId) throw new Error('CF_ZONE_ID not configured');
    const res = await this.fetch<T>(`/zones/${this.config.zoneId}${subpath}`, { method: 'DELETE' }, timeoutMs);
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
