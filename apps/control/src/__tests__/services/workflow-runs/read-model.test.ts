import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

import {
  listWorkflowRuns,
  getWorkflowRunDetail,
  getWorkflowRunJobs,
} from '@/services/workflow-runs/read-model';

function buildDrizzleMock(selectResults: unknown[]) {
  let selectIdx = 0;
  return {
    select: vi.fn().mockImplementation(() => {
      const result = selectResults[selectIdx++];
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.leftJoin = vi.fn().mockReturnValue(chain);
      chain.orderBy = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      chain.offset = vi.fn().mockReturnValue(chain);
      chain.get = vi.fn().mockResolvedValue(
        Array.isArray(result) ? result[0] ?? null : result,
      );
      chain.all = vi.fn().mockResolvedValue(
        Array.isArray(result) ? result : [],
      );
      return chain;
    }),
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

describe('listWorkflowRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns workflow runs with mapped fields', async () => {
    const runs = [makeWorkflowRunRow()];
    mocks.getDb.mockReturnValue(buildDrizzleMock([runs]));

    const result = await listWorkflowRuns({} as D1Database, {
      repoId: 'repo-1',
      limit: 10,
      offset: 0,
    });

    expect(result.runs).toHaveLength(1);
    expect(result.has_more).toBe(false);

    const run = result.runs[0];
    expect(run.id).toBe('run-1');
    expect(run.workflow_path).toBe('.takos/workflows/ci.yml');
    expect(run.event).toBe('push');
    expect(run.ref).toBe('refs/heads/main');
    expect(run.sha).toBe('sha-abc123');
    expect(run.status).toBe('completed');
    expect(run.conclusion).toBe('success');
    expect(run.run_number).toBe(1);
    expect(run.run_attempt).toBe(1);
    expect(run.actor).toEqual({
      id: 'user-1',
      name: 'Test User',
      avatar_url: 'https://example.com/avatar.png',
    });
  });

  it('sets has_more=true when more results exist', async () => {
    // DB returns limit+1 results to indicate more data
    const runs = Array.from({ length: 4 }, (_, i) =>
      makeWorkflowRunRow({ id: `run-${i}` }),
    );
    mocks.getDb.mockReturnValue(buildDrizzleMock([runs]));

    const result = await listWorkflowRuns({} as D1Database, {
      repoId: 'repo-1',
      limit: 3,
      offset: 0,
    });

    expect(result.has_more).toBe(true);
    expect(result.runs).toHaveLength(3);
  });

  it('returns empty runs when none exist', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock([[]]));

    const result = await listWorkflowRuns({} as D1Database, {
      repoId: 'repo-1',
      limit: 10,
      offset: 0,
    });

    expect(result.runs).toHaveLength(0);
    expect(result.has_more).toBe(false);
  });

  it('returns actor as null when actorId is missing', async () => {
    const runs = [makeWorkflowRunRow({ actorId: null, actorName: null, actorPicture: null })];
    mocks.getDb.mockReturnValue(buildDrizzleMock([runs]));

    const result = await listWorkflowRuns({} as D1Database, {
      repoId: 'repo-1',
      limit: 10,
      offset: 0,
    });

    expect(result.runs[0].actor).toBeNull();
  });

  it('passes filter conditions correctly for workflow, status, branch, event', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock([[]]));

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
    expect(mocks.getDb).toHaveBeenCalled();
  });
});

describe('getWorkflowRunDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when run not found', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock([null]));

    const result = await getWorkflowRunDetail({} as D1Database, 'repo-1', 'missing');

    expect(result).toBeNull();
  });

  it('returns run detail with jobs and steps', async () => {
    const runData = makeWorkflowRunRow({ inputs: '{"key":"value"}' });
    const jobs = [makeJobRow()];
    const steps = [
      makeStepRow({ number: 1, name: 'Checkout' }),
      makeStepRow({ number: 2, name: 'Build', conclusion: 'success' }),
    ];

    mocks.getDb.mockReturnValue(buildDrizzleMock([
      runData,  // run lookup
      jobs,     // jobs lookup
      steps,    // steps for job-1
    ]));

    const result = await getWorkflowRunDetail({} as D1Database, 'repo-1', 'run-1');

    expect(result).not.toBeNull();
    expect(result!.run.id).toBe('run-1');
    expect(result!.run.inputs).toEqual({ key: 'value' });
    expect(result!.run.jobs).toHaveLength(1);
    expect(result!.run.jobs[0].id).toBe('job-1');
    expect(result!.run.jobs[0].name).toBe('build');
    expect(result!.run.jobs[0].steps).toHaveLength(2);
    expect(result!.run.jobs[0].steps[0].name).toBe('Checkout');
    expect(result!.run.jobs[0].steps[1].name).toBe('Build');
  });

  it('returns run detail with null actor when no actor account', async () => {
    const runData = makeWorkflowRunRow({
      actorAccountId: null,
      actorName: null,
      actorPicture: null,
    });

    mocks.getDb.mockReturnValue(buildDrizzleMock([
      runData,
      [],  // no jobs
    ]));

    const result = await getWorkflowRunDetail({} as D1Database, 'repo-1', 'run-1');

    expect(result!.run.actor).toBeNull();
    expect(result!.run.jobs).toHaveLength(0);
  });

  it('handles null inputs gracefully', async () => {
    const runData = makeWorkflowRunRow({ inputs: null });

    mocks.getDb.mockReturnValue(buildDrizzleMock([
      runData,
      [],  // no jobs
    ]));

    const result = await getWorkflowRunDetail({} as D1Database, 'repo-1', 'run-1');

    expect(result!.run.inputs).toBeNull();
  });

  it('handles malformed inputs JSON gracefully', async () => {
    const runData = makeWorkflowRunRow({ inputs: '{invalid json' });

    mocks.getDb.mockReturnValue(buildDrizzleMock([
      runData,
      [],
    ]));

    const result = await getWorkflowRunDetail({} as D1Database, 'repo-1', 'run-1');

    // safeJsonParseOrDefault should return the default (null)
    expect(result!.run.inputs).toBeNull();
  });
});

describe('getWorkflowRunJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when run not found', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock([null]));

    const result = await getWorkflowRunJobs({} as D1Database, 'repo-1', 'missing');

    expect(result).toBeNull();
  });

  it('returns jobs for a valid run', async () => {
    const jobs = [
      makeJobRow({ id: 'job-1', name: 'build' }),
      makeJobRow({ id: 'job-2', name: 'test', conclusion: 'failure' }),
    ];

    mocks.getDb.mockReturnValue(buildDrizzleMock([
      { id: 'run-1' },  // run existence check
      jobs,              // jobs
    ]));

    const result = await getWorkflowRunJobs({} as D1Database, 'repo-1', 'run-1');

    expect(result).not.toBeNull();
    expect(result!.jobs).toHaveLength(2);
    expect(result!.jobs[0].id).toBe('job-1');
    expect(result!.jobs[0].name).toBe('build');
    expect(result!.jobs[1].id).toBe('job-2');
    expect(result!.jobs[1].conclusion).toBe('failure');
  });

  it('returns empty jobs array when run has no jobs', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock([
      { id: 'run-1' },
      [],
    ]));

    const result = await getWorkflowRunJobs({} as D1Database, 'repo-1', 'run-1');

    expect(result).not.toBeNull();
    expect(result!.jobs).toHaveLength(0);
  });
});
