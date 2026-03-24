import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handleWorkflowJob: vi.fn(),
  isValidWorkflowJobQueueMessage: vi.fn(),
}));

vi.mock('@/queues/workflow-job-handler', () => ({
  handleWorkflowJob: mocks.handleWorkflowJob,
}));

vi.mock('@/types', async () => {
  const actual = await vi.importActual<typeof import('@/types')>('@/types');
  return {
    ...actual,
    isValidWorkflowJobQueueMessage: mocks.isValidWorkflowJobQueueMessage,
  };
});

import { createWorkflowQueueConsumer } from '@/queues/workflow-jobs';
import type { WorkflowQueueEnv } from '@/queues/workflow-types';

function createMockEnv(): WorkflowQueueEnv {
  return {
    DB: {} as any,
    RUN_NOTIFIER: {} as any,
  } as unknown as WorkflowQueueEnv;
}

interface MockBatchMessage {
  body: unknown;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
}

function createBatchMessage(body: unknown): MockBatchMessage {
  return {
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createWorkflowQueueConsumer', () => {
  it('creates a consumer with a queue method', () => {
    const consumer = createWorkflowQueueConsumer(createMockEnv());
    expect(consumer).toBeDefined();
    expect(typeof consumer.queue).toBe('function');
  });

  it('acks invalid messages without processing', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(false);

    const consumer = createWorkflowQueueConsumer(createMockEnv());
    const msg = createBatchMessage({ invalid: true });

    await consumer.queue({ messages: [msg] });

    expect(msg.ack).toHaveBeenCalled();
    expect(mocks.handleWorkflowJob).not.toHaveBeenCalled();
  });

  it('processes valid messages and acks on success', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(true);
    mocks.handleWorkflowJob.mockResolvedValue(undefined);

    const consumer = createWorkflowQueueConsumer(createMockEnv());
    const msg = createBatchMessage({ type: 'job', runId: 'r1' });

    await consumer.queue({ messages: [msg] });

    expect(mocks.handleWorkflowJob).toHaveBeenCalledWith(msg.body, expect.anything());
    expect(msg.ack).toHaveBeenCalled();
  });

  it('retries on handler failure', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(true);
    mocks.handleWorkflowJob.mockRejectedValue(new Error('handler crashed'));

    const consumer = createWorkflowQueueConsumer(createMockEnv());
    const msg = createBatchMessage({ type: 'job' });

    await consumer.queue({ messages: [msg] });

    expect(msg.retry).toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('processes batch of mixed valid/invalid messages', async () => {
    mocks.isValidWorkflowJobQueueMessage
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    mocks.handleWorkflowJob.mockResolvedValue(undefined);

    const consumer = createWorkflowQueueConsumer(createMockEnv());
    const msg1 = createBatchMessage({ invalid: true });
    const msg2 = createBatchMessage({ type: 'job' });
    const msg3 = createBatchMessage({ also: 'invalid' });

    await consumer.queue({ messages: [msg1, msg2, msg3] });

    expect(msg1.ack).toHaveBeenCalled();
    expect(msg2.ack).toHaveBeenCalled();
    expect(msg3.ack).toHaveBeenCalled();
    expect(mocks.handleWorkflowJob).toHaveBeenCalledTimes(1);
  });

  it('continues processing after one message fails', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(true);
    mocks.handleWorkflowJob
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce(undefined);

    const consumer = createWorkflowQueueConsumer(createMockEnv());
    const msg1 = createBatchMessage({ type: 'job', runId: '1' });
    const msg2 = createBatchMessage({ type: 'job', runId: '2' });

    await consumer.queue({ messages: [msg1, msg2] });

    expect(msg1.retry).toHaveBeenCalled();
    expect(msg1.ack).not.toHaveBeenCalled();
    expect(msg2.ack).toHaveBeenCalled();
    expect(msg2.retry).not.toHaveBeenCalled();
  });

  it('handles empty batch', async () => {
    const consumer = createWorkflowQueueConsumer(createMockEnv());
    await expect(consumer.queue({ messages: [] })).resolves.toBeUndefined();
  });
});
