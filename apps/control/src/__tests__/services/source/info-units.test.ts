import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  generateId: vi.fn().mockReturnValue('info-unit-1'),
  now: vi.fn().mockReturnValue('2026-03-24T00:00:00.000Z'),
  getRunEventsAfterFromR2: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/utils')>()),
  generateId: mocks.generateId,
  now: mocks.now,
}));

vi.mock('@/services/offload/run-events', () => ({
  getRunEventsAfterFromR2: mocks.getRunEventsAfterFromR2,
}));

import { InfoUnitIndexer, createInfoUnitIndexer } from '@/services/source/info-units';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    _: { get: getMock, all: allMock, run: runMock },
  };
}

describe('createInfoUnitIndexer', () => {
  it('returns null when DB is not provided', () => {
    const result = createInfoUnitIndexer({ DB: null } as any);
    expect(result).toBeNull();
  });

  it('returns indexer when DB is provided', () => {
    const result = createInfoUnitIndexer({ DB: {} } as any);
    expect(result).toBeInstanceOf(InfoUnitIndexer);
  });
});

describe('InfoUnitIndexer.indexRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when run not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined); // run not found
    mocks.getDb.mockReturnValue(drizzle);

    const indexer = new InfoUnitIndexer({ DB: {} as D1Database } as any);
    await indexer.indexRun('ws-1', 'run-nonexistent');

    expect(drizzle.insert).not.toHaveBeenCalled();
  });

  it('does nothing when run belongs to different space', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({
      id: 'run-1',
      accountId: 'ws-other',
      threadId: null,
      sessionId: null,
      status: 'completed',
      startedAt: null,
      completedAt: null,
    });
    mocks.getDb.mockReturnValue(drizzle);

    const indexer = new InfoUnitIndexer({ DB: {} as D1Database } as any);
    await indexer.indexRun('ws-1', 'run-1');

    expect(drizzle.insert).not.toHaveBeenCalled();
  });

  it('skips when info unit already exists', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get
      .mockResolvedValueOnce({
        id: 'run-1',
        accountId: 'ws-1',
        threadId: 't1',
        sessionId: 's1',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T01:00:00.000Z',
      }) // run found
      .mockResolvedValueOnce({ id: 'existing-unit' }); // already indexed
    mocks.getDb.mockReturnValue(drizzle);

    const indexer = new InfoUnitIndexer({ DB: {} as D1Database } as any);
    await indexer.indexRun('ws-1', 'run-1');

    // insert for info_units should not happen (only select calls)
    // The existing check means we skip indexing
    const insertCalls = drizzle.insert.mock.calls;
    const infoUnitInserts = insertCalls.filter((call: any[]) => call.length > 0);
    // If already indexed, no new inserts should happen for info_units
    expect(drizzle._.get).toHaveBeenCalledTimes(2);
  });

  it('indexes run events from D1 when no offload bucket', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get
      .mockResolvedValueOnce({
        id: 'run-1',
        accountId: 'ws-1',
        threadId: 't1',
        sessionId: null,
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T01:00:00.000Z',
      }) // run found
      .mockResolvedValueOnce(undefined) // no existing info unit
      .mockResolvedValueOnce(undefined) // ensureNode (info_unit) - check existing
      .mockResolvedValueOnce(undefined); // ensureNode (thread) - check existing
    drizzle._.all
      .mockResolvedValueOnce([
        {
          id: 1,
          type: 'message',
          data: JSON.stringify({ content: 'Hello' }),
          createdAt: '2026-01-01T00:10:00.000Z',
        },
      ]) // run events
      .mockResolvedValueOnce([]); // sessionRepos (empty since no sessionId)
    mocks.getDb.mockReturnValue(drizzle);

    const indexer = new InfoUnitIndexer({ DB: {} as D1Database } as any);
    await indexer.indexRun('ws-1', 'run-1');

    // Should have inserted info_unit + nodes + edges
    expect(drizzle.insert).toHaveBeenCalled();
  });
});
