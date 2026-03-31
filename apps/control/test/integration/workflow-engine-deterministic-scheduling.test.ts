import type { D1Database, Queue, R2Bucket } from '@cloudflare/workers-types';
import type { Workflow } from 'takos-actions-engine';

import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  parseWorkflow: ((..._args: any[]) => undefined) as any,
  resolveRef: ((..._args: any[]) => undefined) as any,
  getCommit: ((..._args: any[]) => undefined) as any,
  getBlobAtPath: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/infra/db'
// [Deno] vi.mock removed - manually stub imports from 'takos-actions-engine'
// [Deno] vi.mock removed - manually stub imports from '@/application/services/git-smart'
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
    select: () => {
      const currentCall = selectCallIndex++;
      const chain = {
        _table: null as unknown,
        from: (table: unknown) => {
          (chain as Record<string, unknown>)._table = table;
          return chain;
        },
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        get: async () => {
          // We need to distinguish run lookups vs job lookups.
          // The first call is always the run lookup.
          // Subsequent .get() calls are job lookups (evaluateDependencies, findJobRecordByKey, finalizeRunIfComplete).
          if (currentCall === 0) {
            return opts.selectRunGet();
          }
          return opts.selectJobGet();
        },
        all: async () => {
          const result = opts.selectSecretAll();
          return Array.isArray(result) ? result : [];
        },
      };
      return chain;
    },
    update: () => ({
      set: () => ({
        where: async () => ({}),
        run: async () => ({}),
      }),
    }),
    insert: () => ({
      values: () => ({
        run: async () => ({}),
      }),
    }),
  };
}

function createQueueMock(): Queue<unknown> {
  return {
    send: ((..._args: any[]) => undefined) as any,
  } as unknown as Queue<unknown>;
}


  Deno.test('workflow-engine dependent scheduling uses immutable run SHA - loads workflow definition from run.sha without resolving mutable refs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const queue = createQueueMock();

    // selectJobGet is called multiple times:
    // 1. evaluateDependencies('build') -> { status: 'completed', conclusion: 'success' }
    // 2. findJobRecordByKey('deploy') -> { id: 'job-deploy-id' }
    // 3+ finalizeRunIfComplete pending count -> { count: 1 } (still pending)
    const selectJobGet = ((..._args: any[]) => undefined) as any
       = (async () => ({ status: 'completed', conclusion: 'success' })) as any // evaluateDependencies
       = (async () => ({ id: 'job-deploy-id' })) as any                       // findJobRecordByKey
       = (async () => ({ count: 1 })) as any;                                     // finalizeRunIfComplete (pending > 0 = skip)

    const db = createDrizzleDbMock({
      selectRunGet: (async () => ({
        id: 'run-1',
        repoId: 'repo-1',
        workflowPath: '.takos/workflows/ci.yml',
        ref: 'refs/heads/main',
        sha: 'sha-pinned',
      })),
      selectJobGet,
      selectSecretAll: (() => []),
    });

    mocks.getDb = (() => db) as any;

    mocks.resolveRef = (async () => 'sha-head') as any;
    mocks.getCommit = (async () => ({ tree: 'tree-pinned' })) as any;
    mocks.getBlobAtPath = (async () => new TextEncoder().encode('name: ci')) as any;
    mocks.parseWorkflow = (() => ({
      workflow: {
        jobs: {
          build: { runsOn: 'ubuntu-latest', steps: [] },
          deploy: { runsOn: 'ubuntu-latest', needs: ['build'], steps: [] },
        },
      } as unknown as Workflow,
      diagnostics: [],
    })) as any;

    await scheduleDependentJobs(
      {} as D1Database,
      {} as R2Bucket,
      queue as unknown as Queue<{ type: 'job' }>,
      'run-1',
      'build',
    );

    assertSpyCalls(mocks.resolveRef, 0);
    assertSpyCallArgs(mocks.getCommit, 0, [expect.anything(), 'sha-pinned']);
    assertSpyCalls((queue.send as unknown as ReturnType<typeof vi.fn>), 1);
})