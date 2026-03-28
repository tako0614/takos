import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database, Queue, R2Bucket } from '@cloudflare/workers-types';
import type { Workflow } from 'takos-actions-engine';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  parseWorkflow: vi.fn(),
  resolveRef: vi.fn(),
  getCommitData: vi.fn(),
  getBlobAtPath: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

vi.mock('takos-actions-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('takos-actions-engine')>();
  return {
    ...actual,
    parseWorkflow: mocks.parseWorkflow,
  };
});

vi.mock('@/services/git-smart', () => ({
  resolveRef: mocks.resolveRef,
  getCommitData: mocks.getCommitData,
  getBlobAtPath: mocks.getBlobAtPath,
}));

import { evaluateDependencies, scheduleDependentJobs } from '@/services/execution/workflow-job-scheduler';

function createQueueMock(): Queue<unknown> {
  return {
    send: vi.fn(),
  } as unknown as Queue<unknown>;
}

/**
 * Build a chainable Drizzle mock that routes based on call sequence.
 * Each invocation of select/update can have different return values.
 */
function buildDrizzleMock(selectResults: unknown[], updateHandler?: () => void) {
  let selectIdx = 0;
  const runFn = vi.fn().mockResolvedValue(undefined);

  const drizzle = {
    select: vi.fn().mockImplementation(() => {
      const result = selectResults[selectIdx++];
      const chain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue(result),
            all: vi.fn().mockResolvedValue(Array.isArray(result) ? result : []),
            orderBy: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
          }),
          get: vi.fn().mockResolvedValue(result),
          all: vi.fn().mockResolvedValue(Array.isArray(result) ? result : []),
        }),
      };
      return chain;
    }),
    update: vi.fn().mockImplementation(() => {
      if (updateHandler) updateHandler();
      return {
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            run: runFn,
            returning: vi.fn().mockReturnValue({ get: vi.fn() }),
          }),
          run: runFn,
        }),
      };
    }),
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({}),
        }),
        run: vi.fn(),
      }),
    })),
  };

  return { drizzle, runFn };
}

describe('WorkflowEngine dependency conclusion guard (issue 001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('evaluateDependencies returns allSuccessful=false when dependency conclusion is failure', async () => {
    // evaluateDependencies does one select per dep:
    // select({ status, conclusion }).from(workflowJobs).where(...).get()
    const { drizzle } = buildDrizzleMock([
      { status: 'completed', conclusion: 'failure' },
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await evaluateDependencies({} as D1Database, 'run-1', ['job-a']);

    expect(result.allCompleted).toBe(true);
    expect(result.allSuccessful).toBe(false);
  });

  it('scheduleDependentJobs skips dependent job when one of multiple needs failed', async () => {
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
      select: vi.fn().mockImplementation(() => {
        const result = selectResults[selectIdx++];
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue(result),
              all: vi.fn().mockResolvedValue(Array.isArray(result) ? result : []),
            }),
            get: vi.fn().mockResolvedValue(result),
            all: vi.fn().mockResolvedValue(Array.isArray(result) ? result : []),
          }),
        };
      }),
      update: vi.fn().mockImplementation(() => {
        return {
          set: vi.fn().mockImplementation((data: Record<string, unknown>) => {
            updateCalls.push(JSON.stringify(data));
            return {
              where: vi.fn().mockReturnValue({
                run: vi.fn().mockResolvedValue(undefined),
              }),
            };
          }),
        };
      }),
    };
    mocks.getDb.mockReturnValue(drizzle);

    mocks.resolveRef.mockResolvedValue('sha-1');
    mocks.getCommitData.mockResolvedValue({ tree: 'tree-1' });
    mocks.getBlobAtPath.mockResolvedValue(new TextEncoder().encode('name: ci'));
    mocks.parseWorkflow.mockReturnValue({
      workflow: {
        jobs: {
          jobA: { runsOn: 'ubuntu-latest', steps: [] },
          jobC: { runsOn: 'ubuntu-latest', steps: [] },
          jobB: { runsOn: 'ubuntu-latest', needs: ['jobA', 'jobC'], steps: [] },
        },
      } as unknown as Workflow,
      diagnostics: [],
    });

    await scheduleDependentJobs(
      {} as D1Database,
      {} as R2Bucket,
      queue as unknown as Queue<{ type: 'job' }>,
      'run-1',
      'jobC',
    );

    // Should have called update to skip jobB (set status=completed, conclusion=skipped)
    expect(drizzle.update).toHaveBeenCalled();
    const skipUpdate = updateCalls.find((c) => c.includes('"conclusion":"skipped"'));
    expect(skipUpdate).toBeTruthy();

    // Queue should NOT have been called (job was skipped, not enqueued)
    expect((queue.send as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
