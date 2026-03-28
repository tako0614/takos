import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database, Queue } from '@cloudflare/workers-types';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  resolveRef: vi.fn(),
  getCommitData: vi.fn(),
  getBlobAtPath: vi.fn(),
  parseWorkflow: vi.fn(),
  validateWorkflow: vi.fn(),
  createWorkflowJobs: vi.fn(),
  enqueueFirstPhaseJobs: vi.fn(),
  callRuntimeRequest: vi.fn(),
  generateId: vi.fn(),
  now: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

vi.mock('@/services/git-smart', () => ({
  resolveRef: mocks.resolveRef,
  getCommitData: mocks.getCommitData,
  getBlobAtPath: mocks.getBlobAtPath,
}));

vi.mock('@takos/actions-engine', () => ({
  parseWorkflow: mocks.parseWorkflow,
  validateWorkflow: mocks.validateWorkflow,
}));

vi.mock('@/services/actions', () => ({
  createWorkflowJobs: mocks.createWorkflowJobs,
  enqueueFirstPhaseJobs: mocks.enqueueFirstPhaseJobs,
}));

vi.mock('@/services/execution/runtime', () => ({
  callRuntimeRequest: mocks.callRuntimeRequest,
}));

vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils')>();
  return {
    ...actual,
    generateId: mocks.generateId,
    now: mocks.now,
  };
});

vi.mock('@/shared/utils/logger', () => ({
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logError: mocks.logError,
  logWarn: mocks.logWarn,
  createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  safeJsonParse: vi.fn((v: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } }),
  safeJsonParseOrDefault: vi.fn((v: unknown, d: unknown) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return d; } }),
}));

import { dispatchWorkflowRun, cancelWorkflowRun, rerunWorkflowRun } from '@/services/workflow-runs/commands';

function buildDrizzleMock(selectResults: unknown[]) {
  let selectIdx = 0;
  const runFn = vi.fn().mockResolvedValue(undefined);
  return {
    select: vi.fn().mockImplementation(() => {
      const result = selectResults[selectIdx++];
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.leftJoin = vi.fn().mockReturnValue(chain);
      chain.orderBy = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      chain.get = vi.fn().mockResolvedValue(result);
      chain.all = vi.fn().mockResolvedValue(Array.isArray(result) ? result : []);
      return chain;
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        run: runFn,
        returning: vi.fn().mockReturnValue({ get: vi.fn() }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          run: runFn,
          returning: vi.fn().mockReturnValue([]),
        }),
      }),
    }),
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
    WORKFLOW_QUEUE: options.workflowQueue ? { send: vi.fn() } : undefined,
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

