// The envGuard function returned by createEnvGuard. We control its behavior per-test.
import { assert } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const { envGuardFn } = ({
  envGuardFn: vi.fn<(env: Record<string, unknown>) => string | null>() = (() => null) as any,
});

const mocks = ({
  createWorkflowQueueConsumer: ((..._args: any[]) => undefined) as any,
  handleWorkflowJobDlq: ((..._args: any[]) => undefined) as any,
  handleDeploymentJob: ((..._args: any[]) => undefined) as any,
  handleDeploymentJobDlq: ((..._args: any[]) => undefined) as any,
  isValidDeploymentQueueMessage: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/queues/workflow-jobs'
// [Deno] vi.mock removed - manually stub imports from '@/queues/deploy-jobs'
// createEnvGuard is called at module-scope in workflow-runner.ts.
// It must return a function (the guard). We return our controllable envGuardFn.
// [Deno] vi.mock removed - manually stub imports from '@/utils/validate-env'
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
    ack: ((..._args: any[]) => undefined) as any,
    retry: ((..._args: any[]) => undefined) as any,
    attempts,
  };
}

function createBatch(queue: string, messages: MockMessage[]) {
  return {
    queue,
    messages,
  };
}

  
    Deno.test('workflow-runner queue handler - environment validation - retries all messages when env validation fails', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // By default env guard passes (returns null = no error)
  envGuardFn = (() => null) as any;
  envGuardFn = (() => 'Missing DB binding') as any;

      const msg1 = createMessage({ test: 1 });
      const msg2 = createMessage({ test: 2 });
      const batch = createBatch('takos-workflow-jobs', [msg1, msg2]);

      await workflowRunner.queue(batch as any, {} as any);

      assert(msg1.retry.calls.length > 0);
      assert(msg2.retry.calls.length > 0);
      assertSpyCalls(msg1.ack, 0);
      assertSpyCalls(msg2.ack, 0);
})  
  
    Deno.test('workflow-runner queue handler - takos-workflow-jobs queue - delegates to workflow queue consumer', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // By default env guard passes (returns null = no error)
  envGuardFn = (() => null) as any;
  const consumerQueue = (async () => undefined);
      mocks.createWorkflowQueueConsumer = (() => ({ queue: consumerQueue })) as any;

      const msg = createMessage({ type: 'job' });
      const batch = createBatch('takos-workflow-jobs', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      assert(mocks.createWorkflowQueueConsumer.calls.length > 0);
      assertSpyCallArgs(consumerQueue, 0, [batch]);
})
    Deno.test('workflow-runner queue handler - takos-workflow-jobs queue - strips -staging suffix from queue name', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // By default env guard passes (returns null = no error)
  envGuardFn = (() => null) as any;
  const consumerQueue = (async () => undefined);
      mocks.createWorkflowQueueConsumer = (() => ({ queue: consumerQueue })) as any;

      const msg = createMessage({ type: 'job' });
      const batch = createBatch('takos-workflow-jobs-staging', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      assert(consumerQueue.calls.length > 0);
})  
  
    Deno.test('workflow-runner queue handler - takos-workflow-jobs-dlq queue - processes DLQ messages and acks on success', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // By default env guard passes (returns null = no error)
  envGuardFn = (() => null) as any;
  mocks.handleWorkflowJobDlq = (async () => undefined) as any;

      const msg = createMessage({ type: 'job', runId: 'r1' }, 3);
      const batch = createBatch('takos-workflow-jobs-dlq', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      assertSpyCallArgs(mocks.handleWorkflowJobDlq, 0, [msg.body, expect.anything(), 3]);
      assert(msg.ack.calls.length > 0);
})
    Deno.test('workflow-runner queue handler - takos-workflow-jobs-dlq queue - retries DLQ messages on failure', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // By default env guard passes (returns null = no error)
  envGuardFn = (() => null) as any;
  mocks.handleWorkflowJobDlq = (async () => { throw new Error('dlq handler failed'); }) as any;

      const msg = createMessage({ type: 'job' });
      const batch = createBatch('takos-workflow-jobs-dlq', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      assert(msg.retry.calls.length > 0);
      assertSpyCalls(msg.ack, 0);
})  
  
    Deno.test('workflow-runner queue handler - takos-deployment-jobs queue - processes valid deployment messages and acks', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // By default env guard passes (returns null = no error)
  envGuardFn = (() => null) as any;
  mocks.isValidDeploymentQueueMessage = (() => true) as any;
      mocks.handleDeploymentJob = (async () => undefined) as any;

      const msg = createMessage({ type: 'deployment', deploymentId: 'd1', version: 1, timestamp: Date.now() });
      const batch = createBatch('takos-deployment-jobs', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      assertSpyCallArgs(mocks.handleDeploymentJob, 0, [msg.body, expect.anything()]);
      assert(msg.ack.calls.length > 0);
})
    Deno.test('workflow-runner queue handler - takos-deployment-jobs queue - acks invalid deployment messages without processing', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // By default env guard passes (returns null = no error)
  envGuardFn = (() => null) as any;
  mocks.isValidDeploymentQueueMessage = (() => false) as any;

      const msg = createMessage({ invalid: true });
      const batch = createBatch('takos-deployment-jobs', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      assertSpyCalls(mocks.handleDeploymentJob, 0);
      assert(msg.ack.calls.length > 0);
})
    Deno.test('workflow-runner queue handler - takos-deployment-jobs queue - retries deployment messages on failure', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // By default env guard passes (returns null = no error)
  envGuardFn = (() => null) as any;
  mocks.isValidDeploymentQueueMessage = (() => true) as any;
      mocks.handleDeploymentJob = (async () => { throw new Error('deploy failed'); }) as any;

      const msg = createMessage({ type: 'deployment', deploymentId: 'd1', version: 1, timestamp: Date.now() });
      const batch = createBatch('takos-deployment-jobs', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      assert(msg.retry.calls.length > 0);
      assertSpyCalls(msg.ack, 0);
})  
  
    Deno.test('workflow-runner queue handler - takos-deployment-jobs-dlq queue - processes deployment DLQ messages and acks', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // By default env guard passes (returns null = no error)
  envGuardFn = (() => null) as any;
  mocks.handleDeploymentJobDlq = (async () => undefined) as any;

      const msg = createMessage({ deploymentId: 'd1' }, 5);
      const batch = createBatch('takos-deployment-jobs-dlq', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      assertSpyCallArgs(mocks.handleDeploymentJobDlq, 0, [msg.body, expect.anything(), 5]);
      assert(msg.ack.calls.length > 0);
})
    Deno.test('workflow-runner queue handler - takos-deployment-jobs-dlq queue - retries deployment DLQ messages on failure', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // By default env guard passes (returns null = no error)
  envGuardFn = (() => null) as any;
  mocks.handleDeploymentJobDlq = (async () => { throw new Error('dlq failed'); }) as any;

      const msg = createMessage({ deploymentId: 'd1' });
      const batch = createBatch('takos-deployment-jobs-dlq', [msg]);

      await workflowRunner.queue(batch as any, {} as any);

      assert(msg.retry.calls.length > 0);
      assertSpyCalls(msg.ack, 0);
})  
  
    Deno.test('workflow-runner queue handler - unknown queue - acks all messages for unknown queues', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // By default env guard passes (returns null = no error)
  envGuardFn = (() => null) as any;
  const msg1 = createMessage({ test: 1 });
      const msg2 = createMessage({ test: 2 });
      const batch = createBatch('unknown-queue-name', [msg1, msg2]);

      await workflowRunner.queue(batch as any, {} as any);

      assert(msg1.ack.calls.length > 0);
      assert(msg2.ack.calls.length > 0);
})  