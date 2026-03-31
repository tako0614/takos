import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  listWorkflowRuns,
  getWorkflowRunDetail,
  getWorkflowRunJobs,
} from '@/services/workflow-runs/read-model';

function buildDrizzleMock(selectResults: unknown[]) {
  let selectIdx = 0;
  return {
    select: () => {
      const result = selectResults[selectIdx++];
      const chain: Record<string, unknown> = {};
      chain.from = (() => chain);
      chain.where = (() => chain);
      chain.leftJoin = (() => chain);
      chain.orderBy = (() => chain);
      chain.limit = (() => chain);
      chain.offset = (() => chain);
      chain.get = (async () => Array.isArray(result) ? result[0] ?? null : result,);
      chain.all = (async () => Array.isArray(result) ? result : [],);
      return chain;
    },
  };
}

function makeWorkflowRunRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'run-1',
    workflowPath: '.takos/workflows/ci.yml',
    event: 'push',
    ref: 'refs/heads/main',
    sha: 'sha-abc123',
    status: 'completed',
    conclusion: 'success',
    runNumber: 1,
    runAttempt: 1,
    inputs: null,
    queuedAt: '2026-03-01T00:00:00.000Z',
    startedAt: '2026-03-01T00:01:00.000Z',
    completedAt: '2026-03-01T00:05:00.000Z',
    createdAt: '2026-03-01T00:00:00.000Z',
    actorAccountId: 'user-1',
    actorName: 'Test User',
    actorPicture: 'https://example.com/avatar.png',
    actorId: 'user-1',
    ...overrides,
  };
}

function makeJobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'job-1',
    name: 'build',
    status: 'completed',
    conclusion: 'success',
    runnerName: 'runner-1',
    startedAt: '2026-03-01T00:01:00.000Z',
    completedAt: '2026-03-01T00:04:00.000Z',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeStepRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    number: 1,
    name: 'Checkout',
    status: 'completed',
    conclusion: 'success',
    startedAt: '2026-03-01T00:01:00.000Z',
    completedAt: '2026-03-01T00:01:30.000Z',
    ...overrides,
  };
}


  Deno.test('listWorkflowRuns - returns workflow runs with mapped fields', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const runs = [makeWorkflowRunRow()];
    mocks.getDb = (() => buildDrizzleMock([runs])) as any;

    const result = await listWorkflowRuns({} as D1Database, {
      repoId: 'repo-1',
      limit: 10,
      offset: 0,
    });

    assertEquals(result.runs.length, 1);
    assertEquals(result.has_more, false);

    const run = result.runs[0];
    assertEquals(run.id, 'run-1');
    assertEquals(run.workflow_path, '.takos/workflows/ci.yml');
    assertEquals(run.event, 'push');
    assertEquals(run.ref, 'refs/heads/main');
    assertEquals(run.sha, 'sha-abc123');
    assertEquals(run.status, 'completed');
    assertEquals(run.conclusion, 'success');
    assertEquals(run.run_number, 1);
    assertEquals(run.run_attempt, 1);
    assertEquals(run.actor, {
      id: 'user-1',
      name: 'Test User',
      avatar_url: 'https://example.com/avatar.png',
    });
})
  Deno.test('listWorkflowRuns - sets has_more=true when more results exist', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // DB returns limit+1 results to indicate more data
    const runs = Array.from({ length: 4 }, (_, i) =>
      makeWorkflowRunRow({ id: `run-${i}` }),
    );
    mocks.getDb = (() => buildDrizzleMock([runs])) as any;

    const result = await listWorkflowRuns({} as D1Database, {
      repoId: 'repo-1',
      limit: 3,
      offset: 0,
    });

    assertEquals(result.has_more, true);
    assertEquals(result.runs.length, 3);
})
  Deno.test('listWorkflowRuns - returns empty runs when none exist', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => buildDrizzleMock([[]])) as any;

    const result = await listWorkflowRuns({} as D1Database, {
      repoId: 'repo-1',
      limit: 10,
      offset: 0,
    });

    assertEquals(result.runs.length, 0);
    assertEquals(result.has_more, false);
})
  Deno.test('listWorkflowRuns - returns actor as null when actorId is missing', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const runs = [makeWorkflowRunRow({ actorId: null, actorName: null, actorPicture: null })];
    mocks.getDb = (() => buildDrizzleMock([runs])) as any;

    const result = await listWorkflowRuns({} as D1Database, {
      repoId: 'repo-1',
      limit: 10,
      offset: 0,
    });

    assertEquals(result.runs[0].actor, null);
})
  Deno.test('listWorkflowRuns - passes filter conditions correctly for workflow, status, branch, event', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => buildDrizzleMock([[]])) as any;

    await listWorkflowRuns({} as D1Database, {
      repoId: 'repo-1',
      workflow: '.takos/workflows/deploy.yml',
      status: 'completed',
      branch: 'main',
      event: 'push',
      limit: 10,
      offset: 0,
    });

    // We verify the function completes without error with these filter options.
    // The actual filtering is done by Drizzle ORM conditions.
    assert(mocks.getDb.calls.length > 0);
})

  Deno.test('getWorkflowRunDetail - returns null when run not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => buildDrizzleMock([null])) as any;

    const result = await getWorkflowRunDetail({} as D1Database, 'repo-1', 'missing');

    assertEquals(result, null);
})
  Deno.test('getWorkflowRunDetail - returns run detail with jobs and steps', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const runData = makeWorkflowRunRow({ inputs: '{"key":"value"}' });
    const jobs = [makeJobRow()];
    const steps = [
      makeStepRow({ number: 1, name: 'Checkout' }),
      makeStepRow({ number: 2, name: 'Build', conclusion: 'success' }),
    ];

    mocks.getDb = (() => buildDrizzleMock([
      runData,  // run lookup
      jobs,     // jobs lookup
      steps,    // steps for job-1
    ])) as any;

    const result = await getWorkflowRunDetail({} as D1Database, 'repo-1', 'run-1');

    assertNotEquals(result, null);
    assertEquals(result!.run.id, 'run-1');
    assertEquals(result!.run.inputs, { key: 'value' });
    assertEquals(result!.run.jobs.length, 1);
    assertEquals(result!.run.jobs[0].id, 'job-1');
    assertEquals(result!.run.jobs[0].name, 'build');
    assertEquals(result!.run.jobs[0].steps.length, 2);
    assertEquals(result!.run.jobs[0].steps[0].name, 'Checkout');
    assertEquals(result!.run.jobs[0].steps[1].name, 'Build');
})
  Deno.test('getWorkflowRunDetail - returns run detail with null actor when no actor account', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const runData = makeWorkflowRunRow({
      actorAccountId: null,
      actorName: null,
      actorPicture: null,
    });

    mocks.getDb = (() => buildDrizzleMock([
      runData,
      [],  // no jobs
    ])) as any;

    const result = await getWorkflowRunDetail({} as D1Database, 'repo-1', 'run-1');

    assertEquals(result!.run.actor, null);
    assertEquals(result!.run.jobs.length, 0);
})
  Deno.test('getWorkflowRunDetail - handles null inputs gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const runData = makeWorkflowRunRow({ inputs: null });

    mocks.getDb = (() => buildDrizzleMock([
      runData,
      [],  // no jobs
    ])) as any;

    const result = await getWorkflowRunDetail({} as D1Database, 'repo-1', 'run-1');

    assertEquals(result!.run.inputs, null);
})
  Deno.test('getWorkflowRunDetail - handles malformed inputs JSON gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const runData = makeWorkflowRunRow({ inputs: '{invalid json' });

    mocks.getDb = (() => buildDrizzleMock([
      runData,
      [],
    ])) as any;

    const result = await getWorkflowRunDetail({} as D1Database, 'repo-1', 'run-1');

    // safeJsonParseOrDefault should return the default (null)
    assertEquals(result!.run.inputs, null);
})

  Deno.test('getWorkflowRunJobs - returns null when run not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => buildDrizzleMock([null])) as any;

    const result = await getWorkflowRunJobs({} as D1Database, 'repo-1', 'missing');

    assertEquals(result, null);
})
  Deno.test('getWorkflowRunJobs - returns jobs for a valid run', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const jobs = [
      makeJobRow({ id: 'job-1', name: 'build' }),
      makeJobRow({ id: 'job-2', name: 'test', conclusion: 'failure' }),
    ];

    mocks.getDb = (() => buildDrizzleMock([
      { id: 'run-1' },  // run existence check
      jobs,              // jobs
    ])) as any;

    const result = await getWorkflowRunJobs({} as D1Database, 'repo-1', 'run-1');

    assertNotEquals(result, null);
    assertEquals(result!.jobs.length, 2);
    assertEquals(result!.jobs[0].id, 'job-1');
    assertEquals(result!.jobs[0].name, 'build');
    assertEquals(result!.jobs[1].id, 'job-2');
    assertEquals(result!.jobs[1].conclusion, 'failure');
})
  Deno.test('getWorkflowRunJobs - returns empty jobs array when run has no jobs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getDb = (() => buildDrizzleMock([
      { id: 'run-1' },
      [],
    ])) as any;

    const result = await getWorkflowRunJobs({} as D1Database, 'repo-1', 'run-1');

    assertNotEquals(result, null);
    assertEquals(result!.jobs.length, 0);
})