describe('dispatchWorkflowRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateId.mockReturnValue('new-run-id');
    mocks.now.mockReturnValue('2026-03-01T00:00:00.000Z');
    mocks.createWorkflowJobs.mockResolvedValue(new Map([['build', 'job-build-id']]));
    mocks.enqueueFirstPhaseJobs.mockResolvedValue(undefined);
  });

  it('returns error when GIT_OBJECTS is not configured', async () => {
    const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: false }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1' },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toContain('Git storage not configured');
  });

  it('returns error when WORKFLOW_QUEUE is not configured', async () => {
    const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: false }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1' },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toContain('Workflow queue not configured');
  });

  it('returns 404 when ref cannot be resolved', async () => {
    mocks.resolveRef.mockResolvedValue(null);

    const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1' },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it('returns 400 when workflow has parse errors', async () => {
    mocks.resolveRef.mockResolvedValue('sha-1');
    mocks.getCommitData.mockResolvedValue({ tree: 'tree-1' });
    mocks.getBlobAtPath.mockResolvedValue(new TextEncoder().encode('invalid: yaml'));
    mocks.parseWorkflow.mockReturnValue({
      workflow: {},
      diagnostics: [{ severity: 'error', message: 'Parse error' }],
    });

    const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1' },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('returns 400 when workflow does not support manual dispatch', async () => {
    mocks.resolveRef.mockResolvedValue('sha-1');
    mocks.getCommitData.mockResolvedValue({ tree: 'tree-1' });
    mocks.getBlobAtPath.mockResolvedValue(new TextEncoder().encode('on: push'));
    mocks.parseWorkflow.mockReturnValue({
      workflow: { ...validWorkflow, on: 'push' },
      diagnostics: [],
    });
    mocks.validateWorkflow.mockReturnValue({ diagnostics: [] });

    const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1' },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain('does not support manual dispatch');
  });

  it('creates a workflow run successfully', async () => {
    mocks.resolveRef.mockResolvedValue('sha-abc');
    mocks.getCommitData.mockResolvedValue({ tree: 'tree-1' });
    mocks.getBlobAtPath.mockResolvedValue(new TextEncoder().encode('name: CI'));
    mocks.parseWorkflow.mockReturnValue({
      workflow: validWorkflow,
      diagnostics: [],
    });
    mocks.validateWorkflow.mockReturnValue({ diagnostics: [] });

    const drizzle = buildDrizzleMock([
      { maxRunNumber: 5 },  // last run number
      { id: 'existing-wf' }, // existing workflow
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1', inputs: { foo: 'bar' } },
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    if (result.ok) {
      expect(result.run.id).toBe('new-run-id');
      expect(result.run.status).toBe('queued');
      expect(result.run.run_number).toBe(6);
      expect(result.run.run_attempt).toBe(1);
      expect(result.run.sha).toBe('sha-abc');
      expect(result.run.ref).toBe('refs/heads/main');
    }

    expect(mocks.createWorkflowJobs).toHaveBeenCalled();
    expect(mocks.enqueueFirstPhaseJobs).toHaveBeenCalled();
  });

  it('starts run_number at 1 when no previous runs exist', async () => {
    mocks.resolveRef.mockResolvedValue('sha-abc');
    mocks.getCommitData.mockResolvedValue({ tree: 'tree-1' });
    mocks.getBlobAtPath.mockResolvedValue(new TextEncoder().encode('name: CI'));
    mocks.parseWorkflow.mockReturnValue({
      workflow: validWorkflow,
      diagnostics: [],
    });
    mocks.validateWorkflow.mockReturnValue({ diagnostics: [] });

    const drizzle = buildDrizzleMock([
      { maxRunNumber: null },  // no previous runs
      null,                     // no existing workflow
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await dispatchWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', workflowPath: '.takos/ci.yml', refName: 'main', actorId: 'user-1' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.run_number).toBe(1);
    }
  });
});

describe('cancelWorkflowRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.now.mockReturnValue('2026-03-02T00:00:00.000Z');
  });

  it('returns 404 when run not found', async () => {
    const drizzle = buildDrizzleMock([null]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await cancelWorkflowRun(makeEnv(), { repoId: 'repo-1', runId: 'missing' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it('returns 400 when run is already completed', async () => {
    const drizzle = buildDrizzleMock([{ id: 'run-1', status: 'completed' }]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await cancelWorkflowRun(makeEnv(), { repoId: 'repo-1', runId: 'run-1' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain('already completed or cancelled');
  });

  it('returns 400 when run is already cancelled', async () => {
    const drizzle = buildDrizzleMock([{ id: 'run-1', status: 'cancelled' }]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await cancelWorkflowRun(makeEnv(), { repoId: 'repo-1', runId: 'run-1' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('cancels a queued run successfully', async () => {
    const drizzle = buildDrizzleMock([
      { id: 'run-1', status: 'queued' },  // run lookup
      [],                                    // running jobs
      [],                                    // all job ids
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await cancelWorkflowRun(makeEnv(), { repoId: 'repo-1', runId: 'run-1' });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    if (result.ok) {
      expect(result.cancelled).toBe(true);
    }
    expect(drizzle.update).toHaveBeenCalled();
  });

  it('calls runtime to cancel running jobs when RUNTIME_HOST is available', async () => {
    const drizzle = buildDrizzleMock([
      { id: 'run-1', status: 'in_progress' },  // run
      [{ id: 'job-1' }, { id: 'job-2' }],       // running jobs
      [{ id: 'job-1' }, { id: 'job-2' }, { id: 'job-3' }], // all jobs
    ]);
    mocks.getDb.mockReturnValue(drizzle);
    mocks.callRuntimeRequest.mockResolvedValue(undefined);

    const env = makeEnv({ runtimeHost: true });
    const result = await cancelWorkflowRun(env, { repoId: 'repo-1', runId: 'run-1' });

    expect(result.ok).toBe(true);
    expect(mocks.callRuntimeRequest).toHaveBeenCalledTimes(2);
  });

  it('handles runtime cancellation failures gracefully', async () => {
    const drizzle = buildDrizzleMock([
      { id: 'run-1', status: 'in_progress' },
      [{ id: 'job-1' }],
      [{ id: 'job-1' }],
    ]);
    mocks.getDb.mockReturnValue(drizzle);
    mocks.callRuntimeRequest.mockRejectedValue(new Error('Runtime down'));

    const env = makeEnv({ runtimeHost: true });
    const result = await cancelWorkflowRun(env, { repoId: 'repo-1', runId: 'run-1' });

    expect(result.ok).toBe(true);
    expect(mocks.logWarn).toHaveBeenCalled();
  });
});

describe('rerunWorkflowRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateId.mockReturnValue('new-rerun-id');
    mocks.now.mockReturnValue('2026-03-03T00:00:00.000Z');
    mocks.createWorkflowJobs.mockResolvedValue(new Map());
    mocks.enqueueFirstPhaseJobs.mockResolvedValue(undefined);
  });

  it('returns 404 when original run not found', async () => {
    const drizzle = buildDrizzleMock([null]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await rerunWorkflowRun(makeEnv(), {
      repoId: 'repo-1', runId: 'missing', actorId: 'user-1', defaultBranch: 'main',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it('returns 400 when run is still in progress', async () => {
    const drizzle = buildDrizzleMock([{
      id: 'run-1',
      status: 'in_progress',
      workflowPath: '.takos/ci.yml',
    }]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await rerunWorkflowRun(makeEnv(), {
      repoId: 'repo-1', runId: 'run-1', actorId: 'user-1', defaultBranch: 'main',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain('only re-run completed or cancelled');
  });

  it('returns error when GIT_OBJECTS is not configured', async () => {
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
    mocks.getDb.mockReturnValue(drizzle);

    const result = await rerunWorkflowRun(
      makeEnv({ gitObjects: false }),
      { repoId: 'repo-1', runId: 'run-1', actorId: 'user-1', defaultBranch: 'main' },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it('creates a new run with incremented run_attempt on successful rerun', async () => {
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
    mocks.getDb.mockReturnValue(drizzle);
    mocks.resolveRef.mockResolvedValue('sha-abc');
    mocks.getCommitData.mockResolvedValue({ tree: 'tree-1' });
    mocks.getBlobAtPath.mockResolvedValue(new TextEncoder().encode('name: CI'));
    mocks.parseWorkflow.mockReturnValue({
      workflow: validWorkflow,
      diagnostics: [],
    });
    mocks.validateWorkflow.mockReturnValue({ diagnostics: [] });

    const result = await rerunWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', runId: 'run-1', actorId: 'user-1', defaultBranch: 'main' },
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    if (result.ok) {
      expect(result.run.id).toBe('new-rerun-id');
      expect(result.run.run_number).toBe(3);
      expect(result.run.run_attempt).toBe(2);
      expect(result.run.status).toBe('queued');
    }
  });

  it('can rerun a cancelled run', async () => {
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
    mocks.getDb.mockReturnValue(drizzle);
    mocks.resolveRef.mockResolvedValue('sha-xyz');
    mocks.getCommitData.mockResolvedValue({ tree: 'tree-1' });
    mocks.getBlobAtPath.mockResolvedValue(new TextEncoder().encode('name: CI'));
    mocks.parseWorkflow.mockReturnValue({
      workflow: validWorkflow,
      diagnostics: [],
    });
    mocks.validateWorkflow.mockReturnValue({ diagnostics: [] });

    const result = await rerunWorkflowRun(
      makeEnv({ gitObjects: true, workflowQueue: true }),
      { repoId: 'repo-1', runId: 'run-1', actorId: 'user-1', defaultBranch: 'main' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.run_attempt).toBe(3);
    }
  });
});
