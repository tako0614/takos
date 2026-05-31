/**
 * Vector-search index methods for the Cloudflare provider adapter.
 *
 * Manages Cloudflare provider vector-search indexes that are bound to tenant
 * runtimes. Provides creation (with configurable dimensions and distance
 * metric) and deletion of vector-search indexes.
 */

import { InternalError } from "@takos/worker-platform-utils/errors";
import type { WfpContext } from "./wfp-contracts.ts";

// ---------------------------------------------------------------------------
// Vector-search CRUD
// ---------------------------------------------------------------------------

/**
 * Create a vector-search index.
 */
export async function createVectorizeIndex(
  ctx: WfpContext,
  name: string,
  config: {
    dimensions: number;
    metric: "cosine" | "euclidean" | "dot-product";
  },
): Promise<string> {
  const response = await ctx.cfFetchWithRetry<{ name: string }>(
    ctx.accountPath("/vectorize/v2/indexes"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        config: {
          dimensions: config.dimensions,
          metric: config.metric,
        },
      }),
    },
  );
  if (!response.result?.name) {
    throw new InternalError(
      `Failed to create vector-search index: no name returned from API`,
    );
  }
  return response.result.name;
}

/**
 * Delete a vector-search index.
 */
export async function deleteVectorizeIndex(
  ctx: WfpContext,
  name: string,
): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath(`/vectorize/v2/indexes/${name}`),
    { method: "DELETE" },
  );
}
