import type { D1Database } from '@cloudflare/workers-types';
import type { User } from '@/types';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import { getCachedUser, isValidUserId } from '@/utils/user-cache';

type TestContext = {
  get(key: 'user'): User | undefined;
  set(key: 'user', value: User): void;
  env: { DB: D1Database };
};

function createContext(initialUser?: User, db?: D1Database): TestContext {
  let cached = initialUser;
  return {
    get: () => cached,
    set: (_key, value) => {
      cached = value;
    },
    env: { DB: db ?? ({} as unknown as D1Database) },
  };
}

/**
 * Creates a mock Drizzle client that supports the chainable select().from().where().get() pattern.
 */
function createDrizzleMock(getResult: unknown = undefined) {
  const get = (async () => getResult);
  const all = (async () => []);
  const where = (() => ({ get, all }));
  const from = (() => ({ where, get, all }));
  const select = (() => ({ from }));
  return { select, from, where, get, all };
}


  Deno.test('user cache guards (issue 182) - rejects invalid user IDs before DB query', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const ctx = createContext();

    await assertEquals(await getCachedUser(ctx, '' as unknown as string), null);
    await assertEquals(await getCachedUser(ctx, 'x'.repeat(129)), null);
    await assertEquals(await getCachedUser(ctx, '\u0000abc'), null);

    assertSpyCalls(mocks.getDb, 0);
})
  Deno.test('user cache guards (issue 182) - returns cached user when context already has matching user', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const cachedUser: User = {
      id: 'user-1',
      email: 'cached@example.com',
      name: 'Cached',
      username: 'cached',
      bio: null,
      picture: null,
      trust_tier: 'normal',
      setup_completed: true,
      created_at: '2026-02-13T00:00:00.000Z',
      updated_at: '2026-02-13T00:00:00.000Z',
    };
    const ctx = createContext(cachedUser);

    const user = await getCachedUser(ctx, 'user-1');

    assertEquals(user, cachedUser);
    assertSpyCalls(mocks.getDb, 0);
})
  Deno.test('user cache guards (issue 182) - maps DB row and stores it in context cache', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const ctx = createContext();
    const drizzleMock = createDrizzleMock({
      id: 'user-2',
      trustTier: 'normal',
      email: 'user2@example.com',
      name: 'User2',
      slug: 'user2',
      type: 'user',
      bio: null,
      picture: null,
      setupCompleted: false,
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    });
    mocks.getDb = (() => drizzleMock) as any;

    const user = await getCachedUser(ctx, 'user-2');

    assertObjectMatch(user, {
      id: 'user-2',
      email: 'user2@example.com',
      username: 'user2',
      setup_completed: false,
    });
    assertObjectMatch(ctx.get('user'), { id: 'user-2' });
})
  Deno.test('user cache guards (issue 182) - normalizes user ID before DB lookup', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const ctx = createContext();
    const drizzleMock = createDrizzleMock({
      id: 'user-2',
      trustTier: 'normal',
      email: 'user2@example.com',
      name: 'User2',
      slug: 'user2',
      type: 'user',
      bio: null,
      picture: null,
      setupCompleted: false,
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    });
    mocks.getDb = (() => drizzleMock) as any;

    await assertObjectMatch(await getCachedUser(ctx, '  user-2  '), { id: 'user-2' });
})
  Deno.test('user cache guards (issue 182) - returns null when DB select returns null', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const ctx = createContext();
    const drizzleMock = createDrizzleMock(undefined);
    mocks.getDb = (() => drizzleMock) as any;

    await assertEquals(await getCachedUser(ctx, 'user-3'), null);
})
  Deno.test('user cache guards (issue 182) - validates user ID helper boundaries', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(isValidUserId('user-123'), true);
    assertEquals(isValidUserId(''), false);
    assertEquals(isValidUserId(' '.repeat(3)), false);
    assertEquals(isValidUserId('x'.repeat(129)), false);
    assertEquals(isValidUserId('ab\u0000cd'), false);
    assertEquals(isValidUserId('abc.def'), false);
})