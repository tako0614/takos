import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = {
  const drizzleInstances: unknown[] = [];
  const mockDrizzle = (db: unknown, _opts?: unknown) => {
    const instance = { _d1: db };
    drizzleInstances.push(instance);
    return instance;
  };
  return { drizzleInstances, mockDrizzle };
};

// [Deno] vi.mock removed - manually stub imports from 'drizzle-orm/d1'

  Deno.test('getDb - caches the client for the same D1 binding via WeakMap', async () => {
  /* modules reset (no-op in Deno) */ void 0;
    mocks.drizzleInstances.length = 0;
    mocks.mockDrizzle;
  const { getDb } = await import('@/db/index');
    const db = { name: 'test' } as unknown as D1Database;

    const first = getDb(db);
    const second = getDb(db);

    assertEquals(first, second);
    assertEquals(mocks.drizzleInstances.length, 1);
    assertSpyCalls(mocks.mockDrizzle, 1);
})
  Deno.test('getDb - passes the provided D1 binding into drizzle', async () => {
  /* modules reset (no-op in Deno) */ void 0;
    mocks.drizzleInstances.length = 0;
    mocks.mockDrizzle;
  const { getDb } = await import('@/db/index');
    const db = { id: 'db-1' } as unknown as D1Database;

    getDb(db);

    assertSpyCallArgs(mocks.mockDrizzle, 0, [db, ({ schema: expect.anything() })]);
})