/**
 * KV namespace methods for WFPService.
 */

import { InternalError } from '@takoserver/common/errors';
import type { WfpContext } from './wfp-contracts';

// ---------------------------------------------------------------------------
// KV CRUD
// ---------------------------------------------------------------------------

/**
 * Create a KV namespace.
 */
export async function createKVNamespace(ctx: WfpContext, title: string): Promise<string> {
  const response = await ctx.cfFetchWithRetry<{ id: string }>(
    ctx.accountPath('/storage/kv/namespaces'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }
  );
  if (!response.result?.id) {
    throw new InternalError(`Failed to create KV namespace: no ID returned from API`);
  }
  return response.result.id;
}

/**
 * Delete a KV namespace.
 */
export async function deleteKVNamespace(ctx: WfpContext, namespaceId: string): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath(`/storage/kv/namespaces/${namespaceId}`),
    { method: 'DELETE' }
  );
}
