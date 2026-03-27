import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  callRuntimeRequest: vi.fn(),
  safeJsonParseOrDefault: vi.fn(),
  createWorkflowEngine: vi.fn(),
}));

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

vi.mock('@/utils', () => ({
  safeJsonParseOrDefault: mocks.safeJsonParseOrDefault,
}));

vi.mock('@/services/execution/runtime', () => ({
  callRuntimeRequest: mocks.callRuntimeRequest,
}));

vi.mock('@/services/execution/workflow-engine', () => ({
  createWorkflowEngine: mocks.createWorkflowEngine,
}));

import {
  runtimeJson,
  runtimeDelete,
  getRunContext,
  getStepDisplayName,
  getRunStatus,
  getWorkspaceIdFromRepoId,
  markJobSkipped,
  buildSkippedStepResultsFromDb,
  failJobWithResults,
  markJobFailed,
} from '@/queues/workflow-runtime-client';
import type { WorkflowQueueEnv } from '@/queues/workflow-types';

// ---------------------------------------------------------------------------
// Helper to build chainable drizzle mocks
// ---------------------------------------------------------------------------

function createDrizzleMock(opts: {
  selectGet?: ReturnType<typeof vi.fn>;
  selectAll?: ReturnType<typeof vi.fn>;
  updateWhere?: ReturnType<typeof vi.fn>;
}) {
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
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({ returning: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ id: 1 }) }) }),
    })),
    delete: vi.fn().mockImplementation(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  };
}

function createMockEnv(overrides: Partial<WorkflowQueueEnv> = {}): WorkflowQueueEnv {
  return {
    DB: {} as any,
    GIT_OBJECTS: {} as any,
    WORKFLOW_QUEUE: { send: vi.fn() } as any,
    RUN_NOTIFIER: {} as any,
    ...overrides,
  } as unknown as WorkflowQueueEnv;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// runtimeJson
// ---------------------------------------------------------------------------

describe('runtimeJson', () => {
  it('sends a POST request with space_id and returns parsed JSON', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ result: 'ok' }),
    };
    mocks.callRuntimeRequest.mockResolvedValue(mockResponse);

    const env = createMockEnv();
    const result = await runtimeJson(env, '/test/endpoint', 'space-1', { key: 'value' });

    expect(result).toEqual({ result: 'ok' });
    expect(mocks.callRuntimeRequest).toHaveBeenCalledWith(env, '/test/endpoint', {
      method: 'POST',
      body: { key: 'value', space_id: 'space-1' },
    });
  });

  it('uses specified HTTP method', async () => {
    mocks.callRuntimeRequest.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const env = createMockEnv();
    await runtimeJson(env, '/endpoint', 'space-1', {}, 'PUT');

    expect(mocks.callRuntimeRequest).toHaveBeenCalledWith(env, '/endpoint', {
      method: 'PUT',
      body: { space_id: 'space-1' },
    });
  });

  it('throws when response is not ok', async () => {
    mocks.callRuntimeRequest.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'server error',
    });

    const env = createMockEnv();
    await expect(runtimeJson(env, '/endpoint', 'space-1')).rejects.toThrow(
      'Runtime request failed (500): server error'
    );
  });

  it('uses statusText when text() returns empty', async () => {
    mocks.callRuntimeRequest.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => '',
    });

    const env = createMockEnv();
    await expect(runtimeJson(env, '/endpoint', 'space-1')).rejects.toThrow(
      'Runtime request failed (503): Service Unavailable'
    );
  });

  it('sends empty body when none provided', async () => {
    mocks.callRuntimeRequest.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    const env = createMockEnv();
    await runtimeJson(env, '/endpoint', 'space-1');

    expect(mocks.callRuntimeRequest).toHaveBeenCalledWith(env, '/endpoint', {
      method: 'POST',
      body: { space_id: 'space-1' },
    });
  });
});

// ---------------------------------------------------------------------------
// runtimeDelete
// ---------------------------------------------------------------------------

