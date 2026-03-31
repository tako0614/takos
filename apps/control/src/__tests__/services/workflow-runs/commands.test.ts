import type { D1Database, Queue } from '@cloudflare/workers-types';
import type { Env } from '@/types';

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  resolveRef: ((..._args: any[]) => undefined) as any,
  getCommitData: ((..._args: any[]) => undefined) as any,
  getBlobAtPath: ((..._args: any[]) => undefined) as any,
  parseWorkflow: ((..._args: any[]) => undefined) as any,
  validateWorkflow: ((..._args: any[]) => undefined) as any,
  createWorkflowJobs: ((..._args: any[]) => undefined) as any,
  enqueueFirstPhaseJobs: ((..._args: any[]) => undefined) as any,
  callRuntimeRequest: ((..._args: any[]) => undefined) as any,
  generateId: ((..._args: any[]) => undefined) as any,
  now: ((..._args: any[]) => undefined) as any,
  logError: ((..._args: any[]) => undefined) as any,
  logWarn: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart'
// [Deno] vi.mock removed - manually stub imports from 'takos-actions-engine'
// [Deno] vi.mock removed - manually stub imports from '@/services/actions'
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/runtime'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
import { dispatchWorkflowRun, cancelWorkflowRun, rerunWorkflowRun } from '@/services/workflow-runs/commands';

function buildDrizzleMock(selectResults: unknown[]) {
  let selectIdx = 0;
  const runFn = (async () => undefined);
  return {
    select: () => {
      const result = selectResults[selectIdx++];
      const chain: Record<string, unknown> = {};
      chain.from = (() => chain);
      chain.where = (() => chain);
      chain.leftJoin = (() => chain);
      chain.orderBy = (() => chain);
      chain.limit = (() => chain);
      chain.get = (async () => result);
      chain.all = (async () => Array.isArray(result) ? result : []);
      return chain;
    },
    insert: (() => ({
      values: (() => ({
        run: runFn,
        returning: (() => ({ get: ((..._args: any[]) => undefined) as any })),
      })),
    })),
    update: (() => ({
      set: (() => ({
        where: (() => ({
          run: runFn,
          returning: (() => []),
        })),
      })),
    })),
    _runFn: runFn,
  };
}

function makeEnv(options: {
  gitObjects?: boolean;
  workflowQueue?: boolean;
  runtimeHost?: boolean;
} = {}): Env {
  return {
    DB: {} as D1Database,
    GIT_OBJECTS: options.gitObjects ? {} : undefined,
    WORKFLOW_QUEUE: options.workflowQueue ? { send: ((..._args: any[]) => undefined) as any } : undefined,
    RUNTIME_HOST: options.runtimeHost ? {} : undefined,
  } as unknown as Env;
}

