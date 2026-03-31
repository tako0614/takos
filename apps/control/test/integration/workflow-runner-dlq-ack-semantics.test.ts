import type { Env } from '@/shared/types';

import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  createWorkflowQueueConsumer: ((..._args: any[]) => undefined) as any,
  handleWorkflowJobDlq: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/validate-env'
// [Deno] vi.mock removed - manually stub imports from '@/runtime/queues/workflow-jobs'
import workflowRunner from '@/runtime/queues/workflow-runner';

type DlqBody = { runId: string };
type DlqBatch = Parameters<typeof workflowRunner.queue>[0];
type QueueMessage = DlqBatch['messages'][number] & { body: DlqBody };

function createDlqBatch(message: QueueMessage): DlqBatch {
  return {
    queue: 'takos-workflow-jobs-dlq',
    messages: [message],
    ackAll: ((..._args: any[]) => undefined) as any,
    retryAll: ((..._args: any[]) => undefined) as any,
  } satisfies DlqBatch;
}

function createQueueMessage(runId: string, attempts: number) {
  return {
    id: `msg-${runId}`,
    timestamp: new Date('2026-03-09T00:00:00Z'),
    body: { runId },
    attempts,
    ack: ((..._args: any[]) => undefined) as any,
    retry: ((..._args: any[]) => undefined) as any,
  } satisfies QueueMessage;
}


  Deno.test('workflow-runner DLQ ack semantics - acks only after successful DLQ handling', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const message = createQueueMessage('run-1', 1);

    mocks.handleWorkflowJobDlq = (async () => undefined) as any;

    await workflowRunner.queue(
      createDlqBatch(message),
      {} as Env
    );

    assertSpyCallArgs(mocks.handleWorkflowJobDlq, 0, [message.body, expect.anything(), 1]);
    assertSpyCalls(message.ack, 1);
    assertSpyCalls(message.retry, 0);
})
  Deno.test('workflow-runner DLQ ack semantics - retries DLQ message and does not ack when handler fails', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const message = createQueueMessage('run-2', 2);

    mocks.handleWorkflowJobDlq = (async () => { throw new Error('DLQ persistence failed'); }) as any;

    await workflowRunner.queue(
      createDlqBatch(message),
      {} as Env
    );

    assertSpyCallArgs(mocks.handleWorkflowJobDlq, 0, [message.body, expect.anything(), 2]);
    assertSpyCalls(message.retry, 1);
    assertSpyCalls(message.ack, 0);
})