describe('runtimeDelete', () => {
  it('sends DELETE request with space_id', async () => {
    mocks.callRuntimeRequest.mockResolvedValue({ ok: true, status: 200 });

    const env = createMockEnv();
    await runtimeDelete(env, '/actions/jobs/job-1', 'space-1');

    expect(mocks.callRuntimeRequest).toHaveBeenCalledWith(env, '/actions/jobs/job-1', {
      method: 'DELETE',
      body: { space_id: 'space-1' },
    });
  });

  it('does not throw on 404', async () => {
    mocks.callRuntimeRequest.mockResolvedValue({ ok: false, status: 404 });

    const env = createMockEnv();
    await expect(runtimeDelete(env, '/endpoint', 'space-1')).resolves.toBeUndefined();
  });

  it('does not throw on non-404 errors (logs warning instead)', async () => {
    mocks.callRuntimeRequest.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'fail',
    });

    const env = createMockEnv();
    // runtimeDelete catches errors internally
    await expect(runtimeDelete(env, '/endpoint', 'space-1')).resolves.toBeUndefined();
  });

  it('does not throw when callRuntimeRequest rejects', async () => {
    mocks.callRuntimeRequest.mockRejectedValue(new Error('network down'));

    const env = createMockEnv();
    await expect(runtimeDelete(env, '/endpoint', 'space-1')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getStepDisplayName
// ---------------------------------------------------------------------------

describe('getStepDisplayName', () => {
  it('uses step.name when available', () => {
    expect(getStepDisplayName({ name: 'Build project' } as any, 1)).toBe('Build project');
  });

  it('falls back to step.uses', () => {
    expect(getStepDisplayName({ uses: 'actions/checkout@v4' } as any, 1)).toBe('actions/checkout@v4');
  });

  it('falls back to step.run truncated to 50 chars', () => {
    const longRun = 'a'.repeat(100);
    expect(getStepDisplayName({ run: longRun } as any, 1)).toBe('a'.repeat(50));
  });

  it('falls back to "Step N" when nothing is available', () => {
    expect(getStepDisplayName({} as any, 3)).toBe('Step 3');
  });

  it('prefers name over uses', () => {
    expect(getStepDisplayName({ name: 'Checkout', uses: 'actions/checkout@v4' } as any, 1)).toBe('Checkout');
  });

  it('prefers uses over run', () => {
    expect(getStepDisplayName({ uses: 'actions/checkout@v4', run: 'echo hi' } as any, 1)).toBe('actions/checkout@v4');
  });

  it('handles short run command', () => {
    expect(getStepDisplayName({ run: 'echo ok' } as any, 1)).toBe('echo ok');
  });
});

// ---------------------------------------------------------------------------
// getRunContext
// ---------------------------------------------------------------------------

describe('getRunContext', () => {
  it('returns workflow path and parsed inputs', async () => {
    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({
        workflowPath: '.takos/workflows/ci.yml',
        inputs: '{"env":"prod"}',
      }),
    });
    mocks.getDb.mockReturnValue(dbMock);
    mocks.safeJsonParseOrDefault.mockReturnValue({ env: 'prod' });

    const result = await getRunContext({} as any, 'run-1');

    expect(result.workflowPath).toBe('.takos/workflows/ci.yml');
    expect(result.inputs).toEqual({ env: 'prod' });
  });

  it('returns defaults when run record is missing', async () => {
    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue(null),
    });
    mocks.getDb.mockReturnValue(dbMock);
    mocks.safeJsonParseOrDefault.mockReturnValue({});

    const result = await getRunContext({} as any, 'run-missing');

    expect(result.workflowPath).toBe('unknown');
    expect(result.inputs).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// getRunStatus
// ---------------------------------------------------------------------------

describe('getRunStatus', () => {
  it('returns the run status', async () => {
    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ status: 'running' }),
    });
    mocks.getDb.mockReturnValue(dbMock);

    const result = await getRunStatus({} as any, 'run-1');
    expect(result).toBe('running');
  });

  it('returns null when run not found', async () => {
    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue(null),
    });
    mocks.getDb.mockReturnValue(dbMock);

    const result = await getRunStatus({} as any, 'missing-run');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getWorkspaceIdFromRepoId
// ---------------------------------------------------------------------------

describe('getWorkspaceIdFromRepoId', () => {
  it('returns accountId from repository', async () => {
    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ accountId: 'ws-123' }),
    });
    mocks.getDb.mockReturnValue(dbMock);

    const result = await getWorkspaceIdFromRepoId({} as any, 'repo-1');
    expect(result).toBe('ws-123');
  });

  it('throws when repository not found', async () => {
    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue(null),
    });
    mocks.getDb.mockReturnValue(dbMock);

    await expect(getWorkspaceIdFromRepoId({} as any, 'missing')).rejects.toThrow(
      'Workspace not found for repository missing'
    );
  });

  it('throws when accountId is null', async () => {
    const dbMock = createDrizzleMock({
      selectGet: vi.fn().mockResolvedValue({ accountId: null }),
    });
    mocks.getDb.mockReturnValue(dbMock);

    await expect(getWorkspaceIdFromRepoId({} as any, 'repo-no-account')).rejects.toThrow(
      'Workspace not found for repository repo-no-account'
    );
  });
});

