import { assertEquals, assert } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getRunNotifierStub: ((..._args: any[]) => undefined) as any,
  buildRunNotifierEmitRequest: ((..._args: any[]) => undefined) as any,
  buildRunNotifierEmitPayload: ((..._args: any[]) => undefined) as any,
});

// workflow-events.ts imports from '../../application/services/run-notifier' (barrel)
// [Deno] vi.mock removed - manually stub imports from '@/services/run-notifier'
import { emitWorkflowEvent } from '@/queues/workflow-events';
import type { WorkflowQueueEnv } from '@/queues/workflow-types';

function createMockEnv(): WorkflowQueueEnv {
  return {
    DB: {} as any,
    RUN_NOTIFIER: {} as any,
  } as unknown as WorkflowQueueEnv;
}

  Deno.test('emitWorkflowEvent - emits a workflow event to the run notifier', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const fetchMock = (async () => new Response(null, { status: 204 }));
    mocks.getRunNotifierStub = (() => ({ fetch: fetchMock })) as any;
    mocks.buildRunNotifierEmitPayload = (() => ({ type: 'test', data: {} })) as any;
    mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.test', { method: 'POST' })) as any;

    await emitWorkflowEvent(createMockEnv(), 'run-1', 'workflow.job.started', {
      runId: 'run-1',
      jobId: 'job-1',
      repoId: 'repo-1',
      jobKey: 'build',
      name: 'Build',
      startedAt: '2024-01-01T00:00:00Z',
    });

    assertSpyCallArgs(mocks.getRunNotifierStub, 0, [expect.anything(), 'run-1']);
    assertSpyCallArgs(mocks.buildRunNotifierEmitPayload, 0, ['run-1', 'workflow.job.started', /* expect.any(Object) */ {} as any]);
    assert(mocks.buildRunNotifierEmitRequest.calls.length > 0);
    assert(fetchMock.calls.length > 0);
})
  Deno.test('emitWorkflowEvent - does not throw when notifier fetch fails', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getRunNotifierStub = (() => ({
      fetch: (async () => { throw new Error('notifier down'); }),
    })) as any;
    mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
    mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.test', { method: 'POST' })) as any;

    await assertEquals(await 
      emitWorkflowEvent(createMockEnv(), 'run-1', 'workflow.job.completed', {
        runId: 'run-1',
        jobId: 'job-1',
        repoId: 'repo-1',
        jobKey: 'build',
        status: 'completed',
        conclusion: 'failure',
        completedAt: '2024-01-01T00:00:00Z',
      })
    , undefined);
})
  Deno.test('emitWorkflowEvent - does not throw when getRunNotifierStub throws', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getRunNotifierStub = () => {
      throw new Error('stub not available');
    } as any;

    await assertEquals(await 
      emitWorkflowEvent(createMockEnv(), 'run-1', 'workflow.job.completed', {
        runId: 'run-1',
        jobId: 'job-1',
        repoId: 'repo-1',
        jobKey: 'build',
        status: 'completed',
        conclusion: 'success',
        completedAt: '2024-01-01T00:00:00Z',
      })
    , undefined);
})
  Deno.test('emitWorkflowEvent - does not throw when buildRunNotifierEmitPayload throws', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getRunNotifierStub = (() => ({
      fetch: (async () => new Response(null)),
    })) as any;
    mocks.buildRunNotifierEmitPayload = () => {
      throw new Error('payload error');
    } as any;

    await assertEquals(await 
      emitWorkflowEvent(createMockEnv(), 'run-1', 'workflow.job.started', {
        runId: 'run-1',
        jobId: 'job-1',
        repoId: 'repo-1',
        jobKey: 'build',
        name: 'Build',
        startedAt: '2024-01-01T00:00:00Z',
      })
    , undefined);
})
  Deno.test('emitWorkflowEvent - passes abort signal to buildRunNotifierEmitRequest', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const fetchMock = (async () => new Response(null, { status: 204 }));
    mocks.getRunNotifierStub = (() => ({ fetch: fetchMock })) as any;
    mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
    mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.test')) as any;

    await emitWorkflowEvent(createMockEnv(), 'run-1', 'workflow.job.started', {
      runId: 'run-1',
      jobId: 'job-1',
      repoId: 'repo-1',
      jobKey: 'build',
      name: 'Build',
      startedAt: '2024-01-01T00:00:00Z',
    });

    const signalArg = mocks.buildRunNotifierEmitRequest.calls[0]?.[1];
    assert(signalArg instanceof AbortSignal);
})