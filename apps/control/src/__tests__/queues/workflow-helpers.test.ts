import { assertEquals, assertRejects } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  callRuntimeRequest: ((..._args: any[]) => undefined) as any,
  safeJsonParseOrDefault: ((..._args: any[]) => undefined) as any,
  createWorkflowEngine: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/runtime'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/workflow-engine'
import {
  runtimeJson,
  runtimeDelete,
  getRunContext,
  getStepDisplayName,
  getRunStatus,
  getSpaceIdFromRepoId,
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
  const selectGet = opts.selectGet ?? (async () => null);
  const selectAll = opts.selectAll ?? (async () => []);
  const updateWhere = opts.updateWhere ?? (async () => ({ meta: { changes: 1 } }));

  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = (() => c);
    c.where = (() => c);
    c.orderBy = (() => c);
    c.limit = (() => c);
    c.get = selectGet;
    c.all = selectAll;
    return c;
  };

  const updateChain = () => {
    const c: Record<string, unknown> = {};
    c.set = (() => c);
    c.where = updateWhere;
    return c;
  };

  return {
    select: () => chain(),
    update: () => updateChain(),
    insert: () => ({
      values: (() => ({ returning: (() => ({ get: (async () => ({ id: 1 })) })) })),
    }),
    delete: () => ({ where: (async () => undefined) }),
  };
}

