import type { D1Database } from '@cloudflare/workers-types';

import {
  generateShortcutId,
  isShortcutResourceType,
  ALLOWED_SHORTCUT_RESOURCE_TYPES,
} from '@/services/identity/shortcuts';

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------


import { assertEquals, assert, assertRejects, assertObjectMatch } from 'jsr:@std/assert';

  Deno.test('generateShortcutId - produces a non-empty string', () => {
  const id = generateShortcutId();
    assertEquals(typeof id, 'string');
    assert(id.length > 0);
})
  Deno.test('generateShortcutId - produces unique values', () => {
  const ids = new Set(Array.from({ length: 50 }, () => generateShortcutId()));
    assertEquals(ids.size, 50);
})

  Deno.test('isShortcutResourceType - returns true for all allowed types', () => {
  for (const type of ALLOWED_SHORTCUT_RESOURCE_TYPES) {
      assertEquals(isShortcutResourceType(type), true);
    }
})
  Deno.test('isShortcutResourceType - returns false for unknown types', () => {
  assertEquals(isShortcutResourceType('unknown'), false);
    assertEquals(isShortcutResourceType(''), false);
    assertEquals(isShortcutResourceType('Worker'), false);
})

  Deno.test('ALLOWED_SHORTCUT_RESOURCE_TYPES - contains service, resource, and link', () => {
  assertEquals(ALLOWED_SHORTCUT_RESOURCE_TYPES, ['service', 'resource', 'link']);
})
// ---------------------------------------------------------------------------
// DB-dependent tests with mocked Drizzle
// ---------------------------------------------------------------------------

function createMockDrizzleDb() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    returning: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import { listShortcuts, createShortcut, updateShortcut, deleteShortcut } from '@/services/identity/shortcuts';


  
    Deno.test('shortcuts service (Drizzle) - listShortcuts - returns empty array when no shortcuts exist', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.all = (async () => []) as any; // shortcuts
      const result = await listShortcuts({} as D1Database, 'user-1', 'space-1');
      assertEquals(result, []);
})
    Deno.test('shortcuts service (Drizzle) - listShortcuts - maps rows to API format with service join data', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.all
         = (async () => [
          {
            id: 'sc-1',
            userAccountId: 'user-1',
            accountId: 'space-1',
            resourceType: 'worker',
            resourceId: 'w-1',
            name: 'My Worker',
            icon: null,
            position: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ]) as any
         = (async () => [
          { id: 'w-1', hostname: 'my-worker.example.com', status: 'running' },
        ]) as any; // workers batch

      const result = await listShortcuts({} as D1Database, 'user-1', 'space-1');
      assertEquals(result.length, 1);
      assertObjectMatch(result[0], {
        id: 'sc-1',
        user_id: 'user-1',
        space_id: 'space-1',
        resource_type: 'service',
        resource_id: 'w-1',
        name: 'My Worker',
        service_hostname: 'my-worker.example.com',
        service_status: 'running',
      });
})  
  
    Deno.test('shortcuts service (Drizzle) - createShortcut - creates a shortcut and returns the API response', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'sc-new',
        userAccountId: 'user-1',
        accountId: 'space-1',
        resourceType: 'service',
        resourceId: 'w-1',
        name: 'Created',
        icon: null,
        position: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const result = await createShortcut({} as D1Database, 'user-1', 'space-1', {
        name: 'Created',
        resourceType: 'service',
        resourceId: 'w-1',
      });

      assertEquals(result.name, 'Created');
      assertEquals(result.resource_type, 'service');
})
    Deno.test('shortcuts service (Drizzle) - createShortcut - throws for invalid resource type', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  await await assertRejects(async () => { await 
        createShortcut({} as D1Database, 'user-1', 'space-1', {
          name: 'Bad',
          resourceType: 'invalid' as never,
          resourceId: 'x',
        }),
      ; }, 'Invalid shortcut resource type');
})  
  
    Deno.test('shortcuts service (Drizzle) - updateShortcut - returns false when no updates are provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const result = await updateShortcut({} as D1Database, 'user-1', 'space-1', 'sc-1', {});
      assertEquals(result, false);
})
    Deno.test('shortcuts service (Drizzle) - updateShortcut - returns true when name is updated', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const result = await updateShortcut({} as D1Database, 'user-1', 'space-1', 'sc-1', {
        name: 'New Name',
      });
      assertEquals(result, true);
})
    Deno.test('shortcuts service (Drizzle) - updateShortcut - returns true when position is updated', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const result = await updateShortcut({} as D1Database, 'user-1', 'space-1', 'sc-1', {
        position: 5,
      });
      assertEquals(result, true);
})  
  
    Deno.test('shortcuts service (Drizzle) - deleteShortcut - calls drizzle delete with the correct conditions', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  await deleteShortcut({} as D1Database, 'user-1', 'space-1', 'sc-1');
      assert(db.delete.calls.length > 0);
})  