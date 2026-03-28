import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  resolveActorPrincipalId: vi.fn(),
  isInvalidArrayBufferError: vi.fn(),
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

vi.mock('@/services/identity/principals', () => ({
  resolveActorPrincipalId: mocks.resolveActorPrincipalId,
}));

vi.mock('@/shared/utils/db-guards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils/db-guards')>();
  return {
    ...actual,
    isInvalidArrayBufferError: mocks.isInvalidArrayBufferError,
  };
});

vi.mock('@/shared/utils/logger', () => ({
  logError: mocks.logError,
  logWarn: mocks.logWarn,
  logInfo: vi.fn(),
}));

import {
  getRunHierarchyNode,
  getSpaceModel,
  getRunResponse,
  createPendingRun,
  updateRunStatus,
  checkRunRateLimits,
} from '@/services/runs/create-thread-run-store';

function buildDrizzleMock(options: {
  selectGet?: unknown;
  selectAll?: unknown[];
  insertRun?: unknown;
} = {}) {
  const runFn = vi.fn().mockResolvedValue(undefined);
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.get = vi.fn().mockResolvedValue(options.selectGet);
  chain.all = vi.fn().mockResolvedValue(options.selectAll ?? []);

  const insertChain: Record<string, unknown> = {};
  insertChain.values = vi.fn().mockReturnValue(insertChain);
  insertChain.returning = vi.fn().mockReturnValue(insertChain);
  insertChain.get = vi.fn().mockResolvedValue(options.insertRun);
  insertChain.run = runFn;

  const updateChain: Record<string, unknown> = {};
  updateChain.set = vi.fn().mockReturnValue(updateChain);
  updateChain.where = vi.fn().mockReturnValue(updateChain);
  updateChain.returning = vi.fn().mockReturnValue(updateChain);
  updateChain.run = runFn;

  return {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
    _runFn: runFn,
  };
}

function buildSequentialDrizzleMock(selectResults: unknown[]) {
  let selectIdx = 0;
  const runFn = vi.fn().mockResolvedValue(undefined);

  return {
    select: vi.fn().mockImplementation(() => {
      const result = selectResults[selectIdx++];
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn().mockReturnValue(chain);
      chain.where = vi.fn().mockReturnValue(chain);
      chain.orderBy = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      chain.get = vi.fn().mockResolvedValue(result);
      chain.all = vi.fn().mockResolvedValue(Array.isArray(result) ? result : []);
      return chain;
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        run: runFn,
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          run: runFn,
        }),
      }),
    }),
    _runFn: runFn,
  };
}

describe('getRunHierarchyNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInvalidArrayBufferError.mockReturnValue(false);
  });

  it('returns the hierarchy node when found', async () => {
    const row = {
      id: 'run-1',
      threadId: 'thread-1',
      accountId: 'space-1',
      parentRunId: null,
      rootThreadId: 'thread-1',
      rootRunId: 'run-1',
    };
    mocks.getDb.mockReturnValue(buildDrizzleMock({ selectGet: row }));

    const result = await getRunHierarchyNode({} as D1Database, 'run-1');

    expect(result).toEqual({
      id: 'run-1',
      threadId: 'thread-1',
      accountId: 'space-1',
      parentRunId: null,
      rootThreadId: 'thread-1',
      rootRunId: 'run-1',
    });
  });

  it('returns null when run not found', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock({ selectGet: undefined }));

    const result = await getRunHierarchyNode({} as D1Database, 'nonexistent');
    expect(result).toBeNull();
  });

  it('normalizes parentRunId null fallback', async () => {
    const row = {
      id: 'run-1',
      threadId: 'thread-1',
      accountId: 'space-1',
      parentRunId: undefined,
      rootThreadId: undefined,
      rootRunId: undefined,
    };
    mocks.getDb.mockReturnValue(buildDrizzleMock({ selectGet: row }));

    const result = await getRunHierarchyNode({} as D1Database, 'run-1');
    expect(result!.parentRunId).toBeNull();
    expect(result!.rootThreadId).toBeNull();
    expect(result!.rootRunId).toBeNull();
  });

  it('falls back to D1 raw query on InvalidArrayBuffer error', async () => {
    mocks.isInvalidArrayBufferError.mockReturnValue(true);
    const drizzle = buildDrizzleMock({});
    (drizzle.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Invalid array buffer length');
    });
    mocks.getDb.mockReturnValue(drizzle);

    const mockD1 = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({
            id: 'run-1',
            threadId: 'thread-1',
            accountId: 'space-1',
            parentRunId: null,
            rootThreadId: null,
            rootRunId: null,
          }),
        }),
      }),
    };

    const result = await getRunHierarchyNode(mockD1 as unknown as D1Database, 'run-1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('run-1');
  });
});

