import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKFLOW_QUEUE_MESSAGE_VERSION, type WorkflowJobQueueMessage } from '@/types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  createWorkflowEngine: vi.fn(),
  isValidWorkflowJobQueueMessage: vi.fn(),
  getRunNotifierStub: vi.fn(),
  buildRunNotifierEmitRequest: vi.fn(),
  buildRunNotifierEmitPayload: vi.fn(),
}));

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: mocks.getDb };
});

vi.mock('@/types', async () => {
  const actual = await vi.importActual<typeof import('@/types')>('@/types');
  return {
    ...actual,
    isValidWorkflowJobQueueMessage: mocks.isValidWorkflowJobQueueMessage,
  };
});

vi.mock('@/services/execution/workflow-engine', () => ({
  createWorkflowEngine: mocks.createWorkflowEngine,
}));

vi.mock('@/utils', () => ({
  safeJsonParseOrDefault: vi.fn(),
  decrypt: vi.fn(),
}));

vi.mock('@/services/execution/runtime', () => ({
  callRuntimeRequest: vi.fn(),
}));

vi.mock('@/services/run-notifier-client', () => ({
  buildRunNotifierEmitRequest: mocks.buildRunNotifierEmitRequest,
  getRunNotifierStub: mocks.getRunNotifierStub,
}));

vi.mock('@/services/run-notifier-payload', () => ({
  buildRunNotifierEmitPayload: mocks.buildRunNotifierEmitPayload,
}));

import { handleWorkflowJobDlq } from '@/queues/workflow-dlq';
import type { WorkflowQueueEnv } from '@/queues/workflow-types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createDrizzleMock(opts: {
  selectGet?: ReturnType<typeof vi.fn>;
  selectAll?: ReturnType<typeof vi.fn>;
  updateWhere?: ReturnType<typeof vi.fn>;
} = {}) {
  const selectGet = opts.selectGet ?? vi.fn().mockResolvedValue(null);
  const selectAll = opts.selectAll ?? vi.fn().mockResolvedValue([]);
  const updateWhere = opts.updateWhere ?? vi.fn().mockResolvedValue({ meta: { changes: 1 } });

  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = vi.fn().mockReturnValue(c);
    c.where = vi.fn().mockReturnValue(c);
    c.orderBy = vi.fn().mockReturnValue(c);
    c.limit = vi.fn().mockReturnValue(c);
    c.get = selectGet;
    c.all = selectAll;
    return c;
  };

  const updateChain = () => {
    const c: Record<string, unknown> = {};
    c.set = vi.fn().mockReturnValue(c);
    c.where = updateWhere;
    return c;
  };

  return {
    select: vi.fn().mockImplementation(() => chain()),
    update: vi.fn().mockImplementation(() => updateChain()),
  };
}

function createEngine() {
  return {
    onJobComplete: vi.fn().mockResolvedValue(undefined),
    storeJobLogs: vi.fn().mockResolvedValue(undefined),
  };
}

function createEnv(overrides: Partial<WorkflowQueueEnv> = {}): WorkflowQueueEnv {
  return {
    DB: {} as any,
    RUN_NOTIFIER: {} as any,
    GIT_OBJECTS: {} as any,
    WORKFLOW_QUEUE: { send: vi.fn() } as any,
    ...overrides,
  } as unknown as WorkflowQueueEnv;
}

function validMessage(): WorkflowJobQueueMessage {
  return {
    version: WORKFLOW_QUEUE_MESSAGE_VERSION,
    type: 'job',
    runId: 'run-1',
    jobId: 'job-1',
    repoId: 'repo-1',
    ref: 'refs/heads/main',
    sha: 'a'.repeat(40),
    jobKey: 'build',
    jobDefinition: {
      name: 'Build',
      'runs-on': 'ubuntu-latest',
      steps: [{ run: 'echo ok' }],
    },
    env: { CI: 'true' },
    secretIds: [],
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.buildRunNotifierEmitPayload.mockReturnValue({});
  mocks.buildRunNotifierEmitRequest.mockReturnValue(
    new Request('https://notifier.test', { method: 'POST' })
  );
  mocks.getRunNotifierStub.mockReturnValue({
    fetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  });
});

// ---------------------------------------------------------------------------
// handleWorkflowJobDlq
// ---------------------------------------------------------------------------

