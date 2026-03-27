/**
 * Queue methods for WFPService.
 */

import { InternalError } from '@takos/common/errors';
import type { WfpContext } from './types';

// ---------------------------------------------------------------------------
// Queue CRUD
// ---------------------------------------------------------------------------

export async function createQueue(
  ctx: WfpContext,
  queueName: string,
  options?: {
    deliveryDelaySeconds?: number;
  },
): Promise<{ id: string; name: string }> {
  const response = await ctx.cfFetchWithRetry<{
    queue_id?: string;
    id?: string;
    queue_name?: string;
    name?: string;
  }>(
    ctx.accountPath('/queues'),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queue_name: queueName,
        ...(typeof options?.deliveryDelaySeconds === 'number'
          ? {
              settings: {
                delivery_delay: options.deliveryDelaySeconds,
              },
            }
          : {}),
      }),
    },
  );

  const id = response.result?.queue_id || response.result?.id;
  const name = response.result?.queue_name || response.result?.name || queueName;
  if (!id) {
    throw new InternalError(`Failed to create Queue: no ID returned from API`);
  }
  return { id, name };
}

export async function listQueues(ctx: WfpContext): Promise<Array<{ id: string; name: string }>> {
  const response = await ctx.cfFetch<Array<{
    queue_id?: string;
    id?: string;
    queue_name?: string;
    name?: string;
  }>>(
    ctx.accountPath('/queues'),
  );

  return (response.result || []).map((queue) => ({
    id: queue.queue_id || queue.id || '',
    name: queue.queue_name || queue.name || '',
  })).filter((queue) => Boolean(queue.id) && Boolean(queue.name));
}

export async function deleteQueue(ctx: WfpContext, queueId: string): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath(`/queues/${queueId}`),
    { method: 'DELETE' },
  );
}

export async function deleteQueueByName(ctx: WfpContext, queueName: string): Promise<void> {
  const queue = (await listQueues(ctx)).find((candidate) => candidate.name === queueName);
  if (!queue) return;
  await deleteQueue(ctx, queue.id);
}