describe('getSpaceModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInvalidArrayBufferError.mockReturnValue(false);
  });

  it('returns aiModel when workspace found', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock({ selectGet: { aiModel: 'gpt-5.4-mini' } }));

    const result = await getSpaceModel({} as D1Database, 'space-1');

    expect(result).toEqual({ aiModel: 'gpt-5.4-mini' });
  });

  it('returns null when workspace not found', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock({ selectGet: undefined }));

    const result = await getSpaceModel({} as D1Database, 'missing');
    expect(result).toBeNull();
  });

  it('normalizes null aiModel', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock({ selectGet: { aiModel: undefined } }));

    const result = await getSpaceModel({} as D1Database, 'space-1');
    expect(result).toEqual({ aiModel: null });
  });
});

describe('getRunResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInvalidArrayBufferError.mockReturnValue(false);
  });

  it('returns a Run API object when found', async () => {
    const row = {
      id: 'run-1',
      threadId: 'thread-1',
      accountId: 'space-1',
      sessionId: null,
      parentRunId: null,
      childThreadId: null,
      rootThreadId: 'thread-1',
      rootRunId: 'run-1',
      agentType: 'default',
      status: 'completed',
      input: '{}',
      output: '{"result": true}',
      error: null,
      usage: '{}',
      workerId: null,
      workerHeartbeat: null,
      startedAt: '2026-03-01T00:00:00.000Z',
      completedAt: '2026-03-01T00:01:00.000Z',
      createdAt: '2026-03-01T00:00:00.000Z',
    };
    mocks.getDb.mockReturnValue(buildDrizzleMock({ selectGet: row }));

    const result = await getRunResponse({} as D1Database, 'run-1');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('run-1');
    expect(result!.thread_id).toBe('thread-1');
    expect(result!.space_id).toBe('space-1');
    expect(result!.status).toBe('completed');
    expect(result!.output).toBe('{"result": true}');
  });

  it('returns null when run not found', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock({ selectGet: undefined }));

    const result = await getRunResponse({} as D1Database, 'missing');
    expect(result).toBeNull();
  });
});

describe('createPendingRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInvalidArrayBufferError.mockReturnValue(false);
  });

  it('inserts a pending run via Drizzle', async () => {
    const drizzle = buildDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    await createPendingRun({} as D1Database, {
      runId: 'run-new',
      threadId: 'thread-1',
      spaceId: 'space-1',
      requesterAccountId: 'user-1',
      parentRunId: null,
      childThreadId: null,
      rootThreadId: 'thread-1',
      rootRunId: 'run-new',
      agentType: 'default',
      input: '{"message": "test"}',
      createdAt: '2026-03-01T00:00:00.000Z',
    });

    expect(drizzle.insert).toHaveBeenCalled();
  });

  it('inserts a child run with parentRunId and childThreadId', async () => {
    const drizzle = buildDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    await createPendingRun({} as D1Database, {
      runId: 'run-child',
      threadId: 'child-thread-1',
      spaceId: 'space-1',
      requesterAccountId: 'user-1',
      parentRunId: 'run-parent',
      childThreadId: 'child-thread-1',
      rootThreadId: 'thread-1',
      rootRunId: 'run-parent',
      agentType: 'implementer',
      input: '{}',
      createdAt: '2026-03-01T00:00:00.000Z',
    });

    expect(drizzle.insert).toHaveBeenCalled();
  });
});

