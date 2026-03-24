import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKFLOW_QUEUE_MESSAGE_VERSION, type WorkflowJobQueueMessage } from '@/types';

const mocks = vi.hoisted(() => ({
  createWorkflowEngine: vi.fn(),
  getDb: vi.fn(),
  decrypt: vi.fn(),
  safeJsonParseOrDefault: vi.fn(),
  callRuntimeRequest: vi.fn(),
  getRunNotifierStub: vi.fn(),
  buildRunNotifierEmitRequest: vi.fn(),
  buildRunNotifierEmitPayload: vi.fn(),
}));

vi.mock('@/services/execution/workflow-engine', () => ({
  createWorkflowEngine: mocks.createWorkflowEngine,
}));

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: mocks.getDb };
});

vi.mock('@/utils', () => ({
  decrypt: mocks.decrypt,
  safeJsonParseOrDefault: mocks.safeJsonParseOrDefault,
}));

vi.mock('@/services/execution/runtime', () => ({
  callRuntimeRequest: mocks.callRuntimeRequest,
}));

vi.mock('@/services/run-notifier-client', () => ({
  buildRunNotifierEmitRequest: mocks.buildRunNotifierEmitRequest,
  getRunNotifierStub: mocks.getRunNotifierStub,
}));

vi.mock('@/services/run-notifier-payload', () => ({
  buildRunNotifierEmitPayload: mocks.buildRunNotifierEmitPayload,
}));

import { handleWorkflowJob } from '@/queues/workflow-job-handler';
import type { WorkflowQueueEnv } from '@/queues/workflow-types';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type EngineMock = {
  onJobStart: ReturnType<typeof vi.fn>;
  onJobComplete: ReturnType<typeof vi.fn>;
  updateStepStatus: ReturnType<typeof vi.fn>;
  storeJobLogs: ReturnType<typeof vi.fn>;
  cancelRun: ReturnType<typeof vi.fn>;
};

function createDrizzleMock(opts: {
  selectGet?: ReturnType<typeof vi.fn>;
  selectAll?: ReturnType<typeof vi.fn>;
}) {
  const selectGet = opts.selectGet ?? vi.fn().mockResolvedValue(null);
  const selectAll = opts.selectAll ?? vi.fn().mockResolvedValue([]);

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
    c.where = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    return c;
  };

  return {
    select: vi.fn().mockImplementation(() => chain()),
    update: vi.fn().mockImplementation(() => updateChain()),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ id: 1 }) }),
      }),
    })),
    delete: vi.fn().mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  };
}

function createEngineMock(): EngineMock {
  return {
    onJobStart: vi.fn().mockResolvedValue(undefined),
    onJobComplete: vi.fn().mockResolvedValue(undefined),
    updateStepStatus: vi.fn().mockResolvedValue(undefined),
    storeJobLogs: vi.fn().mockResolvedValue(undefined),
    cancelRun: vi.fn().mockResolvedValue(undefined),
  };
}

function createMessage(overrides: Partial<WorkflowJobQueueMessage> = {}): WorkflowJobQueueMessage {
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
    ...overrides,
  };
}

function createQueueEnv(overrides: Partial<WorkflowQueueEnv> = {}): WorkflowQueueEnv {
  return {
    DB: {} as any,
    GIT_OBJECTS: {} as any,
    WORKFLOW_QUEUE: { send: vi.fn() } as any,
    RUN_NOTIFIER: {} as any,
    RUNTIME_HOST: { fetch: vi.fn() },
    ...overrides,
  } as unknown as WorkflowQueueEnv;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.safeJsonParseOrDefault.mockImplementation((_value: unknown, fallback: unknown) => fallback);
  mocks.buildRunNotifierEmitPayload.mockReturnValue({});
  mocks.buildRunNotifierEmitRequest.mockReturnValue(
    new Request('https://notifier.test', { method: 'POST' })
  );
  mocks.getRunNotifierStub.mockReturnValue({
    fetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
  });
  mocks.decrypt.mockResolvedValue('decrypted-secret');
});

