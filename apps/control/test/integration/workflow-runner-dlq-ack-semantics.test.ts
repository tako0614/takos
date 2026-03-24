import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  createWorkflowQueueConsumer: vi.fn(),
  handleWorkflowJobDlq: vi.fn(),
}));

vi.mock('@/shared/utils/validate-env', () => ({
  validateWorkflowRunnerEnv: vi.fn(),
  createEnvGuard: vi.fn(() => () => null),
}));

vi.mock('@/runtime/queues/workflow-jobs', () => ({
  createWorkflowQueueConsumer: mocks.createWorkflowQueueConsumer,
  handleWorkflowJobDlq: mocks.handleWorkflowJobDlq,
}));

import workflowRunner from '@/runtime/queues/workflow-runner';

type DlqBody = { runId: string };
type DlqBatch = Parameters<typeof workflowRunner.queue>[0];
type QueueMessage = DlqBatch['messages'][number] & { body: DlqBody };

function createDlqBatch(message: QueueMessage): DlqBatch {
  return {
    queue: 'takos-workflow-jobs-dlq',
    messages: [message],
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } satisfies DlqBatch;
}

function createQueueMessage(runId: string, attempts: number) {
  return {
    id: `msg-${runId}`,
    timestamp: new Date('2026-03-09T00:00:00Z'),
    body: { runId },
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  } satisfies QueueMessage;
}

describe('workflow-runner DLQ ack semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acks only after successful DLQ handling', async () => {
    const message = createQueueMessage('run-1', 1);

    mocks.handleWorkflowJobDlq.mockResolvedValue(undefined);

    await workflowRunner.queue(
      createDlqBatch(message),
      {} as Env
    );

    expect(mocks.handleWorkflowJobDlq).toHaveBeenCalledWith(message.body, expect.anything(), 1);
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();
  });

  it('retries DLQ message and does not ack when handler fails', async () => {
    const message = createQueueMessage('run-2', 2);

    mocks.handleWorkflowJobDlq.mockRejectedValue(new Error('DLQ persistence failed'));

    await workflowRunner.queue(
      createDlqBatch(message),
      {} as Env
    );

    expect(mocks.handleWorkflowJobDlq).toHaveBeenCalledWith(message.body, expect.anything(), 2);
    expect(message.retry).toHaveBeenCalledTimes(1);
    expect(message.ack).not.toHaveBeenCalled();
  });
});