const validWorkflow = {
  name: 'CI',
  on: 'workflow_dispatch',
  jobs: {
    build: { 'runs-on': 'ubuntu-latest', steps: [{ name: 'Build', run: 'echo build' }] },
  },
};


  Deno.test('dispatchWorkflowRun - returns error when GIT_OBJECTS is not configured', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'new-run-id') as any;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.createWorkflowJobs = (async () => new Map([['build', 'job-build-id']])) as any;
    mocks.enqueueFirstPhaseJobs = (async () => undefined) as any;
  const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: false }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1' },
    );

    assertEquals(result.ok, false);
    assertEquals(result.status, 500);
    assertStringIncludes(result.error, 'Git storage not configured');
})
  Deno.test('dispatchWorkflowRun - returns error when WORKFLOW_QUEUE is not configured', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'new-run-id') as any;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.createWorkflowJobs = (async () => new Map([['build', 'job-build-id']])) as any;
    mocks.enqueueFirstPhaseJobs = (async () => undefined) as any;
  const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: false }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1' },
    );

    assertEquals(result.ok, false);
    assertEquals(result.status, 500);
    assertStringIncludes(result.error, 'Workflow queue not configured');
})
  Deno.test('dispatchWorkflowRun - returns 404 when ref cannot be resolved', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'new-run-id') as any;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.createWorkflowJobs = (async () => new Map([['build', 'job-build-id']])) as any;
    mocks.enqueueFirstPhaseJobs = (async () => undefined) as any;
  mocks.resolveRef = (async () => null) as any;

    const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1' },
    );

    assertEquals(result.ok, false);
    assertEquals(result.status, 404);
})
  Deno.test('dispatchWorkflowRun - returns 400 when workflow has parse errors', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'new-run-id') as any;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.createWorkflowJobs = (async () => new Map([['build', 'job-build-id']])) as any;
    mocks.enqueueFirstPhaseJobs = (async () => undefined) as any;
  mocks.resolveRef = (async () => 'sha-1') as any;
    mocks.getCommitData = (async () => ({ tree: 'tree-1' })) as any;
    mocks.getBlobAtPath = (async () => new TextEncoder().encode('invalid: yaml')) as any;
    mocks.parseWorkflow = (() => ({
      workflow: {},
      diagnostics: [{ severity: 'error', message: 'Parse error' }],
    })) as any;

    const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1' },
    );

    assertEquals(result.ok, false);
    assertEquals(result.status, 400);
})
  Deno.test('dispatchWorkflowRun - returns 400 when workflow does not support manual dispatch', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'new-run-id') as any;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.createWorkflowJobs = (async () => new Map([['build', 'job-build-id']])) as any;
    mocks.enqueueFirstPhaseJobs = (async () => undefined) as any;
  mocks.resolveRef = (async () => 'sha-1') as any;
    mocks.getCommitData = (async () => ({ tree: 'tree-1' })) as any;
    mocks.getBlobAtPath = (async () => new TextEncoder().encode('on: push')) as any;
    mocks.parseWorkflow = (() => ({
      workflow: { ...validWorkflow, on: 'push' },
      diagnostics: [],
    })) as any;
    mocks.validateWorkflow = (() => ({ diagnostics: [] })) as any;

    const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1' },
    );

    assertEquals(result.ok, false);
    assertEquals(result.status, 400);
    assertStringIncludes(result.error, 'does not support manual dispatch');
})
  Deno.test('dispatchWorkflowRun - creates a workflow run successfully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'new-run-id') as any;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.createWorkflowJobs = (async () => new Map([['build', 'job-build-id']])) as any;
    mocks.enqueueFirstPhaseJobs = (async () => undefined) as any;
  mocks.resolveRef = (async () => 'sha-abc') as any;
    mocks.getCommitData = (async () => ({ tree: 'tree-1' })) as any;
    mocks.getBlobAtPath = (async () => new TextEncoder().encode('name: CI')) as any;
    mocks.parseWorkflow = (() => ({
      workflow: validWorkflow,
      diagnostics: [],
    })) as any;
    mocks.validateWorkflow = (() => ({ diagnostics: [] })) as any;

    const drizzle = buildDrizzleMock([
      { maxRunNumber: 5 },  // last run number
      { id: 'existing-wf' }, // existing workflow
    ]);
    mocks.getDb = (() => drizzle) as any;

    const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1', inputs: { foo: 'bar' } },
    );

    assertEquals(result.ok, true);
    assertEquals(result.status, 201);
    if (result.ok) {
      assertEquals(result.run.id, 'new-run-id');
      assertEquals(result.run.status, 'queued');
      assertEquals(result.run.run_number, 6);
      assertEquals(result.run.run_attempt, 1);
      assertEquals(result.run.sha, 'sha-abc');
      assertEquals(result.run.ref, 'refs/heads/main');
    }

    assert(mocks.createWorkflowJobs.calls.length > 0);
    assert(mocks.enqueueFirstPhaseJobs.calls.length > 0);
})
  Deno.test('dispatchWorkflowRun - starts run_number at 1 when no previous runs exist', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'new-run-id') as any;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.createWorkflowJobs = (async () => new Map([['build', 'job-build-id']])) as any;
    mocks.enqueueFirstPhaseJobs = (async () => undefined) as any;
  mocks.resolveRef = (async () => 'sha-abc') as any;
    mocks.getCommitData = (async () => ({ tree: 'tree-1' })) as any;
    mocks.getBlobAtPath = (async () => new TextEncoder().encode('name: CI')) as any;
    mocks.parseWorkflow = (() => ({
      workflow: validWorkflow,
      diagnostics: [],
    })) as any;
    mocks.validateWorkflow = (() => ({ diagnostics: [] })) as any;

    const drizzle = buildDrizzleMock([
      { maxRunNumber: null },  // no previous runs
      null,                     // no existing workflow
    ]);
    mocks.getDb = (() => drizzle) as any;

    const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1' },
    );

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.run.run_number, 1);
    }
})

  Deno.test('cancelWorkflowRun - returns 404 when run not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-02T00:00:00.000Z') as any;
  const drizzle = buildDrizzleMock([null]);
    mocks.getDb = (() => drizzle) as any;

    const result = await cancelWorkflowRun(makeEnv(), { repoId: 'repo-1', runId: 'missing' });

    assertEquals(result.ok, false);
    assertEquals(result.status, 404);
})
  Deno.test('cancelWorkflowRun - returns 400 when run is already completed', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-02T00:00:00.000Z') as any;
  const drizzle = buildDrizzleMock([{ id: 'run-1', status: 'completed' }]);
    mocks.getDb = (() => drizzle) as any;

    const result = await cancelWorkflowRun(makeEnv(), { repoId: 'repo-1', runId: 'run-1' });

    assertEquals(result.ok, false);
    assertEquals(result.status, 400);
    assertStringIncludes(result.error, 'already completed or cancelled');
})
  Deno.test('cancelWorkflowRun - returns 400 when run is already cancelled', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-02T00:00:00.000Z') as any;
  const drizzle = buildDrizzleMock([{ id: 'run-1', status: 'cancelled' }]);
    mocks.getDb = (() => drizzle) as any;

    const result = await cancelWorkflowRun(makeEnv(), { repoId: 'repo-1', runId: 'run-1' });

    assertEquals(result.ok, false);
    assertEquals(result.status, 400);
})
  Deno.test('cancelWorkflowRun - cancels a queued run successfully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-02T00:00:00.000Z') as any;
  const drizzle = buildDrizzleMock([
      { id: 'run-1', status: 'queued' },  // run lookup
      [],                                    // running jobs
      [],                                    // all job ids
    ]);
    mocks.getDb = (() => drizzle) as any;

    const result = await cancelWorkflowRun(makeEnv(), { repoId: 'repo-1', runId: 'run-1' });

    assertEquals(result.ok, true);
    assertEquals(result.status, 200);
    if (result.ok) {
      assertEquals(result.cancelled, true);
    }
    assert(drizzle.update.calls.length > 0);
})
  Deno.test('cancelWorkflowRun - calls runtime to cancel running jobs when RUNTIME_HOST is available', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-02T00:00:00.000Z') as any;
  const drizzle = buildDrizzleMock([
      { id: 'run-1', status: 'in_progress' },  // run
      [{ id: 'job-1' }, { id: 'job-2' }],       // running jobs
      [{ id: 'job-1' }, { id: 'job-2' }, { id: 'job-3' }], // all jobs
    ]);
    mocks.getDb = (() => drizzle) as any;
    mocks.callRuntimeRequest = (async () => undefined) as any;

    const env = makeEnv({ runtimeHost: true });
    const result = await cancelWorkflowRun(env, { repoId: 'repo-1', runId: 'run-1' });

    assertEquals(result.ok, true);
    assertSpyCalls(mocks.callRuntimeRequest, 2);
})
  Deno.test('cancelWorkflowRun - handles runtime cancellation failures gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-02T00:00:00.000Z') as any;
  const drizzle = buildDrizzleMock([
      { id: 'run-1', status: 'in_progress' },
      [{ id: 'job-1' }],
      [{ id: 'job-1' }],
    ]);
    mocks.getDb = (() => drizzle) as any;
    mocks.callRuntimeRequest = (async () => { throw new Error('Runtime down'); }) as any;

    const env = makeEnv({ runtimeHost: true });
    const result = await cancelWorkflowRun(env, { repoId: 'repo-1', runId: 'run-1' });

    assertEquals(result.ok, true);
    assert(mocks.logWarn.calls.length > 0);
})

  Deno.test('rerunWorkflowRun - returns 404 when original run not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'new-rerun-id') as any;
    mocks.now = (() => '2026-03-03T00:00:00.000Z') as any;
    mocks.createWorkflowJobs = (async () => new Map()) as any;
    mocks.enqueueFirstPhaseJobs = (async () => undefined) as any;
  const drizzle = buildDrizzleMock([null]);
    mocks.getDb = (() => drizzle) as any;

    const result = await rerunWorkflowRun(makeEnv(), {
      repoId: 'repo-1', runId: 'missing', actorId: 'user-1', defaultBranch: 'main',
    });

    assertEquals(result.ok, false);
    assertEquals(result.status, 404);
})
  Deno.test('rerunWorkflowRun - returns 400 when run is still in progress', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'new-rerun-id') as any;
    mocks.now = (() => '2026-03-03T00:00:00.000Z') as any;
    mocks.createWorkflowJobs = (async () => new Map()) as any;
    mocks.enqueueFirstPhaseJobs = (async () => undefined) as any;
  const drizzle = buildDrizzleMock([{
      id: 'run-1',
      status: 'in_progress',
      workflowPath: '.takos/ci.yml',
    }]);
    mocks.getDb = (() => drizzle) as any;

    const result = await rerunWorkflowRun(makeEnv(), {
      repoId: 'repo-1', runId: 'run-1', actorId: 'user-1', defaultBranch: 'main',
    });

    assertEquals(result.ok, false);
    assertEquals(result.status, 400);
    assertStringIncludes(result.error, 'only re-run completed or cancelled');
})
  Deno.test('rerunWorkflowRun - returns error when GIT_OBJECTS is not configured', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'new-rerun-id') as any;
    mocks.now = (() => '2026-03-03T00:00:00.000Z') as any;
    mocks.createWorkflowJobs = (async () => new Map()) as any;
    mocks.enqueueFirstPhaseJobs = (async () => undefined) as any;
  const drizzle = buildDrizzleMock([{
      id: 'run-1',
      status: 'completed',
      workflowPath: '.takos/ci.yml',
      ref: 'refs/heads/main',
      sha: 'sha-1',
      workflowId: 'wf-1',
      event: 'push',
      inputs: null,
      runNumber: 1,
      runAttempt: 1,
    }]);
    mocks.getDb = (() => drizzle) as any;

    const result = await rerunWorkflowRun(
      makeEnv({ gitObjects: false }),
      { repoId: 'repo-1', runId: 'run-1', actorId: 'user-1', defaultBranch: 'main' },
    );

    assertEquals(result.ok, false);
    assertEquals(result.status, 500);
})
  Deno.test('rerunWorkflowRun - creates a new run with incremented run_attempt on successful rerun', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'new-rerun-id') as any;
    mocks.now = (() => '2026-03-03T00:00:00.000Z') as any;
    mocks.createWorkflowJobs = (async () => new Map()) as any;
    mocks.enqueueFirstPhaseJobs = (async () => undefined) as any;
  const originalRun = {
      id: 'run-1',
      status: 'completed',
      workflowPath: '.takos/ci.yml',
      ref: 'refs/heads/main',
      sha: 'sha-abc',
      workflowId: 'wf-1',
      event: 'push',
      inputs: '{"key":"val"}',
      runNumber: 3,
      runAttempt: 1,
    };

    const drizzle = buildDrizzleMock([originalRun]);
    mocks.getDb = (() => drizzle) as any;
    mocks.resolveRef = (async () => 'sha-abc') as any;
    mocks.getCommitData = (async () => ({ tree: 'tree-1' })) as any;
    mocks.getBlobAtPath = (async () => new TextEncoder().encode('name: CI')) as any;
    mocks.parseWorkflow = (() => ({
      workflow: validWorkflow,
      diagnostics: [],
    })) as any;
    mocks.validateWorkflow = (() => ({ diagnostics: [] })) as any;

    const result = await rerunWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', runId: 'run-1', actorId: 'user-1', defaultBranch: 'main' },
    );

    assertEquals(result.ok, true);
    assertEquals(result.status, 201);
    if (result.ok) {
      assertEquals(result.run.id, 'new-rerun-id');
      assertEquals(result.run.run_number, 3);
      assertEquals(result.run.run_attempt, 2);
      assertEquals(result.run.status, 'queued');
    }
})
  Deno.test('rerunWorkflowRun - can rerun a cancelled run', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.generateId = (() => 'new-rerun-id') as any;
    mocks.now = (() => '2026-03-03T00:00:00.000Z') as any;
    mocks.createWorkflowJobs = (async () => new Map()) as any;
    mocks.enqueueFirstPhaseJobs = (async () => undefined) as any;
  const originalRun = {
      id: 'run-1',
      status: 'cancelled',
      workflowPath: '.takos/ci.yml',
      ref: 'refs/heads/dev',
      sha: 'sha-xyz',
      workflowId: null,
      event: 'workflow_dispatch',
      inputs: null,
      runNumber: 1,
      runAttempt: 2,
    };

    const drizzle = buildDrizzleMock([originalRun]);
    mocks.getDb = (() => drizzle) as any;
    mocks.resolveRef = (async () => 'sha-xyz') as any;
    mocks.getCommitData = (async () => ({ tree: 'tree-1' })) as any;
    mocks.getBlobAtPath = (async () => new TextEncoder().encode('name: CI')) as any;
    mocks.parseWorkflow = (() => ({
      workflow: validWorkflow,
      diagnostics: [],
    })) as any;
    mocks.validateWorkflow = (() => ({ diagnostics: [] })) as any;

    const result = await rerunWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', runId: 'run-1', actorId: 'user-1', defaultBranch: 'main' },
    );

    assertEquals(result.ok, true);
    if (result.ok) {
      assertEquals(result.run.run_attempt, 3);
    }
})