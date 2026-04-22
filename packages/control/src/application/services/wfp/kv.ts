/**
 * KV namespace methods for the WFP (Workers for Platforms) service.
 *
 * Manages Cloudflare Workers KV namespaces that are bound to tenant workers.
 * Provides creation and deletion of KV namespaces via the Cloudflare API.
 */

import { InternalError } from "takos-common/errors";
import type { WfpContext } from "./wfp-contracts.ts";

export type KVNamespaceRecord = {
  id: string;
  title: string;
};

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
  let response: { result?: { id?: string } };
  try {
    response = await ctx.cfFetchWithRetry<{ id: string }>(
      ctx.accountPath("/storage/kv/namespaces"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      },
    );
  } catch (error) {
    if (!isKVNamespaceAlreadyExistsError(error)) {
      throw error;
    }
    const existing = await findKVNamespaceByTitle(ctx, title);
    if (existing) return existing.id;
    throw error;
  }
  if (!response.result?.id) {
    throw new InternalError(
      `Failed to create KV namespace: no ID returned from API`,
    );
  }
  return response.result.id;
}

function isKVNamespaceAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /namespace with this account ID and title already exists/i.test(
    error.message,
  );
}

async function findKVNamespaceByTitle(
  ctx: WfpContext,
  title: string,
): Promise<KVNamespaceRecord | null> {
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const response = await listKVNamespaces(ctx, { cursor, limit: 1000 });
    const match = response.result.find((namespace) =>
      namespace.title === title
    );
    if (match) return match;
    cursor = response.cursor;
    if (!cursor) break;
  }
  return null;
}

export async function listKVNamespaces(
  ctx: WfpContext,
  options?: { cursor?: string; limit?: number },
): Promise<{ result: KVNamespaceRecord[]; cursor?: string }> {
  const params = new URLSearchParams();
  if (options?.cursor) params.set("cursor", options.cursor);
  if (options?.limit) params.set("per_page", String(options.limit));
  const qs = params.toString();
  const response = await ctx.cfFetchWithRetry<KVNamespaceRecord[]>(
    ctx.accountPath(`/storage/kv/namespaces${qs ? `?${qs}` : ""}`),
    { method: "GET" },
  );
  return {
    result: response.result ?? [],
    cursor: response.result_info?.cursor,
  };
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
