/**
 * Queue methods for the WFP (Workers for Platforms) service.
 *
 * Manages Cloudflare Queues that are bound to tenant workers. Provides
 * creation (with optional delivery delay), listing, deletion by ID, and
 * deletion by name.
 */

import { InternalError } from "takos-common/errors";
import type { WfpContext } from "./wfp-contracts.ts";

export type QueueConsumerSettings = {
  batch_size?: number;
  max_concurrency?: number;
  max_retries?: number;
  max_wait_time_ms?: number;
  retry_delay?: number;
};

export type QueueConsumer = {
  id: string;
  queueName: string;
  scriptName?: string;
  type?: string;
};

export type QueueConsumerInput = {
  scriptName: string;
  replaceScriptName?: string;
  deadLetterQueue?: string;
  settings?: QueueConsumerSettings;
};

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
    ctx.accountPath("/queues"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queue_name: queueName,
        ...(typeof options?.deliveryDelaySeconds === "number"
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
  const name = response.result?.queue_name || response.result?.name ||
    queueName;
  if (!id) {
    throw new InternalError(`Failed to create Queue: no ID returned from API`);
  }
  return { id, name };
}

export async function listQueues(
  ctx: WfpContext,
): Promise<Array<{ id: string; name: string }>> {
  const response = await ctx.cfFetch<
    Array<{
      queue_id?: string;
      id?: string;
      queue_name?: string;
      name?: string;
    }>
  >(
    ctx.accountPath("/queues"),
  );

  return (response.result || []).map((queue) => ({
    id: queue.queue_id || queue.id || "",
    name: queue.queue_name || queue.name || "",
  })).filter((queue) => Boolean(queue.id) && Boolean(queue.name));
}

export async function deleteQueue(
  ctx: WfpContext,
  queueId: string,
): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath(`/queues/${queueId}`),
    { method: "DELETE" },
  );
}

export async function deleteQueueByName(
  ctx: WfpContext,
  queueName: string,
): Promise<void> {
  const queue = (await listQueues(ctx)).find((candidate) =>
    candidate.name === queueName
  );
  if (!queue) return;
  await deleteQueue(ctx, queue.id);
}

// ---------------------------------------------------------------------------
// Queue consumers
// ---------------------------------------------------------------------------

function toQueueConsumer(row: {
  consumer_id?: string;
  id?: string;
  queue_name?: string;
  script_name?: string;
  type?: string;
}): QueueConsumer | null {
  const id = row.consumer_id || row.id || "";
  if (!id) return null;
  return {
    id,
    queueName: row.queue_name || "",
    ...(row.script_name ? { scriptName: row.script_name } : {}),
    ...(row.type ? { type: row.type } : {}),
  };
}

function queueConsumerPayload(
  input: QueueConsumerInput,
): Record<string, unknown> {
  return {
    type: "worker",
    script_name: input.scriptName,
    ...(input.deadLetterQueue
      ? { dead_letter_queue: input.deadLetterQueue }
      : {}),
    ...(input.settings && Object.keys(input.settings).length > 0
      ? { settings: input.settings }
      : {}),
  };
}

export async function listQueueConsumers(
  ctx: WfpContext,
  queueId: string,
): Promise<QueueConsumer[]> {
  const response = await ctx.cfFetch<
    Array<{
      consumer_id?: string;
      id?: string;
      queue_name?: string;
      script_name?: string;
      type?: string;
    }>
  >(
    ctx.accountPath(`/queues/${queueId}/consumers`),
  );

  return (response.result || [])
    .map(toQueueConsumer)
    .filter((consumer): consumer is QueueConsumer => consumer !== null);
}

export async function createQueueConsumer(
  ctx: WfpContext,
  queueId: string,
  input: QueueConsumerInput,
): Promise<QueueConsumer> {
  const response = await ctx.cfFetchWithRetry<{
    consumer_id?: string;
    id?: string;
    queue_name?: string;
    script_name?: string;
    type?: string;
  }>(
    ctx.accountPath(`/queues/${queueId}/consumers`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(queueConsumerPayload(input)),
    },
  );

  const consumer = toQueueConsumer(response.result ?? {});
  if (!consumer) {
    throw new InternalError(
      `Failed to create Queue consumer: no consumer ID returned from API`,
    );
  }
  return consumer;
}

export async function updateQueueConsumer(
  ctx: WfpContext,
  queueId: string,
  consumerId: string,
  input: QueueConsumerInput,
): Promise<QueueConsumer> {
  const response = await ctx.cfFetchWithRetry<{
    consumer_id?: string;
    id?: string;
    queue_name?: string;
    script_name?: string;
    type?: string;
  }>(
    ctx.accountPath(`/queues/${queueId}/consumers/${consumerId}`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(queueConsumerPayload(input)),
    },
  );

  const consumer = toQueueConsumer(response.result ?? {});
  if (!consumer) {
    throw new InternalError(
      `Failed to update Queue consumer: no consumer ID returned from API`,
    );
  }
  return consumer;
}

export async function deleteQueueConsumer(
  ctx: WfpContext,
  queueId: string,
  consumerId: string,
): Promise<void> {
  await ctx.cfFetchWithRetry(
    ctx.accountPath(`/queues/${queueId}/consumers/${consumerId}`),
    { method: "DELETE" },
  );
}

export async function deleteQueueConsumerByQueueName(
  ctx: WfpContext,
  queueName: string,
  options?: { scriptName?: string },
): Promise<number> {
  const queue = (await listQueues(ctx)).find((candidate) =>
    candidate.name === queueName
  );
  if (!queue) return 0;

  const consumers = await listQueueConsumers(ctx, queue.id);
  const scriptName = options?.scriptName?.trim();
  const matchingConsumers = scriptName
    ? consumers.filter((consumer) => consumer.scriptName === scriptName)
    : consumers;

  for (const consumer of matchingConsumers) {
    await deleteQueueConsumer(ctx, queue.id, consumer.id);
  }
  return matchingConsumers.length;
}

export async function upsertQueueConsumerByQueueName(
  ctx: WfpContext,
  queueName: string,
  input: QueueConsumerInput,
): Promise<QueueConsumer> {
  const queue = (await listQueues(ctx)).find((candidate) =>
    candidate.name === queueName
  );
  if (!queue) {
    throw new InternalError(`Queue "${queueName}" was not found`);
  }

  const consumers = await listQueueConsumers(ctx, queue.id);
  const replaceScriptName = input.replaceScriptName?.trim();
  const existing =
    consumers.find((consumer) => consumer.scriptName === input.scriptName) ??
      (replaceScriptName
        ? consumers.find((consumer) =>
          consumer.scriptName === replaceScriptName
        )
        : undefined);
  if (existing) {
    return updateQueueConsumer(ctx, queue.id, existing.id, input);
  }
  return createQueueConsumer(ctx, queue.id, input);
}
