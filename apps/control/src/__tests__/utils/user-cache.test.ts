import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import type { User } from '@/types';

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
  const get = vi.fn().mockResolvedValue(getResult);
  const all = vi.fn().mockResolvedValue([]);
  const where = vi.fn().mockReturnValue({ get, all });
  const from = vi.fn().mockReturnValue({ where, get, all });
  const select = vi.fn().mockReturnValue({ from });
  return { select, from, where, get, all };
}

describe('user cache guards (issue 182)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid user IDs before DB query', async () => {
    const ctx = createContext();

    await expect(getCachedUser(ctx, '' as unknown as string)).resolves.toBeNull();
    await expect(getCachedUser(ctx, 'x'.repeat(129))).resolves.toBeNull();
    await expect(getCachedUser(ctx, '\u0000abc')).resolves.toBeNull();

    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('returns cached user when context already has matching user', async () => {
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

    expect(user).toEqual(cachedUser);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it('maps DB row and stores it in context cache', async () => {
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
    mocks.getDb.mockReturnValue(drizzleMock);

    const user = await getCachedUser(ctx, 'user-2');

    expect(user).toMatchObject({
      id: 'user-2',
      email: 'user2@example.com',
      username: 'user2',
      setup_completed: false,
    });
    expect(ctx.get('user')).toMatchObject({ id: 'user-2' });
  });

  it('normalizes user ID before DB lookup', async () => {
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
    mocks.getDb.mockReturnValue(drizzleMock);

    await expect(getCachedUser(ctx, '  user-2  ')).resolves.toMatchObject({ id: 'user-2' });
  });

  it('returns null when DB select returns null', async () => {
    const ctx = createContext();
    const drizzleMock = createDrizzleMock(undefined);
    mocks.getDb.mockReturnValue(drizzleMock);

    await expect(getCachedUser(ctx, 'user-3')).resolves.toBeNull();
  });

  it('validates user ID helper boundaries', () => {
    expect(isValidUserId('user-123')).toBe(true);
    expect(isValidUserId('')).toBe(false);
    expect(isValidUserId(' '.repeat(3))).toBe(false);
    expect(isValidUserId('x'.repeat(129))).toBe(false);
    expect(isValidUserId('ab\u0000cd')).toBe(false);
    expect(isValidUserId('abc.def')).toBe(false);
  });
});