describe('handleWorkflowJob', () => {
  it('throws when GIT_OBJECTS is not configured', async () => {
    const env = createQueueEnv({ GIT_OBJECTS: undefined });

    await expect(handleWorkflowJob(createMessage(), env)).rejects.toThrow(
      'Git storage not configured'
    );
  });

  it('returns early when run or job record is missing', async () => {
    const engine = createEngineMock();
    mocks.createWorkflowEngine.mockReturnValue(engine);

    const selectGet = vi.fn()
      .mockResolvedValueOnce(null)    // runRecord
      .mockResolvedValueOnce(null);   // jobRecord
    const dbMock = createDrizzleMock({ selectGet });
    mocks.getDb.mockReturnValue(dbMock);

    await handleWorkflowJob(createMessage(), createQueueEnv());

    expect(engine.onJobStart).not.toHaveBeenCalled();
  });

  it('returns early when job is already completed', async () => {
    const engine = createEngineMock();
    mocks.createWorkflowEngine.mockReturnValue(engine);

    const selectGet = vi.fn()
      .mockResolvedValueOnce({ status: 'running' })   // runRecord
      .mockResolvedValueOnce({ status: 'completed' }); // jobRecord
    const dbMock = createDrizzleMock({ selectGet });
    mocks.getDb.mockReturnValue(dbMock);

    await handleWorkflowJob(createMessage(), createQueueEnv());

    expect(engine.onJobStart).not.toHaveBeenCalled();
  });

  it('cancels run when run status is cancelled', async () => {
    const engine = createEngineMock();
    mocks.createWorkflowEngine.mockReturnValue(engine);

    const selectGet = vi.fn()
      .mockResolvedValueOnce({ status: 'cancelled' })  // runRecord
      .mockResolvedValueOnce({ status: 'queued' });     // jobRecord
    const dbMock = createDrizzleMock({ selectGet });
    mocks.getDb.mockReturnValue(dbMock);

    await handleWorkflowJob(createMessage(), createQueueEnv());

    expect(engine.cancelRun).toHaveBeenCalledWith('run-1');
  });

  it('marks job skipped when run is already completed', async () => {
    const engine = createEngineMock();
    mocks.createWorkflowEngine.mockReturnValue(engine);

    const selectGet = vi.fn()
      .mockResolvedValueOnce({ status: 'completed' })  // runRecord
      .mockResolvedValueOnce({ status: 'queued' });     // jobRecord
    const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const dbMock = createDrizzleMock({ selectGet });
    // Override update to track calls
    dbMock.update = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: updateWhere,
      }),
    }));
    mocks.getDb.mockReturnValue(dbMock);

    await handleWorkflowJob(createMessage(), createQueueEnv());

    // markJobSkipped should have been called (updates job and steps)
    expect(dbMock.update).toHaveBeenCalled();
    expect(engine.onJobStart).not.toHaveBeenCalled();
  });

  it('returns early when job claim fails (already claimed)', async () => {
    const engine = createEngineMock();
    mocks.createWorkflowEngine.mockReturnValue(engine);

    const selectGet = vi.fn()
      .mockResolvedValueOnce({ status: 'running' })  // runRecord
      .mockResolvedValueOnce({ status: 'queued' });   // jobRecord
    const dbMock = createDrizzleMock({ selectGet });
    // Override update to simulate 0 changes (already claimed)
    dbMock.update = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
      }),
    }));
    mocks.getDb.mockReturnValue(dbMock);

    await handleWorkflowJob(createMessage(), createQueueEnv());

    expect(engine.onJobStart).not.toHaveBeenCalled();
  });

  it('throws when RUNTIME_HOST is not configured', async () => {
    const engine = createEngineMock();
    mocks.createWorkflowEngine.mockReturnValue(engine);

    const selectGet = vi.fn()
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'queued' })
      .mockResolvedValueOnce({ workflowPath: '.takos/ci.yml', inputs: '{}' })
      .mockResolvedValueOnce({ accountId: 'ws-1' });
    const dbMock = createDrizzleMock({ selectGet });
    dbMock.update = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      }),
    }));
    mocks.getDb.mockReturnValue(dbMock);

    const env = createQueueEnv({ RUNTIME_HOST: undefined });

    await handleWorkflowJob(createMessage(), env);

    // Should complete with failure since RUNTIME_HOST is missing
    expect(engine.onJobComplete).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ conclusion: 'failure' })
    );
  });

  it('uses jobKey as name when jobDefinition.name is not set', async () => {
    const engine = createEngineMock();
    mocks.createWorkflowEngine.mockReturnValue(engine);

    const selectGet = vi.fn()
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'queued' })
      .mockResolvedValueOnce({ workflowPath: '.takos/ci.yml', inputs: '{}' })
      .mockResolvedValueOnce({ accountId: 'ws-1' });
    const selectAll = vi.fn().mockResolvedValue([]);
    const dbMock = createDrizzleMock({ selectGet, selectAll });
    dbMock.update = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      }),
    }));
    mocks.getDb.mockReturnValue(dbMock);

    mocks.callRuntimeRequest.mockImplementation(async (_env: unknown, endpoint: string) => {
      if (endpoint.endsWith('/start')) return jsonResponse({ ok: true });
      if (endpoint.includes('/step/')) {
        return jsonResponse({
          exitCode: 0, stdout: 'ok', stderr: '', outputs: {}, conclusion: 'success',
        });
      }
      if (endpoint.endsWith('/complete')) return jsonResponse({ ok: true });
      return { ok: false, status: 404, text: async () => 'not found' } as any;
    });

    const msg = createMessage({
      jobDefinition: {
        'runs-on': 'ubuntu-latest',
        steps: [{ run: 'echo ok' }],
        // name is undefined
      },
    });

    await handleWorkflowJob(msg, createQueueEnv());

    // jobKey 'build' is used as jobName
    expect(engine.storeJobLogs).toHaveBeenCalledWith(
      'job-1',
      expect.stringContaining('=== Job: build ===')
    );
  });

  it('merges job env with job definition env', async () => {
    const engine = createEngineMock();
    mocks.createWorkflowEngine.mockReturnValue(engine);

    const selectGet = vi.fn()
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'queued' })
      .mockResolvedValueOnce({ workflowPath: '.takos/ci.yml', inputs: '{}' })
      .mockResolvedValueOnce({ accountId: 'ws-1' });
    const selectAll = vi.fn().mockResolvedValue([]);
    const dbMock = createDrizzleMock({ selectGet, selectAll });
    dbMock.update = vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      }),
    }));
    mocks.getDb.mockReturnValue(dbMock);

    mocks.callRuntimeRequest.mockImplementation(async (_env: unknown, endpoint: string) => {
      if (endpoint.endsWith('/start')) return jsonResponse({ ok: true });
      if (endpoint.includes('/step/')) {
        return jsonResponse({
          exitCode: 0, stdout: 'ok', stderr: '', outputs: {}, conclusion: 'success',
        });
      }
      if (endpoint.endsWith('/complete')) return jsonResponse({ ok: true });
      return { ok: false, status: 404, text: async () => '' } as any;
    });

    const msg = createMessage({
      env: { CI: 'true', FROM_MSG: 'yes' },
      jobDefinition: {
        name: 'Build',
        'runs-on': 'ubuntu-latest',
        env: { FROM_DEF: 'yes', CI: 'false' },
        steps: [{ run: 'echo ok' }],
      },
    });

    await handleWorkflowJob(msg, createQueueEnv());

    // The runtime start call should have the merged env
    // jobDefinition.env overrides message.env for CI
    expect(mocks.callRuntimeRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('/start'),
      expect.objectContaining({
        body: expect.objectContaining({
          env: expect.objectContaining({
            CI: 'false',
            FROM_MSG: 'yes',
            FROM_DEF: 'yes',
          }),
        }),
      })
    );
  });
});
