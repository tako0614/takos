/**
 * Vectorize index methods for the WFP (Workers for Platforms) service.
 *
 * Manages Cloudflare Vectorize indexes that are bound to tenant workers.
 * Provides creation (with configurable dimensions and distance metric) and
 * deletion of vector search indexes.
 */

import { InternalError } from 'takos-common/errors';
import type { WfpContext } from './wfp-contracts.ts';

// ---------------------------------------------------------------------------
// Vectorize CRUD
// ---------------------------------------------------------------------------

/**
 * Create a Vectorize index.
 */
export async function createVectorizeIndex(
  ctx: WfpContext,
  name: string,
  config: { dimensions: number; metric: 'cosine' | 'euclidean' | 'dot-product' }
): Promise<string> {
  const response = await ctx.cfFetchWithRetry<{ name: string }>(
    ctx.accountPath('/vectorize/v2/indexes'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        config: {
          dimensions: config.dimensions,
          metric: config.metric,
        },
      }),
    }
  );
  if (!response.result?.name) {
    throw new InternalError(`Failed to create Vectorize index: no name returned from API`);
  }
  return response.result.name;
}

/**
 * Delete a Vectorize index.
 */
export async function deleteVectorizeIndex(ctx: WfpContext, name: string): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath(`/vectorize/v2/indexes/${name}`),
    { method: 'DELETE' }
  );
}
