import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryQueue } from '../in-memory-bindings.ts';
import { LOCAL_QUEUE_NAMES } from '../queue-runtime.ts';

const queueSpy = vi.hoisted(() => vi.fn());
const scheduledSpy = vi.hoisted(() => vi.fn());

vi.mock('../../runtime/worker/index.ts', () => ({
  createWorkerRuntime: () => ({
    queue: queueSpy,
    scheduled: scheduledSpy,
  }),
  default: {
    queue: queueSpy,
    scheduled: scheduledSpy,
  },
}));

import { runLocalWorkerIteration } from '../worker.ts';

describe('local worker loop', () => {
  beforeEach(() => {
    queueSpy.mockReset();
    scheduledSpy.mockReset();
  });

  it('acks and drains a local queue message', async () => {
    queueSpy.mockImplementation(async (batch: { messages: Array<{ ack(): void }> }) => {
      batch.messages[0].ack();
    });

    const queue = createInMemoryQueue(LOCAL_QUEUE_NAMES.run) as ReturnType<typeof createInMemoryQueue> & { receive(): Promise<unknown> };
    await queue.send({ runId: 'run-1' });

    const worked = await runLocalWorkerIteration({} as never, [queue as never]);

    expect(worked).toBe(true);
    await expect(queue.receive()).resolves.toBeNull();
    expect(queueSpy).toHaveBeenCalledTimes(1);
  });

  it('requeues with incremented attempts when a handler retries', async () => {
    queueSpy.mockImplementation(async (batch: { messages: Array<{ retry(): void }> }) => {
      batch.messages[0].retry();
    });

    const queue = createInMemoryQueue(LOCAL_QUEUE_NAMES.run) as ReturnType<typeof createInMemoryQueue> & {
      receive(): Promise<{ attempts?: number } | null>;
    };
    await queue.send({ runId: 'run-2' });

    const worked = await runLocalWorkerIteration({} as never, [queue as never]);
    const retried = await queue.receive();

    expect(worked).toBe(true);
    expect(retried).toMatchObject({ attempts: 2 });
    expect(queueSpy).toHaveBeenCalledTimes(1);
  });

  it('dispatches to the DLQ queue name after retries are exhausted', async () => {
    queueSpy.mockImplementation(async (batch: { messages: Array<{ retry(): void }> }) => {
      batch.messages[0].retry();
    });

    const queue = createInMemoryQueue(LOCAL_QUEUE_NAMES.run) as ReturnType<typeof createInMemoryQueue> & { receive(): Promise<unknown> };
    await (queue as { sendBatch(messages: Iterable<unknown>): Promise<void> }).sendBatch([
      { body: { runId: 'run-3' }, attempts: 3 },
    ]);

    const worked = await runLocalWorkerIteration({} as never, [queue as never]);

    expect(worked).toBe(true);
    expect(queueSpy).toHaveBeenCalledTimes(2);
    expect(queueSpy.mock.calls[0][0].queue).toBe('takos-runs');
    expect(queueSpy.mock.calls[1][0].queue).toBe('takos-runs-dlq');
    await expect(queue.receive()).resolves.toBeNull();
  });
});
