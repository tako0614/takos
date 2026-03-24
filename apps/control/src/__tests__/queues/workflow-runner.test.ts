import { beforeEach, describe, expect, it, vi } from 'vitest';

// The envGuard function returned by createEnvGuard. We control its behavior per-test.
const { envGuardFn } = vi.hoisted(() => ({
  envGuardFn: vi.fn<(env: Record<string, unknown>) => string | null>().mockReturnValue(null),
}));

const mocks = vi.hoisted(() => ({
  createWorkflowQueueConsumer: vi.fn(),
  handleWorkflowJobDlq: vi.fn(),
  handleDeploymentJob: vi.fn(),
  handleDeploymentJobDlq: vi.fn(),
  isValidDeploymentQueueMessage: vi.fn(),
}));

vi.mock('@/queues/workflow-jobs', () => ({
  createWorkflowQueueConsumer: mocks.createWorkflowQueueConsumer,
  handleWorkflowJobDlq: mocks.handleWorkflowJobDlq,
}));

vi.mock('@/queues/deploy-jobs', () => ({
  handleDeploymentJob: mocks.handleDeploymentJob,
  handleDeploymentJobDlq: mocks.handleDeploymentJobDlq,
  isValidDeploymentQueueMessage: mocks.isValidDeploymentQueueMessage,
}));

// createEnvGuard is called at module-scope in workflow-runner.ts.
// It must return a function (the guard). We return our controllable envGuardFn.
vi.mock('@/utils/validate-env', () => ({
  validateWorkflowRunnerEnv: vi.fn(),
  createEnvGuard: () => envGuardFn,
}));

import workflowRunner from '@/queues/workflow-runner';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface MockMessage {
  body: unknown;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
  attempts: number;
}

function createMessage(body: unknown, attempts = 1): MockMessage {
  return {
    body,
    ack: vi.fn(),
    retry: vi.fn(),
    attempts,
  };
}

function createBatch(queue: string, messages: MockMessage[]) {
  return {
    queue,
    messages,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // By default env guard passes (returns null = no error)
  envGuardFn.mockReturnValue(null);
});

describe('workflow-runner queue handler', () => {
  describe('environment validation', () => {
    it('retries all messages when env validation fails', async () => {
      envGuardFn.mockReturnValue('Missing DB binding');

      const msg1 = createMessage({ test: 1 });
      const msg2 = createMessage({ test: 2 });
      const batch = createBatch('takos-workflow-jobs', [msg1, msg2]);

      await workflowRunner.queue(batch as any, {} as any);

      expect(msg1.retry).toHaveBeenCalled();
      expect(msg2.retry).toHaveBeenCalled();
      expect(msg1.ack).not.toHaveBeenCalled();
      expect(msg2.ack).not.toHaveBeenCalled();
    });
  });

  describe('takos-workflow-jobs queue', () => {
    it('delegates to workflow queue consumer', async () => {
      const consumerQueue = vi.fn().mockResolvedValue(undefined);
      mocks.createWorkflowQueueConsumer.mockReturnValue({ queue: consumerQueue });

      const msg = createMessage({ type: 'job' });
      const batch = createBatch('takos-workflow-jobs', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      expect(mocks.createWorkflowQueueConsumer).toHaveBeenCalled();
      expect(consumerQueue).toHaveBeenCalledWith(batch);
    });

    it('strips -staging suffix from queue name', async () => {
      const consumerQueue = vi.fn().mockResolvedValue(undefined);
      mocks.createWorkflowQueueConsumer.mockReturnValue({ queue: consumerQueue });

      const msg = createMessage({ type: 'job' });
      const batch = createBatch('takos-workflow-jobs-staging', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      expect(consumerQueue).toHaveBeenCalled();
    });
  });

  describe('takos-workflow-jobs-dlq queue', () => {
    it('processes DLQ messages and acks on success', async () => {
      mocks.handleWorkflowJobDlq.mockResolvedValue(undefined);

      const msg = createMessage({ type: 'job', runId: 'r1' }, 3);
      const batch = createBatch('takos-workflow-jobs-dlq', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      expect(mocks.handleWorkflowJobDlq).toHaveBeenCalledWith(msg.body, expect.anything(), 3);
      expect(msg.ack).toHaveBeenCalled();
    });

    it('retries DLQ messages on failure', async () => {
      mocks.handleWorkflowJobDlq.mockRejectedValue(new Error('dlq handler failed'));

      const msg = createMessage({ type: 'job' });
      const batch = createBatch('takos-workflow-jobs-dlq', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      expect(msg.retry).toHaveBeenCalled();
      expect(msg.ack).not.toHaveBeenCalled();
    });
  });

  describe('takos-deployment-jobs queue', () => {
    it('processes valid deployment messages and acks', async () => {
      mocks.isValidDeploymentQueueMessage.mockReturnValue(true);
      mocks.handleDeploymentJob.mockResolvedValue(undefined);

      const msg = createMessage({ type: 'deployment', deploymentId: 'd1', version: 1, timestamp: Date.now() });
      const batch = createBatch('takos-deployment-jobs', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      expect(mocks.handleDeploymentJob).toHaveBeenCalledWith(msg.body, expect.anything());
      expect(msg.ack).toHaveBeenCalled();
    });

    it('acks invalid deployment messages without processing', async () => {
      mocks.isValidDeploymentQueueMessage.mockReturnValue(false);

      const msg = createMessage({ invalid: true });
      const batch = createBatch('takos-deployment-jobs', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      expect(mocks.handleDeploymentJob).not.toHaveBeenCalled();
      expect(msg.ack).toHaveBeenCalled();
    });

    it('retries deployment messages on failure', async () => {
      mocks.isValidDeploymentQueueMessage.mockReturnValue(true);
      mocks.handleDeploymentJob.mockRejectedValue(new Error('deploy failed'));

      const msg = createMessage({ type: 'deployment', deploymentId: 'd1', version: 1, timestamp: Date.now() });
      const batch = createBatch('takos-deployment-jobs', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      expect(msg.retry).toHaveBeenCalled();
      expect(msg.ack).not.toHaveBeenCalled();
    });
  });

  describe('takos-deployment-jobs-dlq queue', () => {
    it('processes deployment DLQ messages and acks', async () => {
      mocks.handleDeploymentJobDlq.mockResolvedValue(undefined);

      const msg = createMessage({ deploymentId: 'd1' }, 5);
      const batch = createBatch('takos-deployment-jobs-dlq', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      expect(mocks.handleDeploymentJobDlq).toHaveBeenCalledWith(msg.body, expect.anything(), 5);
      expect(msg.ack).toHaveBeenCalled();
    });

    it('retries deployment DLQ messages on failure', async () => {
      mocks.handleDeploymentJobDlq.mockRejectedValue(new Error('dlq failed'));

      const msg = createMessage({ deploymentId: 'd1' });
      const batch = createBatch('takos-deployment-jobs-dlq', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      expect(msg.retry).toHaveBeenCalled();
      expect(msg.ack).not.toHaveBeenCalled();
    });
  });

  describe('unknown queue', () => {
    it('acks all messages for unknown queues', async () => {
      const msg1 = createMessage({ test: 1 });
      const msg2 = createMessage({ test: 2 });
      const batch = createBatch('unknown-queue-name', [msg1, msg2]);

      await workflowRunner.queue(batch as any, {} as any);

      expect(msg1.ack).toHaveBeenCalled();
      expect(msg2.ack).toHaveBeenCalled();
    });
  });
});