describe('updateRunStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInvalidArrayBufferError.mockReturnValue(false);
  });

  it('updates a run status to queued', async () => {
    const drizzle = buildDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    await updateRunStatus({} as D1Database, {
      runId: 'run-1',
      status: 'queued',
      error: null,
    });

    expect(drizzle.update).toHaveBeenCalled();
  });

  it('updates a run status to failed with error', async () => {
    const drizzle = buildDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    await updateRunStatus({} as D1Database, {
      runId: 'run-1',
      status: 'failed',
      error: 'Something went wrong',
    });

    expect(drizzle.update).toHaveBeenCalled();
  });
});

describe('checkRunRateLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isInvalidArrayBufferError.mockReturnValue(false);
    mocks.resolveActorPrincipalId.mockResolvedValue(null);
  });

  it('allows a run when all limits are within bounds', async () => {
    const drizzle = buildSequentialDrizzleMock([
      [{ accountId: 'space-1' }],   // user workspaces
      { count: 0 },                  // minute count
      { count: 0 },                  // hour count
      { count: 0 },                  // concurrent count
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await checkRunRateLimits({} as D1Database, 'user-1', 'space-1');

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('rejects when per-minute limit is exceeded', async () => {
    const drizzle = buildSequentialDrizzleMock([
      [{ accountId: 'space-1' }],
      { count: 30 },  // at or above max
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await checkRunRateLimits({} as D1Database, 'user-1', 'space-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('max 30 runs per minute');
  });

  it('rejects when per-hour limit is exceeded', async () => {
    const drizzle = buildSequentialDrizzleMock([
      [{ accountId: 'space-1' }],
      { count: 5 },    // minute ok
      { count: 500 },  // at or above hourly max
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await checkRunRateLimits({} as D1Database, 'user-1', 'space-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('max 500 runs per hour');
  });

  it('rejects when concurrent limit is exceeded', async () => {
    const drizzle = buildSequentialDrizzleMock([
      [{ accountId: 'space-1' }],
      { count: 5 },    // minute ok
      { count: 50 },   // hour ok
      { count: 20 },   // at or above concurrent max
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await checkRunRateLimits({} as D1Database, 'user-1', 'space-1');

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('max 20');
    expect(result.reason).toContain('concurrent');
  });

  it('uses child run rate limits when isChildRun is true', async () => {
    const drizzle = buildSequentialDrizzleMock([
      [{ accountId: 'space-1' }],
      { count: 20 },  // at child per-minute max
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await checkRunRateLimits({} as D1Database, 'user-1', 'space-1', { isChildRun: true });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Child run rate limit');
    expect(result.reason).toContain('max 20 child runs per minute');
  });

  it('allows when user has no workspaces', async () => {
    const drizzle = buildSequentialDrizzleMock([
      [],  // no workspace memberships
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await checkRunRateLimits({} as D1Database, 'orphan-user', 'space-1');

    expect(result.allowed).toBe(true);
  });

  it('tries resolveActorPrincipalId when no workspaces found for direct actor', async () => {
    mocks.resolveActorPrincipalId.mockResolvedValue('principal-1');

    const drizzle = buildSequentialDrizzleMock([
      [],                            // first memberships query: empty
      [{ accountId: 'space-1' }],    // second memberships query with principal
      { count: 0 },                  // minute
      { count: 0 },                  // hour
      { count: 0 },                  // concurrent
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await checkRunRateLimits({} as D1Database, 'user-1', 'space-1');

    expect(result.allowed).toBe(true);
    expect(mocks.resolveActorPrincipalId).toHaveBeenCalledWith(expect.anything(), 'user-1');
  });

  it('falls back to D1 on InvalidArrayBuffer error', async () => {
    mocks.isInvalidArrayBufferError.mockReturnValue(true);
    const drizzle = buildDrizzleMock({});
    const selectMock = drizzle.select as ReturnType<typeof vi.fn>;
    selectMock.mockImplementation(() => {
      throw new Error('Invalid array buffer length');
    });
    mocks.getDb.mockReturnValue(drizzle);

    const mockD1 = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({ count: 0 }),
        }),
      }),
    };

    const result = await checkRunRateLimits(mockD1 as unknown as D1Database, 'user-1', 'space-1');

    expect(result.allowed).toBe(true);
  });
});