// ---------------------------------------------------------------------------
// markJobSkipped
// ---------------------------------------------------------------------------

describe('markJobSkipped', () => {
  it('updates job and steps with skipped status', async () => {
    const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const dbMock = createDrizzleMock({ updateWhere });
    mocks.getDb.mockReturnValue(dbMock);

    await markJobSkipped({} as any, 'job-1', '2024-01-01T00:00:00Z');

    expect(dbMock.update).toHaveBeenCalledTimes(2);
  });

  it('uses cancelled conclusion when specified', async () => {
    const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const dbMock = createDrizzleMock({ updateWhere });
    mocks.getDb.mockReturnValue(dbMock);

    await markJobSkipped({} as any, 'job-1', '2024-01-01T00:00:00Z', 'cancelled');

    // Both update calls go through
    expect(dbMock.update).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// buildSkippedStepResultsFromDb
// ---------------------------------------------------------------------------

describe('buildSkippedStepResultsFromDb', () => {
  it('returns step results from DB records', async () => {
    const dbMock = createDrizzleMock({
      selectAll: vi.fn().mockResolvedValue([
        { number: 1, name: 'Build' },
        { number: 2, name: 'Test' },
      ]),
    });
    mocks.getDb.mockReturnValue(dbMock);

    const results = await buildSkippedStepResultsFromDb({} as any, 'job-1', 'fallback');

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      stepNumber: 1,
      name: 'Build',
      status: 'skipped',
      conclusion: 'skipped',
      error: undefined,
      outputs: {},
    });
    expect(results[1]).toEqual({
      stepNumber: 2,
      name: 'Test',
      status: 'skipped',
      conclusion: 'skipped',
      error: undefined,
      outputs: {},
    });
  });

  it('includes error message on first step only', async () => {
    const dbMock = createDrizzleMock({
      selectAll: vi.fn().mockResolvedValue([
        { number: 1, name: 'Step 1' },
        { number: 2, name: 'Step 2' },
      ]),
    });
    mocks.getDb.mockReturnValue(dbMock);

    const results = await buildSkippedStepResultsFromDb({} as any, 'job-1', 'fallback', 'Something broke');

    expect(results[0].error).toBe('Something broke');
    expect(results[1].error).toBeUndefined();
  });

  it('returns fallback step result when no DB steps found', async () => {
    const dbMock = createDrizzleMock({
      selectAll: vi.fn().mockResolvedValue([]),
    });
    mocks.getDb.mockReturnValue(dbMock);

    const results = await buildSkippedStepResultsFromDb({} as any, 'job-1', 'fallback-name', 'error msg');

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      stepNumber: 1,
      name: 'fallback-name',
      status: 'skipped',
      conclusion: 'skipped',
      error: 'error msg',
      outputs: {},
    });
  });
});

// ---------------------------------------------------------------------------
// failJobWithResults
// ---------------------------------------------------------------------------

describe('failJobWithResults', () => {
  it('calls engine.onJobComplete with failure conclusion', async () => {
    const engine = {
      onJobComplete: vi.fn().mockResolvedValue(undefined),
    };

    const stepResults = [
      { stepNumber: 1, name: 'step', status: 'skipped' as const, conclusion: 'skipped' as const, outputs: {} },
    ];

    await failJobWithResults(engine as any, 'job-1', stepResults, '2024-01-01T00:00:00Z');

    expect(engine.onJobComplete).toHaveBeenCalledWith('job-1', {
      jobId: 'job-1',
      status: 'completed',
      conclusion: 'failure',
      outputs: {},
      stepResults,
      startedAt: '2024-01-01T00:00:00Z',
      completedAt: '2024-01-01T00:00:00Z',
    });
  });
});

// ---------------------------------------------------------------------------
// markJobFailed
// ---------------------------------------------------------------------------

describe('markJobFailed', () => {
  it('updates job record to failure', async () => {
    const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const dbMock = createDrizzleMock({ updateWhere });
    mocks.getDb.mockReturnValue(dbMock);

    await markJobFailed({} as any, 'job-1', '2024-01-01T00:00:00Z');

    expect(dbMock.update).toHaveBeenCalledTimes(1);
  });
});
