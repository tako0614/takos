import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database, Queue, R2Bucket } from '@cloudflare/workers-types';
import type { Workflow } from '@takoserver/actions-engine';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  parseWorkflow: vi.fn(),
  resolveRef: vi.fn(),
  getCommit: vi.fn(),
  getBlobAtPath: vi.fn(),
}));

vi.mock('@/infra/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/infra/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@takoserver/actions-engine', async () => {
  const actual = await vi.importActual<typeof import('@takoserver/actions-engine')>('@takoserver/actions-engine');
  return {
    ...actual,
    parseWorkflow: mocks.parseWorkflow,
  };
});

vi.mock('@/application/services/git-smart', () => ({
  resolveRef: mocks.resolveRef,
  getCommitData: mocks.getCommit,
  getBlobAtPath: mocks.getBlobAtPath,
}));

import { scheduleDependentJobs } from '@/application/services/execution/workflow-job-scheduler';

/**
 * Build a Drizzle-chainable mock for WorkflowEngine.
 * Routes select/update calls by tracking the table passed to .from().
 */
function createDrizzleDbMock(opts: {
  /** db.select().from(workflowRuns).where(...).get() */
  selectRunGet: ReturnType<typeof vi.fn>;
  /** db.select({status,conclusion}).from(workflowJobs).where(...).get() - evaluateDependencies + findJobRecordByKey */
  selectJobGet: ReturnType<typeof vi.fn>;
  /** db.select({id}).from(workflowSecrets).where(...).all() */
  selectSecretAll: ReturnType<typeof vi.fn>;
  /** db.select({count}).from(workflowJobs).where(...).get() - finalizeRunIfComplete pending count */
  selectJobCountGet?: ReturnType<typeof vi.fn>;
}) {
  let selectCallIndex = 0;

  return {
    select: vi.fn(() => {
      const currentCall = selectCallIndex++;
      const chain = {
        _table: null as unknown,
        from: vi.fn((table: unknown) => {
          (chain as Record<string, unknown>)._table = table;
          return chain;
        }),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        get: vi.fn(async () => {
          // We need to distinguish run lookups vs job lookups.
          // The first call is always the run lookup.
          // Subsequent .get() calls are job lookups (evaluateDependencies, findJobRecordByKey, finalizeRunIfComplete).
          if (currentCall === 0) {
            return opts.selectRunGet();
          }
          return opts.selectJobGet();
        }),
        all: vi.fn(async () => {
          const result = opts.selectSecretAll();
          return Array.isArray(result) ? result : [];
        }),
      };
      return chain;
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => ({})),
        run: vi.fn(async () => ({})),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        run: vi.fn(async () => ({})),
      })),
    })),
  };
}

function createQueueMock(): Queue<unknown> {
  return {
    send: vi.fn(),
  } as unknown as Queue<unknown>;
}

describe('workflow-engine dependent scheduling uses immutable run SHA', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads workflow definition from run.sha without resolving mutable refs', async () => {
    const queue = createQueueMock();

    // selectJobGet is called multiple times:
    // 1. evaluateDependencies('build') -> { status: 'completed', conclusion: 'success' }
    // 2. findJobRecordByKey('deploy') -> { id: 'job-deploy-id' }
    // 3+ finalizeRunIfComplete pending count -> { count: 1 } (still pending)
    const selectJobGet = vi.fn()
      .mockResolvedValueOnce({ status: 'completed', conclusion: 'success' }) // evaluateDependencies
      .mockResolvedValueOnce({ id: 'job-deploy-id' })                       // findJobRecordByKey
      .mockResolvedValue({ count: 1 });                                     // finalizeRunIfComplete (pending > 0 = skip)

    const db = createDrizzleDbMock({
      selectRunGet: vi.fn().mockResolvedValue({
        id: 'run-1',
        repoId: 'repo-1',
        workflowPath: '.takos/workflows/ci.yml',
        ref: 'refs/heads/main',
        sha: 'sha-pinned',
      }),
      selectJobGet,
      selectSecretAll: vi.fn().mockReturnValue([]),
    });

    mocks.getDb.mockReturnValue(db);

    mocks.resolveRef.mockResolvedValue('sha-head');
    mocks.getCommit.mockResolvedValue({ tree: 'tree-pinned' });
    mocks.getBlobAtPath.mockResolvedValue(new TextEncoder().encode('name: ci'));
    mocks.parseWorkflow.mockReturnValue({
      workflow: {
        jobs: {
          build: { runsOn: 'ubuntu-latest', steps: [] },
          deploy: { runsOn: 'ubuntu-latest', needs: ['build'], steps: [] },
        },
      } as unknown as Workflow,
      diagnostics: [],
    });

    await scheduleDependentJobs(
      {} as D1Database,
      {} as R2Bucket,
      queue as unknown as Queue<{ type: 'job' }>,
      'run-1',
      'build',
    );

    expect(mocks.resolveRef).not.toHaveBeenCalled();
    expect(mocks.getCommit).toHaveBeenCalledWith(expect.anything(), 'sha-pinned');
    expect((queue.send as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});
