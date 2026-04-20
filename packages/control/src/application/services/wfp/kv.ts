/**
 * KV namespace methods for the WFP (Workers for Platforms) service.
 *
 * Manages Cloudflare Workers KV namespaces that are bound to tenant workers.
 * Provides creation and deletion of KV namespaces via the Cloudflare API.
 */

import { InternalError } from "takos-common/errors";
import type { WfpContext } from "./wfp-contracts.ts";

// ---------------------------------------------------------------------------
// KV CRUD
// ---------------------------------------------------------------------------

/**
 * Create a KV namespace.
 */
export async function createKVNamespace(
  ctx: WfpContext,
  title: string,
): Promise<string> {
  const response = await ctx.cfFetchWithRetry<{ id: string }>(
    ctx.accountPath("/storage/kv/namespaces"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
  );
  if (!response.result?.id) {
    throw new InternalError(
      `Failed to create KV namespace: no ID returned from API`,
    );
  }
  return response.result.id;
}

/**
 * Delete a KV namespace.
 */
export async function deleteKVNamespace(
  ctx: WfpContext,
  namespaceId: string,
): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath(`/storage/kv/namespaces/${namespaceId}`),
    { method: "DELETE" },
  );
}

/**
 * List keys in a KV namespace.
 */
export async function listKVEntries(
  ctx: WfpContext,
  namespaceId: string,
  options?: { prefix?: string; cursor?: string; limit?: number },
): Promise<
  {
    result: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    cursor?: string;
  }
> {
  const params = new URLSearchParams();
  if (options?.prefix) params.set("prefix", options.prefix);
  if (options?.cursor) params.set("cursor", options.cursor);
  if (options?.limit) params.set("limit", String(options.limit));
  const qs = params.toString();
  const path = ctx.accountPath(
    `/storage/kv/namespaces/${namespaceId}/keys${qs ? `?${qs}` : ""}`,
  );
  const response = await ctx.cfFetchWithRetry<
    Array<{ name: string; expiration?: number; metadata?: unknown }>
  >(path, { method: "GET" });
  return {
    result: response.result ?? [],
    cursor: response.result_info?.cursor,
  };
}

/**
 * Get a value from a KV namespace.
 */
export async function getKVValue(
  ctx: WfpContext,
  namespaceId: string,
  key: string,
): Promise<{ value: string; contentType: string }> {
  const encodedKey = encodeURIComponent(key);
  const path = ctx.accountPath(
    `/storage/kv/namespaces/${namespaceId}/values/${encodedKey}`,
  );
  // KV value endpoint returns raw value, not the standard API wrapper
  const response = await ctx.cfFetchWithRetry<string>(path, { method: "GET" });
  return {
    value: String(response.result ?? response),
    contentType: "text/plain",
  };
}

/**
 * Put a value into a KV namespace.
 */
export async function putKVValue(
  ctx: WfpContext,
  namespaceId: string,
  key: string,
  value: string,
): Promise<void> {
  const encodedKey = encodeURIComponent(key);
  const path = ctx.accountPath(
    `/storage/kv/namespaces/${namespaceId}/values/${encodedKey}`,
  );
  await ctx.cfFetchWithRetry(path, {
    method: "PUT",
    body: value,
  });
}

/**
 * Delete a value from a KV namespace.
 */
export async function deleteKVValue(
  ctx: WfpContext,
  namespaceId: string,
  key: string,
): Promise<void> {
  const encodedKey = encodeURIComponent(key);
  const path = ctx.accountPath(
    `/storage/kv/namespaces/${namespaceId}/values/${encodedKey}`,
  );
  await ctx.cfFetchWithRetry(path, { method: "DELETE" });
}
