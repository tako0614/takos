import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals, assert } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: (() => 'info-unit-1'),
  now: (() => '2026-03-24T00:00:00.000Z'),
  getRunEventsAfterFromR2: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
// [Deno] vi.mock removed - manually stub imports from '@/services/offload/run-events'
import { InfoUnitIndexer, createInfoUnitIndexer } from '@/services/source/info-units';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    returning: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    limit: (function(this: any) { return this; }),
    leftJoin: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, run: runMock },
  };
}


  Deno.test('createInfoUnitIndexer - returns null when DB is not provided', () => {
  const result = createInfoUnitIndexer({ DB: null } as any);
    assertEquals(result, null);
})
  Deno.test('createInfoUnitIndexer - returns indexer when DB is provided', () => {
  const result = createInfoUnitIndexer({ DB: {} } as any);
    assert(result instanceof InfoUnitIndexer);
})

  Deno.test('InfoUnitIndexer.indexRun - does nothing when run not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any; // run not found
    mocks.getDb = (() => drizzle) as any;

    const indexer = new InfoUnitIndexer({ DB: {} as D1Database } as any);
    await indexer.indexRun('ws-1', 'run-nonexistent');

    assertSpyCalls(drizzle.insert, 0);
})
  Deno.test('InfoUnitIndexer.indexRun - does nothing when run belongs to different space', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      id: 'run-1',
      accountId: 'ws-other',
      threadId: null,
      sessionId: null,
      status: 'completed',
      startedAt: null,
      completedAt: null,
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const indexer = new InfoUnitIndexer({ DB: {} as D1Database } as any);
    await indexer.indexRun('ws-1', 'run-1');

    assertSpyCalls(drizzle.insert, 0);
})
  Deno.test('InfoUnitIndexer.indexRun - skips when info unit already exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get
       = (async () => ({
        id: 'run-1',
        accountId: 'ws-1',
        threadId: 't1',
        sessionId: 's1',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T01:00:00.000Z',
      })) as any // run found
       = (async () => ({ id: 'existing-unit' })) as any; // already indexed
    mocks.getDb = (() => drizzle) as any;

    const indexer = new InfoUnitIndexer({ DB: {} as D1Database } as any);
    await indexer.indexRun('ws-1', 'run-1');

    // insert for info_units should not happen (only select calls)
    // The existing check means we skip indexing
    const insertCalls = drizzle.insert.calls;
    const infoUnitInserts = insertCalls.filter((call: any[]) => call.length > 0);
    // If already indexed, no new inserts should happen for info_units
    assertSpyCalls(drizzle._.get, 2);
})
  Deno.test('InfoUnitIndexer.indexRun - indexes run events from D1 when no offload bucket', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get
       = (async () => ({
        id: 'run-1',
        accountId: 'ws-1',
        threadId: 't1',
        sessionId: null,
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T01:00:00.000Z',
      })) as any // run found
       = (async () => undefined) as any // no existing info unit
       = (async () => undefined) as any // ensureNode (info_unit) - check existing
       = (async () => undefined) as any; // ensureNode (thread) - check existing
    drizzle._.all
       = (async () => [
        {
          id: 1,
          type: 'message',
          data: JSON.stringify({ content: 'Hello' }),
          createdAt: '2026-01-01T00:10:00.000Z',
        },
      ]) as any // run events
       = (async () => []) as any; // sessionRepos (empty since no sessionId)
    mocks.getDb = (() => drizzle) as any;

    const indexer = new InfoUnitIndexer({ DB: {} as D1Database } as any);
    await indexer.indexRun('ws-1', 'run-1');

    // Should have inserted info_unit + nodes + edges
    assert(drizzle.insert.calls.length > 0);
})