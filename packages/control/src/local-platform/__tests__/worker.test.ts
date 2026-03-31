import { createInMemoryQueue } from '../in-memory-bindings.ts';
import { LOCAL_QUEUE_NAMES } from '../queue-runtime.ts';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const queueSpy = ((..._args: any[]) => undefined) as any;
const scheduledSpy = ((..._args: any[]) => undefined) as any;

// [Deno] vi.mock removed - manually stub imports from '../../runtime/worker/index.ts'
import { runLocalWorkerIteration } from '../worker.ts';


  Deno.test('local worker loop - acks and drains a local queue message', async () => {
  queueSpy;
    scheduledSpy;
  queueSpy = async (batch: { messages: Array<{ ack(): void }> }) => {
      batch.messages[0].ack();
    } as any;

    const queue = createInMemoryQueue(LOCAL_QUEUE_NAMES.run) as ReturnType<typeof createInMemoryQueue> & { receive(): Promise<unknown> };
    await queue.send({ runId: 'run-1' });

    const worked = await runLocalWorkerIteration({} as never, [queue as never]);

    assertEquals(worked, true);
    await assertEquals(await queue.receive(), null);
    assertSpyCalls(queueSpy, 1);
})
  Deno.test('local worker loop - requeues with incremented attempts when a handler retries', async () => {
  queueSpy;
    scheduledSpy;
  queueSpy = async (batch: { messages: Array<{ retry(): void }> }) => {
      batch.messages[0].retry();
    } as any;

    const queue = createInMemoryQueue(LOCAL_QUEUE_NAMES.run) as ReturnType<typeof createInMemoryQueue> & {
      receive(): Promise<{ attempts?: number } | null>;
    };
    await queue.send({ runId: 'run-2' });

    const worked = await runLocalWorkerIteration({} as never, [queue as never]);
    const retried = await queue.receive();

    assertEquals(worked, true);
    assertObjectMatch(retried, { attempts: 2 });
    assertSpyCalls(queueSpy, 1);
})
  Deno.test('local worker loop - dispatches to the DLQ queue name after retries are exhausted', async () => {
  queueSpy;
    scheduledSpy;
  queueSpy = async (batch: { messages: Array<{ retry(): void }> }) => {
      batch.messages[0].retry();
    } as any;

    const queue = createInMemoryQueue(LOCAL_QUEUE_NAMES.run) as ReturnType<typeof createInMemoryQueue> & { receive(): Promise<unknown> };
    await (queue as { sendBatch(messages: Iterable<unknown>): Promise<void> }).sendBatch([
      { body: { runId: 'run-3' }, attempts: 3 },
    ]);

    const worked = await runLocalWorkerIteration({} as never, [queue as never]);

    assertEquals(worked, true);
    assertSpyCalls(queueSpy, 2);
    assertEquals(queueSpy.calls[0][0].queue, 'takos-runs');
    assertEquals(queueSpy.calls[1][0].queue, 'takos-runs-dlq');
    await assertEquals(await queue.receive(), null);
})