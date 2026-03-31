import type { D1Database } from '@cloudflare/workers-types';

/**
 * Minimal mock for the Drizzle DB object returned by getDb().
 * Supports chained calls: select().from().where().get() and
 * insert().values().returning().get(), update().set().where().
 */
import { assertEquals } from 'jsr:@std/assert';

function createMockDrizzleDb() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    returning: (function(this: any) { return this; }),
    get: getMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    _: { get: getMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import { ensureUserSettings, getUserSettings, updateUserSettings } from '@/services/identity/user-settings';


  Deno.test('user-settings service (Drizzle) - getUserSettings returns null when row is not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

    const result = await getUserSettings({} as D1Database, 'user-1');
    assertEquals(result, null);
})
  Deno.test('user-settings service (Drizzle) - getUserSettings returns mapped settings when row exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
      accountId: 'user-1',
      setupCompleted: true,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    })) as any;

    const result = await getUserSettings({} as D1Database, 'user-1');
    assertEquals(result, {
      userId: 'user-1',
      setupCompleted: true,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      aiModel: null,
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    });
})
  Deno.test('user-settings service (Drizzle) - ensureUserSettings creates row when not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  // First select returns null (row not found)
    db._.get = (async () => null) as any;
    // Insert returns the new row
    db._.get = (async () => ({
      accountId: 'user-1',
      setupCompleted: false,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    })) as any;

    const result = await ensureUserSettings({} as D1Database, 'user-1');
    assertEquals(result, {
      userId: 'user-1',
      setupCompleted: false,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      aiModel: null,
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    });
})
  Deno.test('user-settings service (Drizzle) - updateUserSettings updates and returns refreshed settings', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  // ensureUserSettings: select finds existing row
    db._.get = (async () => ({
      accountId: 'user-1',
      setupCompleted: false,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    })) as any;
    // getUserSettings: select returns updated row
    db._.get = (async () => ({
      accountId: 'user-1',
      setupCompleted: true,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    })) as any;

    const result = await updateUserSettings({} as D1Database, 'user-1', { setup_completed: true });
    assertEquals(result, {
      userId: 'user-1',
      setupCompleted: true,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      aiModel: null,
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    });
})