/**
 * R2 bucket methods for WFPService.
 */

import { CF_API_BASE } from './client';
import { InternalError } from '@takoserver/common/errors';
import type { WfpContext } from './wfp-contracts';

// ---------------------------------------------------------------------------
// R2 CRUD
// ---------------------------------------------------------------------------

/**
 * Create an R2 bucket for tenant.
 */
export async function createR2Bucket(ctx: WfpContext, name: string): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath('/r2/buckets'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }
  );
}

/**
 * Delete an R2 bucket.
 */
export async function deleteR2Bucket(ctx: WfpContext, name: string): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath(`/r2/buckets/${name}`),
    { method: 'DELETE' }
  );
}

/**
 * List objects in an R2 bucket.
 */
export async function listR2Objects(ctx: WfpContext, bucketName: string, options?: {
  prefix?: string;
  cursor?: string;
  limit?: number;
}): Promise<{
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
  if (options?.prefix) params.set('prefix', options.prefix);
  if (options?.cursor) params.set('cursor', options.cursor);
  if (options?.limit) params.set('per_page', options.limit.toString());

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
    ctx.accountPath(`/r2/buckets/${bucketName}/objects?${params.toString()}`)
  );
  return response.result || { objects: [], truncated: false };
}

/**
 * Upload a file to R2 bucket using S3-compatible API.
 * Uses raw fetch because the R2 object upload endpoint requires
 * Content-Type on the request (not JSON-wrapped).
 */
export async function uploadToR2(
  ctx: WfpContext,
  bucketName: string,
  key: string,
  body: ReadableStream<Uint8Array> | ArrayBuffer | string,
  options?: {
    contentType?: string;
  }
): Promise<void> {
  const response = await fetch(
    `${CF_API_BASE}${ctx.accountPath(`/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`)}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${ctx.config.apiToken}`,
        'Content-Type': options?.contentType || 'application/octet-stream',
      },
      body,
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new InternalError(`Failed to upload to R2: ${response.status} ${text}`);
  }
}

/**
 * Delete an object from an R2 bucket.
 */
export async function deleteR2Object(ctx: WfpContext, bucketName: string, key: string): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath(`/r2/buckets/${bucketName}/objects/${encodeURIComponent(key)}`),
    { method: 'DELETE' }
  );
}

/**
 * Get R2 bucket usage stats.
 */
export async function getR2BucketStats(ctx: WfpContext, bucketName: string): Promise<{
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
