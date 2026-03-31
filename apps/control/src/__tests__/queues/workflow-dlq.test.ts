import { WORKFLOW_QUEUE_MESSAGE_VERSION, type WorkflowJobQueueMessage } from '@/types';

import { assert, assertRejects } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  createWorkflowEngine: ((..._args: any[]) => undefined) as any,
  isValidWorkflowJobQueueMessage: ((..._args: any[]) => undefined) as any,
  getRunNotifierStub: ((..._args: any[]) => undefined) as any,
  buildRunNotifierEmitRequest: ((..._args: any[]) => undefined) as any,
  buildRunNotifierEmitPayload: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/types'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/workflow-engine'
// [Deno] vi.mock removed - manually stub imports from '@/utils'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/runtime'
// [Deno] vi.mock removed - manually stub imports from '@/services/run-notifier-client'
// [Deno] vi.mock removed - manually stub imports from '@/services/run-notifier-payload'
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
  };
}

function createEngine() {
  return {
    onJobComplete: (async () => undefined),
    storeJobLogs: (async () => undefined),
  };
}

function createEnv(overrides: Partial<WorkflowQueueEnv> = {}): WorkflowQueueEnv {
  return {
    DB: {} as any,
    RUN_NOTIFIER: {} as any,
    GIT_OBJECTS: {} as any,
    WORKFLOW_QUEUE: { send: ((..._args: any[]) => undefined) as any } as any,
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
// ---------------------------------------------------------------------------
// handleWorkflowJobDlq
// ---------------------------------------------------------------------------


  Deno.test('handleWorkflowJobDlq - skips invalid messages', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  mocks.isValidWorkflowJobQueueMessage = (() => false) as any;

    await handleWorkflowJobDlq({ invalid: true }, createEnv(), 3);

    assertSpyCalls(mocks.getDb, 0);
})
  Deno.test('handleWorkflowJobDlq - skips when job is already completed', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  mocks.isValidWorkflowJobQueueMessage = (() => true) as any;

    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'completed', name: 'Build' })),
    });
    mocks.getDb = (() => dbMock) as any;

    await handleWorkflowJobDlq(validMessage(), createEnv(), 3);

    assertSpyCalls(dbMock.update, 0);
})
  Deno.test('handleWorkflowJobDlq - skips when job record not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  mocks.isValidWorkflowJobQueueMessage = (() => true) as any;

    const dbMock = createDrizzleMock({
      selectGet: (async () => null),
    });
    mocks.getDb = (() => dbMock) as any;

    await handleWorkflowJobDlq(validMessage(), createEnv(), 3);

    assertSpyCalls(dbMock.update, 0);
})
  Deno.test('handleWorkflowJobDlq - marks job and run as failed', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  mocks.isValidWorkflowJobQueueMessage = (() => true) as any;

    const engine = createEngine();
    mocks.createWorkflowEngine = (() => engine) as any;

    const updateWhere = (async () => ({ meta: { changes: 1 } }));
    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'in_progress', name: 'Build' })),
      selectAll: (async () => [
        { number: 1, name: 'Step 1' },
      ]),
      updateWhere,
    });
    mocks.getDb = (() => dbMock) as any;

    await handleWorkflowJobDlq(validMessage(), createEnv(), 5);

    // Update for markJobFailed + update for run status
    assert(dbMock.update.calls.length > 0);
    assertSpyCallArgs(engine.storeJobLogs, 0, ['job-1', expect.stringContaining('DLQ')]);
    assertSpyCallArgs(engine.onJobComplete, 0, ['job-1', ({
      conclusion: 'failure',
    })]);
})
  Deno.test('handleWorkflowJobDlq - emits event without bucket but still marks job failed', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  mocks.isValidWorkflowJobQueueMessage = (() => true) as any;

    const updateWhere = (async () => ({ meta: { changes: 1 } }));
    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'in_progress', name: 'Build' })),
      updateWhere,
    });
    mocks.getDb = (() => dbMock) as any;

    // No GIT_OBJECTS bucket
    const env = createEnv({ GIT_OBJECTS: undefined });

    await handleWorkflowJobDlq(validMessage(), env, 2);

    // Should still update the DB
    assert(dbMock.update.calls.length > 0);
    // Should NOT create engine (no bucket)
    assertSpyCalls(mocks.createWorkflowEngine, 0);
})
  Deno.test('handleWorkflowJobDlq - handles attempt count in DLQ log', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  mocks.isValidWorkflowJobQueueMessage = (() => true) as any;

    const engine = createEngine();
    mocks.createWorkflowEngine = (() => engine) as any;

    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'queued', name: 'Test' })),
      selectAll: (async () => []),
    });
    mocks.getDb = (() => dbMock) as any;

    await handleWorkflowJobDlq(validMessage(), createEnv(), 7);

    assertSpyCallArgs(engine.storeJobLogs, 0, [
      'job-1',
      expect.stringContaining('attempts=7')
    ]);
})
  Deno.test('handleWorkflowJobDlq - handles undefined attempts', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  mocks.isValidWorkflowJobQueueMessage = (() => true) as any;

    const engine = createEngine();
    mocks.createWorkflowEngine = (() => engine) as any;

    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'queued', name: 'Test' })),
      selectAll: (async () => []),
    });
    mocks.getDb = (() => dbMock) as any;

    await handleWorkflowJobDlq(validMessage(), createEnv());

    assertSpyCallArgs(engine.storeJobLogs, 0, [
      'job-1',
      expect.stringContaining('attempts=unknown')
    ]);
})
  Deno.test('handleWorkflowJobDlq - re-throws when failJobWithResults (onJobComplete) fails', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  mocks.isValidWorkflowJobQueueMessage = (() => true) as any;

    const engine = createEngine();
    engine.onJobComplete = (async () => { throw new Error('db error'); }) as any;
    mocks.createWorkflowEngine = (() => engine) as any;

    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'in_progress', name: 'Build' })),
      selectAll: (async () => []),
    });
    mocks.getDb = (() => dbMock) as any;

    await await assertRejects(async () => { await 
      handleWorkflowJobDlq(validMessage(), createEnv(), 3)
    ; }, 'db error');
})
  Deno.test('handleWorkflowJobDlq - handles storeJobLogs failure gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  mocks.isValidWorkflowJobQueueMessage = (() => true) as any;

    const engine = createEngine();
    engine.storeJobLogs = (async () => { throw new Error('r2 error'); }) as any;
    mocks.createWorkflowEngine = (() => engine) as any;

    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'in_progress', name: 'Build' })),
      selectAll: (async () => []),
    });
    mocks.getDb = (() => dbMock) as any;

    // Should not throw -- storeJobLogs error is caught
    await handleWorkflowJobDlq(validMessage(), createEnv(), 1);

    assert(engine.onJobComplete.calls.length > 0);
})
  Deno.test('handleWorkflowJobDlq - handles run update failure gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

  mocks.buildRunNotifierEmitPayload = (() => ({})) as any;
  mocks.buildRunNotifierEmitRequest = (() => new Request('https://notifier.test', { method: 'POST' })) as any;
  mocks.getRunNotifierStub = (() => ({
    fetch: (async () => new Response(null, { status: 204 })),
  })) as any;
  mocks.isValidWorkflowJobQueueMessage = (() => true) as any;

    const engine = createEngine();
    mocks.createWorkflowEngine = (() => engine) as any;

    let updateCallCount = 0;
    const updateWhere = async () => {
      updateCallCount++;
      // Second update (for run) throws
      if (updateCallCount === 2) {
        throw new Error('run update failed');
      }
      return { meta: { changes: 1 } };
    };
    const dbMock = createDrizzleMock({
      selectGet: (async () => ({ status: 'in_progress', name: 'Build' })),
      selectAll: (async () => []),
      updateWhere,
    });
    mocks.getDb = (() => dbMock) as any;

    // Should not throw -- run update error is caught
    await handleWorkflowJobDlq(validMessage(), createEnv(), 1);
})