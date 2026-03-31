import type { D1Database, Queue, R2Bucket } from '@cloudflare/workers-types';
import type { Workflow } from 'takos-actions-engine';

import { assertEquals, assert } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  parseWorkflow: ((..._args: any[]) => undefined) as any,
  resolveRef: ((..._args: any[]) => undefined) as any,
  getCommitData: ((..._args: any[]) => undefined) as any,
  getBlobAtPath: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from 'takos-actions-engine'
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart'
import { evaluateDependencies, scheduleDependentJobs } from '@/services/execution/workflow-job-scheduler';

function createQueueMock(): Queue<unknown> {
  return {
    send: ((..._args: any[]) => undefined) as any,
  } as unknown as Queue<unknown>;
}

/**
 * Build a chainable Drizzle mock that routes based on call sequence.
 * Each invocation of select/update can have different return values.
 */
function buildDrizzleMock(selectResults: unknown[], updateHandler?: () => void) {
  let selectIdx = 0;
  const runFn = (async () => undefined);

  const drizzle = {
    select: () => {
      const result = selectResults[selectIdx++];
      const chain = {
        from: (() => ({
          where: (() => ({
            get: (async () => result),
            all: (async () => Array.isArray(result) ? result : []),
            orderBy: (function(this: any) { return this; }),
            limit: (function(this: any) { return this; }),
          })),
          get: (async () => result),
          all: (async () => Array.isArray(result) ? result : []),
        })),
      };
      return chain;
    },
    update: () => {
      if (updateHandler) updateHandler();
      return {
        set: (() => ({
          where: (() => ({
            run: runFn,
            returning: (() => ({ get: ((..._args: any[]) => undefined) as any })),
          })),
          run: runFn,
        })),
      };
    },
    insert: () => ({
      values: (() => ({
        returning: (() => ({
          get: (async () => ({})),
        })),
        run: ((..._args: any[]) => undefined) as any,
      })),
    }),
  };

  return { drizzle, runFn };
}


  Deno.test('WorkflowEngine dependency conclusion guard (issue 001) - evaluateDependencies returns allSuccessful=false when dependency conclusion is failure', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // evaluateDependencies does one select per dep:
    // select({ status, conclusion }).from(workflowJobs).where(...).get()
    const { drizzle } = buildDrizzleMock([
      { status: 'completed', conclusion: 'failure' },
    ]);
    mocks.getDb = (() => drizzle) as any;

    const result = await evaluateDependencies({} as D1Database, 'run-1', ['job-a']);

    assertEquals(result.allCompleted, true);
    assertEquals(result.allSuccessful, false);
})
  Deno.test('WorkflowEngine dependency conclusion guard (issue 001) - scheduleDependentJobs skips dependent job when one of multiple needs failed', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const queue = createQueueMock();

    // scheduleDependentJobs flow:
    // 1. select().from(workflowRuns).where(...).get() -> run record
    // 2. loadWorkflowFromGit (uses git-smart mocks, not DB)
    // Then for each dependent job that includes completedJobKey in needs:
    //   evaluateDependencies loops over each dep in needs[]:
    //     3. select({status,conclusion}).from(workflowJobs).where(...).get() -> jobA (failed)
    //     ** evaluateDependencies returns early: allCompleted=true, allSuccessful=false
    //   4. findJobRecordByKey: select({id}).from(workflowJobs).where(...).get() -> jobB record
    //   skipJobAndSteps:
    //     5. update(workflowJobs).set({...}).where(...).run()
    //     6. update(workflowSteps).set({...}).where(...).run()
    //   recursive scheduleDependentJobs for jobB:
    //     7. select().from(workflowRuns).where(...).get() -> run record
    //     (no job depends on jobB, so nothing else)
    //   finalizeRunIfComplete:
    //     8. select({count}).from(workflowJobs).where(...).get() -> pending count
    //     (if pending > 0, return)
    //   finalizeRunIfComplete for outer:
    //     9. select({count}).from(workflowJobs).where(...).get() -> pending count

    const runRecord = {
      id: 'run-1',
      repoId: 'repo-1',
      workflowPath: '.takos/workflows/ci.yml',
      ref: 'refs/heads/main',
      sha: 'sha-1',
    };

    const updateCalls: string[] = [];
    let selectIdx = 0;
    const selectResults = [
      // 1. scheduleDependentJobs: load run
      runRecord,
      // 3. evaluateDependencies: jobA dep check
      { status: 'completed', conclusion: 'failure' },
      // 4. findJobRecordByKey: jobB record
      { id: 'job-b-id' },
      // 7. recursive scheduleDependentJobs: load run (for jobB cascading)
      runRecord,
      // 9. finalizeRunIfComplete (for recursive call): pending jobs count
      { count: 1 },
      // finalizeRunIfComplete (for outer call): pending jobs count
      { count: 1 },
    ];

    const drizzle = {
      select: () => {
        const result = selectResults[selectIdx++];
        return {
          from: (() => ({
            where: (() => ({
              get: (async () => result),
              all: (async () => Array.isArray(result) ? result : []),
            })),
            get: (async () => result),
            all: (async () => Array.isArray(result) ? result : []),
          })),
        };
      },
      update: () => {
        return {
          set: (data: Record<string, unknown>) => {
            updateCalls.push(JSON.stringify(data));
            return {
              where: (() => ({
                run: (async () => undefined),
              })),
            };
          },
        };
      },
    };
    mocks.getDb = (() => drizzle) as any;

    mocks.resolveRef = (async () => 'sha-1') as any;
    mocks.getCommitData = (async () => ({ tree: 'tree-1' })) as any;
    mocks.getBlobAtPath = (async () => new TextEncoder().encode('name: ci')) as any;
    mocks.parseWorkflow = (() => ({
      workflow: {
        jobs: {
          jobA: { runsOn: 'ubuntu-latest', steps: [] },
          jobC: { runsOn: 'ubuntu-latest', steps: [] },
          jobB: { runsOn: 'ubuntu-latest', needs: ['jobA', 'jobC'], steps: [] },
        },
      } as unknown as Workflow,
      diagnostics: [],
    })) as any;

    await scheduleDependentJobs(
      {} as D1Database,
      {} as R2Bucket,
      queue as unknown as Queue<{ type: 'job' }>,
      'run-1',
      'jobC',
    );

    // Should have called update to skip jobB (set status=completed, conclusion=skipped)
    assert(drizzle.update.calls.length > 0);
    const skipUpdate = updateCalls.find((c) => c.includes('"conclusion":"skipped"'));
    assert(skipUpdate);

    // Queue should NOT have been called (job was skipped, not enqueued)
    assertSpyCalls((queue.send as unknown as ReturnType<typeof vi.fn>), 0);
})