function createMockEnv(overrides: Partial<WorkflowQueueEnv> = {}): WorkflowQueueEnv {
  return {
    DB: {} as any,
    GIT_OBJECTS: {} as any,
    WORKFLOW_QUEUE: { send: ((..._args: any[]) => undefined) as any } as any,
    RUN_NOTIFIER: {} as any,
    ...overrides,
  } as unknown as WorkflowQueueEnv;
}
// ---------------------------------------------------------------------------
// runtimeJson
// ---------------------------------------------------------------------------


  Deno.test('runtimeJson - sends a POST request with space_id and returns parsed JSON', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockResponse = {
      ok: true,
      json: async () => ({ result: 'ok' }),
    };
    mocks.callRuntimeRequest = (async () => mockResponse) as any;

    const env = createMockEnv();
    const result = await runtimeJson(env, '/test/endpoint', 'space-1', { key: 'value' });

    assertEquals(result, { result: 'ok' });
    assertSpyCallArgs(mocks.callRuntimeRequest, 0, [env, '/test/endpoint', {
      method: 'POST',
      body: { key: 'value', space_id: 'space-1' },
    }]);
})
  Deno.test('runtimeJson - uses specified HTTP method', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => ({
      ok: true,
      json: async () => ({}),
    })) as any;

    const env = createMockEnv();
    await runtimeJson(env, '/endpoint', 'space-1', {}, 'PUT');

    assertSpyCallArgs(mocks.callRuntimeRequest, 0, [env, '/endpoint', {
      method: 'PUT',
      body: { space_id: 'space-1' },
    }]);
})
  Deno.test('runtimeJson - throws when response is not ok', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'server error',
    })) as any;

    const env = createMockEnv();
    await await assertRejects(async () => { await runtimeJson(env, '/endpoint', 'space-1'); }, 
      'Runtime request failed (500): server error'
    );
})
  Deno.test('runtimeJson - uses statusText when text() returns empty', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => '',
    })) as any;

    const env = createMockEnv();
    await await assertRejects(async () => { await runtimeJson(env, '/endpoint', 'space-1'); }, 
      'Runtime request failed (503): Service Unavailable'
    );
})
  Deno.test('runtimeJson - sends empty body when none provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => ({
      ok: true,
      json: async () => ({ ok: true }),
    })) as any;

    const env = createMockEnv();
    await runtimeJson(env, '/endpoint', 'space-1');

    assertSpyCallArgs(mocks.callRuntimeRequest, 0, [env, '/endpoint', {
      method: 'POST',
      body: { space_id: 'space-1' },
    }]);
})
// ---------------------------------------------------------------------------
// runtimeDelete
// ---------------------------------------------------------------------------


  Deno.test('runtimeDelete - sends DELETE request with space_id', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => ({ ok: true, status: 200 })) as any;

    const env = createMockEnv();
    await runtimeDelete(env, '/actions/jobs/job-1', 'space-1');

    assertSpyCallArgs(mocks.callRuntimeRequest, 0, [env, '/actions/jobs/job-1', {
      method: 'DELETE',
      body: { space_id: 'space-1' },
    }]);
})
  Deno.test('runtimeDelete - does not throw on 404', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => ({ ok: false, status: 404 })) as any;

    const env = createMockEnv();
    await assertEquals(await runtimeDelete(env, '/endpoint', 'space-1'), undefined);
})
  Deno.test('runtimeDelete - does not throw on non-404 errors (logs warning instead)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => ({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => 'fail',
    })) as any;

    const env = createMockEnv();
    // runtimeDelete catches errors internally
    await assertEquals(await runtimeDelete(env, '/endpoint', 'space-1'), undefined);
})
  Deno.test('runtimeDelete - does not throw when callRuntimeRequest rejects', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.callRuntimeRequest = (async () => { throw new Error('network down'); }) as any;

    const env = createMockEnv();
    await assertEquals(await runtimeDelete(env, '/endpoint', 'space-1'), undefined);
})
// ---------------------------------------------------------------------------
// getStepDisplayName
// ---------------------------------------------------------------------------


  Deno.test('getStepDisplayName - uses step.name when available', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(getStepDisplayName({ name: 'Build project' } as any, 1), 'Build project');
})
  Deno.test('getStepDisplayName - falls back to step.uses', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(getStepDisplayName({ uses: 'actions/checkout@v4' } as any, 1), 'actions/checkout@v4');
})
  Deno.test('getStepDisplayName - falls back to step.run truncated to 50 chars', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const longRun = 'a'.repeat(100);
    assertEquals(getStepDisplayName({ run: longRun } as any, 1), 'a'.repeat(50));
})
  Deno.test('getStepDisplayName - falls back to "Step N" when nothing is available', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(getStepDisplayName({} as any, 3), 'Step 3');
})
  Deno.test('getStepDisplayName - prefers name over uses', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(getStepDisplayName({ name: 'Checkout', uses: 'actions/checkout@v4' } as any, 1), 'Checkout');
})
  Deno.test('getStepDisplayName - prefers uses over run', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(getStepDisplayName({ uses: 'actions/checkout@v4', run: 'echo hi' } as any, 1), 'actions/checkout@v4');
})
  Deno.test('getStepDisplayName - handles short run command', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(getStepDisplayName({ run: 'echo ok' } as any, 1), 'echo ok');
})
// ---------------------------------------------------------------------------
// getRunContext
// ---------------------------------------------------------------------------


  Deno.test('getRunContext - returns workflow path and parsed inputs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectGet: (async () => ({
        workflowPath: '.takos/workflows/ci.yml',
        inputs: '{"env":"prod"}',
      })),
    });
    mocks.getDb = (() => dbMock) as any;
    mocks.safeJsonParseOrDefault = (() => ({ env: 'prod' })) as any;

    const result = await getRunContext({} as any, 'run-1');

    assertEquals(result.workflowPath, '.takos/workflows/ci.yml');
    assertEquals(result.inputs, { env: 'prod' });
})
  Deno.test('getRunContext - returns defaults when run record is missing', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectGet: (async () => null),
    });
    mocks.getDb = (() => dbMock) as any;
    mocks.safeJsonParseOrDefault = (() => ({})) as any;

    const result = await getRunContext({} as any, 'run-missing');

    assertEquals(result.workflowPath, 'unknown');
    assertEquals(result.inputs, {});
})
// ---------------------------------------------------------------------------
// getRunStatus
// ---------------------------------------------------------------------------


  Deno.test('getRunStatus - returns the run status', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'running' })),
    });
    mocks.getDb = (() => dbMock) as any;

    const result = await getRunStatus({} as any, 'run-1');
    assertEquals(result, 'running');
})
  Deno.test('getRunStatus - returns null when run not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectGet: (async () => null),
    });
    mocks.getDb = (() => dbMock) as any;

    const result = await getRunStatus({} as any, 'missing-run');
    assertEquals(result, null);
})
// ---------------------------------------------------------------------------
// getSpaceIdFromRepoId
// ---------------------------------------------------------------------------


  Deno.test('getSpaceIdFromRepoId - returns accountId from repository', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectGet: (async () => ({ accountId: 'ws-123' })),
    });
    mocks.getDb = (() => dbMock) as any;

    const result = await getSpaceIdFromRepoId({} as any, 'repo-1');
    assertEquals(result, 'ws-123');
})
  Deno.test('getSpaceIdFromRepoId - throws when repository not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectGet: (async () => null),
    });
    mocks.getDb = (() => dbMock) as any;

    await await assertRejects(async () => { await getSpaceIdFromRepoId({} as any, 'missing'); }, 
      'Space not found for repository missing'
    );
})
  Deno.test('getSpaceIdFromRepoId - throws when accountId is null', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectGet: (async () => ({ accountId: null })),
    });
    mocks.getDb = (() => dbMock) as any;

    await await assertRejects(async () => { await getSpaceIdFromRepoId({} as any, 'repo-no-account'); }, 
      'Space not found for repository repo-no-account'
    );
})
// ---------------------------------------------------------------------------
// markJobSkipped
// ---------------------------------------------------------------------------


  Deno.test('markJobSkipped - updates job and steps with skipped status', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const updateWhere = (async () => ({ meta: { changes: 1 } }));
    const dbMock = createDrizzleMock({ updateWhere });
    mocks.getDb = (() => dbMock) as any;

    await markJobSkipped({} as any, 'job-1', '2024-01-01T00:00:00Z');

    assertSpyCalls(dbMock.update, 2);
})
  Deno.test('markJobSkipped - uses cancelled conclusion when specified', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const updateWhere = (async () => ({ meta: { changes: 1 } }));
    const dbMock = createDrizzleMock({ updateWhere });
    mocks.getDb = (() => dbMock) as any;

    await markJobSkipped({} as any, 'job-1', '2024-01-01T00:00:00Z', 'cancelled');

    // Both update calls go through
    assertSpyCalls(dbMock.update, 2);
})
// ---------------------------------------------------------------------------
// buildSkippedStepResultsFromDb
// ---------------------------------------------------------------------------


  Deno.test('buildSkippedStepResultsFromDb - returns step results from DB records', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectAll: (async () => [
        { number: 1, name: 'Build' },
        { number: 2, name: 'Test' },
      ]),
    });
    mocks.getDb = (() => dbMock) as any;

    const results = await buildSkippedStepResultsFromDb({} as any, 'job-1', 'fallback');

    assertEquals(results.length, 2);
    assertEquals(results[0], {
      stepNumber: 1,
      name: 'Build',
      status: 'skipped',
      conclusion: 'skipped',
      error: undefined,
      outputs: {},
    });
    assertEquals(results[1], {
      stepNumber: 2,
      name: 'Test',
      status: 'skipped',
      conclusion: 'skipped',
      error: undefined,
      outputs: {},
    });
})
  Deno.test('buildSkippedStepResultsFromDb - includes error message on first step only', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectAll: (async () => [
        { number: 1, name: 'Step 1' },
        { number: 2, name: 'Step 2' },
      ]),
    });
    mocks.getDb = (() => dbMock) as any;

    const results = await buildSkippedStepResultsFromDb({} as any, 'job-1', 'fallback', 'Something broke');

    assertEquals(results[0].error, 'Something broke');
    assertEquals(results[1].error, undefined);
})
  Deno.test('buildSkippedStepResultsFromDb - returns fallback step result when no DB steps found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock({
      selectAll: (async () => []),
    });
    mocks.getDb = (() => dbMock) as any;

    const results = await buildSkippedStepResultsFromDb({} as any, 'job-1', 'fallback-name', 'error msg');

    assertEquals(results.length, 1);
    assertEquals(results[0], {
      stepNumber: 1,
      name: 'fallback-name',
      status: 'skipped',
      conclusion: 'skipped',
      error: 'error msg',
      outputs: {},
    });
})
// ---------------------------------------------------------------------------
// failJobWithResults
// ---------------------------------------------------------------------------


  Deno.test('failJobWithResults - calls engine.onJobComplete with failure conclusion', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const engine = {
      onJobComplete: (async () => undefined),
    };

    const stepResults = [
      { stepNumber: 1, name: 'step', status: 'skipped' as const, conclusion: 'skipped' as const, outputs: {} },
    ];

    await failJobWithResults(engine as any, 'job-1', stepResults, '2024-01-01T00:00:00Z');

    assertSpyCallArgs(engine.onJobComplete, 0, ['job-1', {
      jobId: 'job-1',
      status: 'completed',
      conclusion: 'failure',
      outputs: {},
      stepResults,
      startedAt: '2024-01-01T00:00:00Z',
      completedAt: '2024-01-01T00:00:00Z',
    }]);
})
// ---------------------------------------------------------------------------
// markJobFailed
// ---------------------------------------------------------------------------


  Deno.test('markJobFailed - updates job record to failure', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const updateWhere = (async () => ({ meta: { changes: 1 } }));
    const dbMock = createDrizzleMock({ updateWhere });
    mocks.getDb = (() => dbMock) as any;

    await markJobFailed({} as any, 'job-1', '2024-01-01T00:00:00Z');

    assertSpyCalls(dbMock.update, 1);
})