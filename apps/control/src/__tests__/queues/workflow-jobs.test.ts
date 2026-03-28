import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database, Queue, R2Bucket } from '@cloudflare/workers-types';
import {
  WORKFLOW_QUEUE_MESSAGE_VERSION,
  type WorkflowJobQueueMessage,
} from '@/types';

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
  return {
    ...actual,
    getDb: mocks.getDb,
  };
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

import { handleWorkflowJob, type WorkflowQueueEnv } from '@/queues/workflow-jobs';

type EngineMock = {
  onJobStart: ReturnType<typeof vi.fn>;
  onJobComplete: ReturnType<typeof vi.fn>;
  updateStepStatus: ReturnType<typeof vi.fn>;
  storeJobLogs: ReturnType<typeof vi.fn>;
  cancelRun: ReturnType<typeof vi.fn>;
};

/**
 * Creates a chainable drizzle mock that supports:
 *   db.select(cols).from(table).where(...).get() -> single row
 *   db.select(cols).from(table).where(...).orderBy(...).all() -> array
 *   db.update(table).set(data).where(...) -> void
 *   db.insert(table).values(data).returning().get() -> row
 *
 * Configure with selectGet/selectAll to control query results.
 */
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

  const insertChain = () => {
    const c: Record<string, unknown> = {};
    c.values = vi.fn().mockReturnValue(c);
    c.returning = vi.fn().mockReturnValue(c);
    c.get = vi.fn().mockResolvedValue({ id: 1 });
    return c;
  };

  return {
    select: vi.fn().mockImplementation(() => chain()),
    update: vi.fn().mockImplementation(() => updateChain()),
    insert: vi.fn().mockImplementation(() => insertChain()),
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
    env: {
      CI: 'true',
    },
    secretIds: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

function createQueueEnv(overrides: Partial<WorkflowQueueEnv> = {}): WorkflowQueueEnv {
  return {
    DB: {} as D1Database,
    GIT_OBJECTS: {} as R2Bucket,
    WORKFLOW_QUEUE: { send: vi.fn() } as unknown as Queue<WorkflowJobQueueMessage>,
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

describe('handleWorkflowJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.safeJsonParseOrDefault.mockImplementation((_value: unknown, fallback: unknown) => fallback);
    mocks.buildRunNotifierEmitPayload.mockReturnValue({});
    mocks.buildRunNotifierEmitRequest.mockReturnValue(new Request('https://notifier.example.test', {
      method: 'POST',
    }));
    mocks.getRunNotifierStub.mockReturnValue({
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    });
    mocks.decrypt.mockResolvedValue('decrypted-secret');
  });

  it('does not fail missing step secrets when job.if is false', async () => {
    const engine = createEngineMock();

    // The production code calls db.select(...).from(table).where(...).get() multiple times.
    // Order: getRunStatus -> status, getJobStatus -> status, getRunContext -> workflowPath/inputs
    const selectGet = vi.fn()
      .mockResolvedValueOnce({ status: 'running' })     // getRunStatus
      .mockResolvedValueOnce({ status: 'queued' })       // getJobStatus
      .mockResolvedValueOnce({ workflowPath: '.takos/workflows/ci.yml', inputs: '{}' }); // getRunContext
    const selectAll = vi.fn().mockResolvedValue([]);
    const dbMock = createDrizzleMock({ selectGet, selectAll });

    mocks.createWorkflowEngine.mockReturnValue(engine);
    mocks.getDb.mockReturnValue(dbMock);

    const message = createMessage({
      jobDefinition: {
        name: 'Build',
        'runs-on': 'ubuntu-latest',
        if: '${{ env.SHOULD_RUN }}',
        steps: [
          {
            name: 'never-run',
            run: 'echo should-not-run',
            env: {
              SECRET_REF: '${{ secrets.MISSING_SECRET }}',
            },
          },
        ],
      },
      env: {},
    });

    await expect(handleWorkflowJob(message, createQueueEnv())).resolves.toBeUndefined();

    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.callRuntimeRequest).not.toHaveBeenCalled();
    expect(engine.onJobComplete).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ conclusion: 'skipped' })
    );
  });

  it('passes workflow runId to runtime start payload without custom warning logs', async () => {
    const engine = createEngineMock();

    // Order: getRunStatus -> status, getJobStatus -> status, getRunContext -> workflowPath/inputs,
    // getWorkspaceIdFromRepoId -> accountId
    const selectGet = vi.fn()
      .mockResolvedValueOnce({ status: 'running' })     // getRunStatus
      .mockResolvedValueOnce({ status: 'queued' })       // getJobStatus
      .mockResolvedValueOnce({ workflowPath: '.takos/workflows/ci.yml', inputs: '{}' }) // getRunContext
      .mockResolvedValueOnce({ accountId: 'workspace-1' }); // getWorkspaceIdFromRepoId
    const selectAll = vi.fn().mockResolvedValue([]);      // secrets (empty)
    const dbMock = createDrizzleMock({ selectGet, selectAll });

    mocks.createWorkflowEngine.mockReturnValue(engine);
    mocks.getDb.mockReturnValue(dbMock);

    mocks.callRuntimeRequest.mockImplementation(async (_env: unknown, endpoint: string) => {
      if (endpoint.endsWith('/start')) {
        return jsonResponse({ ok: true });
      }
      if (endpoint.includes('/step/1')) {
        return jsonResponse({
          exitCode: 0,
          stdout: 'ok',
          stderr: '',
          outputs: {},
          conclusion: 'success',
        });
      }
      if (endpoint.endsWith('/complete')) {
        return jsonResponse({ ok: true });
      }
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'not found',
        json: async () => ({}),
      } as unknown as Response;
    });

    const message = createMessage({
      jobDefinition: {
        name: 'Build',
        'runs-on': 'ubuntu-latest',
        steps: [
          {
            name: 'dump-env',
            run: 'printenv',
          },
        ],
      },
    });

    await expect(handleWorkflowJob(message, createQueueEnv({
      RUNTIME_HOST: { fetch: vi.fn() } as { fetch(request: Request): Promise<Response> },
    }))).resolves.toBeUndefined();

    expect(mocks.callRuntimeRequest).toHaveBeenCalledWith(
      expect.anything(),
      '/actions/jobs/job-1/start',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          runId: 'run-1',
          space_id: 'workspace-1',
        }),
      })
    );

    const storedLogs = engine.storeJobLogs.mock.calls[0]?.[1] as string | undefined;
    expect(storedLogs).toBeDefined();
    expect(storedLogs).not.toContain('[warning]');
  });

  it('does not fail missing secrets in a step skipped by step.if', async () => {
    const engine = createEngineMock();

    // Order: getRunStatus -> status, getJobStatus -> status, getRunContext -> workflowPath/inputs,
    // getWorkspaceIdFromRepoId -> accountId
    const selectGet = vi.fn()
      .mockResolvedValueOnce({ status: 'running' })     // getRunStatus
      .mockResolvedValueOnce({ status: 'queued' })       // getJobStatus
      .mockResolvedValueOnce({ workflowPath: '.takos/workflows/ci.yml', inputs: '{}' }) // getRunContext
      .mockResolvedValueOnce({ accountId: 'workspace-1' }); // getWorkspaceIdFromRepoId
    const selectAll = vi.fn().mockResolvedValue([]);      // secrets (empty)
    const dbMock = createDrizzleMock({ selectGet, selectAll });

    mocks.createWorkflowEngine.mockReturnValue(engine);
    mocks.getDb.mockReturnValue(dbMock);

    mocks.callRuntimeRequest.mockImplementation(async (_env: unknown, endpoint: string) => {
      if (endpoint.endsWith('/start')) {
        return jsonResponse({ ok: true });
      }
      if (endpoint.includes('/step/1')) {
        return jsonResponse({
          exitCode: 0,
          stdout: 'step-1-ok',
          stderr: '',
          outputs: {},
          conclusion: 'success',
        });
      }
      if (endpoint.includes('/step/2')) {
        return jsonResponse({
          exitCode: 1,
          stdout: '',
          stderr: 'should-not-run',
          outputs: {},
          conclusion: 'failure',
        });
      }
      if (endpoint.endsWith('/complete')) {
        return jsonResponse({ ok: true });
      }
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'not found',
        json: async () => ({}),
      } as unknown as Response;
    });

    const message = createMessage({
      jobDefinition: {
        name: 'Build',
        'runs-on': 'ubuntu-latest',
        steps: [
          {
            name: 'run-step',
            run: 'echo step1',
          },
          {
            name: 'skip-step',
            if: '${{ env.RUN_SECOND_STEP }}',
            run: 'echo step2',
            env: {
              SECRET_REF: '${{ secrets.MISSING_SECRET }}',
            },
          },
        ],
      },
    });

    await expect(handleWorkflowJob(message, createQueueEnv({
      RUNTIME_HOST: { fetch: vi.fn() } as { fetch(request: Request): Promise<Response> },
    }))).resolves.toBeUndefined();

    expect(mocks.callRuntimeRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('/step/1'),
      expect.anything()
    );
    expect(mocks.callRuntimeRequest).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('/step/2'),
      expect.anything()
    );
    expect(engine.onJobComplete).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ conclusion: 'success' })
    );
  });
});