describe('handleWorkflowJobDlq', () => {
  it('skips invalid messages', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(false);

    await handleWorkflowJobDlq({ invalid: true }, createEnv(), 3);

    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('skips when job is already completed', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(true);

    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'completed', name: 'Build' }),
    });
    mocks.getDb.mockReturnValue(dbMock);

    await handleWorkflowJobDlq(validMessage(), createEnv(), 3);

    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('skips when job record not found', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(true);

    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue(null),
    });
    mocks.getDb.mockReturnValue(dbMock);

    await handleWorkflowJobDlq(validMessage(), createEnv(), 3);

    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('marks job and run as failed', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(true);

    const engine = createEngine();
    mocks.createWorkflowEngine.mockReturnValue(engine);

    const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'in_progress', name: 'Build' }),
      selectAll: vi.fn().mockResolvedValue([
        { number: 1, name: 'Step 1' },
      ]),
      updateWhere,
    });
    mocks.getDb.mockReturnValue(dbMock);

    await handleWorkflowJobDlq(validMessage(), createEnv(), 5);

    // Update for markJobFailed + update for run status
    expect(dbMock.update).toHaveBeenCalled();
    expect(engine.storeJobLogs).toHaveBeenCalledWith('job-1', expect.stringContaining('DLQ'));
    expect(engine.onJobComplete).toHaveBeenCalledWith('job-1', expect.objectContaining({
      conclusion: 'failure',
    }));
  });

  it('emits event without bucket but still marks job failed', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(true);

    const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'in_progress', name: 'Build' }),
      updateWhere,
    });
    mocks.getDb.mockReturnValue(dbMock);

    // No GIT_OBJECTS bucket
    const env = createEnv({ GIT_OBJECTS: undefined });

    await handleWorkflowJobDlq(validMessage(), env, 2);

    // Should still update the DB
    expect(dbMock.update).toHaveBeenCalled();
    // Should NOT create engine (no bucket)
    expect(mocks.createWorkflowEngine).not.toHaveBeenCalled();
  });

  it('handles attempt count in DLQ log', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(true);

    const engine = createEngine();
    mocks.createWorkflowEngine.mockReturnValue(engine);

    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'queued', name: 'Test' }),
      selectAll: vi.fn().mockResolvedValue([]),
    });
    mocks.getDb.mockReturnValue(dbMock);

    await handleWorkflowJobDlq(validMessage(), createEnv(), 7);

    expect(engine.storeJobLogs).toHaveBeenCalledWith(
      'job-1',
      expect.stringContaining('attempts=7')
    );
  });

  it('handles undefined attempts', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(true);

    const engine = createEngine();
    mocks.createWorkflowEngine.mockReturnValue(engine);

    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'queued', name: 'Test' }),
      selectAll: vi.fn().mockResolvedValue([]),
    });
    mocks.getDb.mockReturnValue(dbMock);

    await handleWorkflowJobDlq(validMessage(), createEnv());

    expect(engine.storeJobLogs).toHaveBeenCalledWith(
      'job-1',
      expect.stringContaining('attempts=unknown')
    );
  });

  it('re-throws when failJobWithResults (onJobComplete) fails', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(true);

    const engine = createEngine();
    engine.onJobComplete.mockRejectedValue(new Error('db error'));
    mocks.createWorkflowEngine.mockReturnValue(engine);

    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'in_progress', name: 'Build' }),
      selectAll: vi.fn().mockResolvedValue([]),
    });
    mocks.getDb.mockReturnValue(dbMock);

    await expect(
      handleWorkflowJobDlq(validMessage(), createEnv(), 3)
    ).rejects.toThrow('db error');
  });

  it('handles storeJobLogs failure gracefully', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(true);

    const engine = createEngine();
    engine.storeJobLogs.mockRejectedValue(new Error('r2 error'));
    mocks.createWorkflowEngine.mockReturnValue(engine);

    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'in_progress', name: 'Build' }),
      selectAll: vi.fn().mockResolvedValue([]),
    });
    mocks.getDb.mockReturnValue(dbMock);

    // Should not throw -- storeJobLogs error is caught
    await handleWorkflowJobDlq(validMessage(), createEnv(), 1);

    expect(engine.onJobComplete).toHaveBeenCalled();
  });

  it('handles run update failure gracefully', async () => {
    mocks.isValidWorkflowJobQueueMessage.mockReturnValue(true);

    const engine = createEngine();
    mocks.createWorkflowEngine.mockReturnValue(engine);

    let updateCallCount = 0;
    const updateWhere = vi.fn().mockImplementation(async () => {
      updateCallCount++;
      // Second update (for run) throws
      if (updateCallCount === 2) {
        throw new Error('run update failed');
      }
      return { meta: { changes: 1 } };
    });
    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'in_progress', name: 'Build' }),
      selectAll: vi.fn().mockResolvedValue([]),
      updateWhere,
    });
    mocks.getDb.mockReturnValue(dbMock);

    // Should not throw -- run update error is caught
    await handleWorkflowJobDlq(validMessage(), createEnv(), 1);
  });
});
