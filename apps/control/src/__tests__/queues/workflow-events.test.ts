import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRunNotifierStub: vi.fn(),
  buildRunNotifierEmitRequest: vi.fn(),
  buildRunNotifierEmitPayload: vi.fn(),
}));

// workflow-events.ts imports from '../../application/services/run-notifier' (barrel)
vi.mock('@/services/run-notifier', () => ({
  getRunNotifierStub: mocks.getRunNotifierStub,
  buildRunNotifierEmitRequest: mocks.buildRunNotifierEmitRequest,
  buildRunNotifierEmitPayload: mocks.buildRunNotifierEmitPayload,
}));

import { emitWorkflowEvent } from '@/queues/workflow-events';
import type { WorkflowQueueEnv } from '@/queues/workflow-types';

function createMockEnv(): WorkflowQueueEnv {
  return {
    DB: {} as any,
    RUN_NOTIFIER: {} as any,
  } as unknown as WorkflowQueueEnv;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('emitWorkflowEvent', () => {
  it('emits a workflow event to the run notifier', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    mocks.getRunNotifierStub.mockReturnValue({ fetch: fetchMock });
    mocks.buildRunNotifierEmitPayload.mockReturnValue({ type: 'test', data: {} });
    mocks.buildRunNotifierEmitRequest.mockReturnValue(new Request('https://notifier.test', { method: 'POST' }));

    await emitWorkflowEvent(createMockEnv(), 'run-1', 'workflow.job.started', {
      runId: 'run-1',
      jobId: 'job-1',
      repoId: 'repo-1',
      jobKey: 'build',
      name: 'Build',
      startedAt: '2024-01-01T00:00:00Z',
    });

    expect(mocks.getRunNotifierStub).toHaveBeenCalledWith(expect.anything(), 'run-1');
    expect(mocks.buildRunNotifierEmitPayload).toHaveBeenCalledWith('run-1', 'workflow.job.started', expect.any(Object));
    expect(mocks.buildRunNotifierEmitRequest).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('does not throw when notifier fetch fails', async () => {
    mocks.getRunNotifierStub.mockReturnValue({
      fetch: vi.fn().mockRejectedValue(new Error('notifier down')),
    });
    mocks.buildRunNotifierEmitPayload.mockReturnValue({});
    mocks.buildRunNotifierEmitRequest.mockReturnValue(new Request('https://notifier.test', { method: 'POST' }));

    await expect(
      emitWorkflowEvent(createMockEnv(), 'run-1', 'workflow.job.completed', {
        runId: 'run-1',
        jobId: 'job-1',
        repoId: 'repo-1',
        jobKey: 'build',
        status: 'completed',
        conclusion: 'failure',
        completedAt: '2024-01-01T00:00:00Z',
      })
    ).resolves.toBeUndefined();
  });

  it('does not throw when getRunNotifierStub throws', async () => {
    mocks.getRunNotifierStub.mockImplementation(() => {
      throw new Error('stub not available');
    });

    await expect(
      emitWorkflowEvent(createMockEnv(), 'run-1', 'workflow.job.completed', {
        runId: 'run-1',
        jobId: 'job-1',
        repoId: 'repo-1',
        jobKey: 'build',
        status: 'completed',
        conclusion: 'success',
        completedAt: '2024-01-01T00:00:00Z',
      })
    ).resolves.toBeUndefined();
  });

  it('does not throw when buildRunNotifierEmitPayload throws', async () => {
    mocks.getRunNotifierStub.mockReturnValue({
      fetch: vi.fn().mockResolvedValue(new Response(null)),
    });
    mocks.buildRunNotifierEmitPayload.mockImplementation(() => {
      throw new Error('payload error');
    });

    await expect(
      emitWorkflowEvent(createMockEnv(), 'run-1', 'workflow.job.started', {
        runId: 'run-1',
        jobId: 'job-1',
        repoId: 'repo-1',
        jobKey: 'build',
        name: 'Build',
        startedAt: '2024-01-01T00:00:00Z',
      })
    ).resolves.toBeUndefined();
  });

  it('passes abort signal to buildRunNotifierEmitRequest', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    mocks.getRunNotifierStub.mockReturnValue({ fetch: fetchMock });
    mocks.buildRunNotifierEmitPayload.mockReturnValue({});
    mocks.buildRunNotifierEmitRequest.mockReturnValue(new Request('https://notifier.test'));

    await emitWorkflowEvent(createMockEnv(), 'run-1', 'workflow.job.started', {
      runId: 'run-1',
      jobId: 'job-1',
      repoId: 'repo-1',
      jobKey: 'build',
      name: 'Build',
      startedAt: '2024-01-01T00:00:00Z',
    });

    const signalArg = mocks.buildRunNotifierEmitRequest.mock.calls[0]?.[1];
    expect(signalArg).toBeInstanceOf(AbortSignal);
  });
});
