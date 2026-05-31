/**
 * Object-store methods for the Cloudflare provider adapter.
 *
 * Manages Cloudflare provider object stores that are bound to tenant
 * runtimes. Provides CRUD for stores, object listing, upload via the provider
 * object endpoint, deletion, and basic usage statistics.
 */

import { CF_API_BASE } from "./client.ts";
import { InternalError } from "@takos/worker-platform-utils/errors";
import type { WfpContext } from "./wfp-contracts.ts";

// ---------------------------------------------------------------------------
// Object-store CRUD
// ---------------------------------------------------------------------------

/**
 * Create an object store for a tenant.
 */
export async function createR2Bucket(
  ctx: WfpContext,
  name: string,
): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath("/r2/buckets"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
}

/**
 * Delete an object store.
 */
export async function deleteR2Bucket(
  ctx: WfpContext,
  name: string,
): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath(`/r2/buckets/${name}`),
    { method: "DELETE" },
  );
}

/**
 * List objects in an object store.
 */
export async function listR2Objects(
  ctx: WfpContext,
  bucketName: string,
  options?: {
    prefix?: string;
    cursor?: string;
    limit?: number;
  },
): Promise<{
  objects: Array<{
    key: string;
    size: number;
    uploaded: string;
    etag: string;
  }>;
  truncated: boolean;
  cursor?: string;
}> {
  const params = new URLSearchParams();
  if (options?.prefix) params.set("prefix", options.prefix);
  if (options?.cursor) params.set("cursor", options.cursor);
  if (options?.limit) params.set("per_page", options.limit.toString());

  const response = await ctx.cfFetch<{
    objects: Array<{
      key: string;
      size: number;
      uploaded: string;
      etag: string;
    }>;
    truncated: boolean;
    cursor?: string;
  }>(
    ctx.accountPath(`/r2/buckets/${bucketName}/objects?${params.toString()}`),
  );
  return response.result || { objects: [], truncated: false };
}

/**
 * Upload a file to an object store. Uses raw fetch because this provider
 * object endpoint requires Content-Type on the request (not JSON-wrapped).
 */
export async function uploadToR2(
  ctx: WfpContext,
  bucketName: string,
  key: string,
  body: ReadableStream<Uint8Array> | ArrayBuffer | string,
  options?: {
    contentType?: string;
  },
): Promise<void> {
  const response = await fetch(
    `${CF_API_BASE}${
      ctx.accountPath(
        `/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`,
      )
    }`,
    {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${ctx.config.apiToken}`,
        "Content-Type": options?.contentType || "application/octet-stream",
      },
      body,
      // R2 uploads can carry sizeable bundles/assets; 60s caps a stuck
      // transfer while accommodating realistic upload time.
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new InternalError(
      `Failed to upload to object store: ${response.status} ${text}`,
    );
  }
}

/**
 * Read an object from an object store using the object endpoint.
 */
export async function getR2Object(
  ctx: WfpContext,
  bucketName: string,
  key: string,
): Promise<
  {
    body: ArrayBuffer;
    contentType: string | null;
    size: number;
  } | null
> {
  const response = await fetch(
    `${CF_API_BASE}${
      ctx.accountPath(
        `/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`,
      )
    }`,
    {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${ctx.config.apiToken}`,
      },
      // Matches the upload-side 60s cap for symmetric handling of stalled
      // R2 object transfers.
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new InternalError(
      `Failed to read from object store: ${response.status} ${text}`,
    );
  }

  const body = await response.arrayBuffer();
  return {
    body,
    contentType: response.headers.get("content-type"),
    size: body.byteLength,
  };
}

/**
 * Delete an object from an object store.
 */
export async function deleteR2Object(
  ctx: WfpContext,
  bucketName: string,
  key: string,
): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath(
      `/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`,
    ),
    { method: "DELETE" },
  );
}

/**
 * Get object-store usage stats.
 */
export async function getR2BucketStats(
  ctx: WfpContext,
  bucketName: string,
): Promise<{
  objectCount: number;
  payloadSize: number;
  metadataSize: number;
}> {
  const listResult = await listR2Objects(ctx, bucketName, { limit: 1000 });
  const totalSize = listResult.objects.reduce((sum, obj) => sum + obj.size, 0);
  return {
    objectCount: listResult.objects.length,
    payloadSize: totalSize,
    metadataSize: 0,
  };
}
