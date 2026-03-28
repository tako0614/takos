import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  now: vi.fn(),
  base64UrlEncode: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

vi.mock('@/services/identity/auth-utils', () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}));

vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils')>();
  return {
    ...actual,
    now: mocks.now,
    base64UrlEncode: mocks.base64UrlEncode,
  };
});

// Mock crypto.randomUUID and crypto.getRandomValues
const originalCrypto = globalThis.crypto;
beforeEach(() => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: vi.fn((arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      }),
    },
    writable: true,
    configurable: true,
  });
});

import {
  createThreadShare,
  listThreadShares,
  revokeThreadShare,
  getThreadShareByToken,
  markThreadShareAccessed,
  verifyThreadShareAccess,
  generateThreadShareToken,
} from '@/services/threads/thread-shares';

type DbRow = Record<string, unknown>;

function makeShareRow(overrides: Partial<DbRow> = {}): DbRow {
  return {
    id: 'share-1',
    threadId: 'thread-1',
    accountId: 'space-1',
    createdByAccountId: 'user-1',
    token: 'token-abc123',
    mode: 'public',
    passwordHash: null,
    expiresAt: null,
    revokedAt: null,
    lastAccessedAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildDrizzleMock(options: {
  insertValues?: unknown;
  selectGet?: unknown;
  selectAll?: unknown[];
  updateReturning?: unknown[];
} = {}) {
  const runFn = vi.fn().mockResolvedValue(undefined);
  const getFn = vi.fn().mockResolvedValue(options.selectGet);
  const allFn = vi.fn().mockResolvedValue(options.selectAll ?? []);

  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.get = getFn;
  chain.all = allFn;

  const insertChain: Record<string, unknown> = {};
  insertChain.values = vi.fn().mockReturnValue(insertChain);
  insertChain.returning = vi.fn().mockReturnValue(insertChain);
  insertChain.get = vi.fn().mockResolvedValue(options.insertValues);
  insertChain.run = runFn;

  const updateChain: Record<string, unknown> = {};
  updateChain.set = vi.fn().mockReturnValue(updateChain);
  updateChain.where = vi.fn().mockReturnValue(updateChain);
  updateChain.returning = vi.fn().mockReturnValue(options.updateReturning ?? []);
  updateChain.run = runFn;

  return {
    select: vi.fn().mockReturnValue(chain),
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
  };
}

describe('generateThreadShareToken', () => {
  it('returns a string token', () => {
    mocks.base64UrlEncode.mockReturnValue('abcdefghijklmnopqrstuvwx');
    const token = generateThreadShareToken();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });
});

describe('createThreadShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.now.mockReturnValue('2026-03-01T00:00:00.000Z');
    mocks.base64UrlEncode.mockReturnValue('generated-token-abc');
    mocks.randomUUID.mockReturnValue('generated-uuid-1');
  });

  it('creates a public thread share', async () => {
    const shareRow = makeShareRow({ id: 'generated-uuid-1', token: 'generated-token-abc' });

    const drizzle = buildDrizzleMock({ selectGet: shareRow });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'public',
    });

    expect(result.share.id).toBe('generated-uuid-1');
    expect(result.share.thread_id).toBe('thread-1');
    expect(result.share.space_id).toBe('space-1');
    expect(result.share.mode).toBe('public');
    expect(result.passwordRequired).toBe(false);
  });

  it('creates a password-protected share', async () => {
    mocks.hashPassword.mockResolvedValue('hashed-pw');
    const shareRow = makeShareRow({ id: 'generated-uuid-1', mode: 'password', passwordHash: 'hashed-pw' });

    const drizzle = buildDrizzleMock({ selectGet: shareRow });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'password',
      password: 'mypassword123',
    });

    expect(result.share.mode).toBe('password');
    expect(result.passwordRequired).toBe(true);
    expect(mocks.hashPassword).toHaveBeenCalledWith('mypassword123');
  });

  it('throws when password mode has short password', async () => {
    await expect(createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'password',
      password: 'short',
    })).rejects.toThrow('Password is required (min 8 characters)');
  });

  it('throws when password mode has empty password', async () => {
    await expect(createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'password',
      password: '',
    })).rejects.toThrow('Password is required (min 8 characters)');
  });

  it('throws on invalid expiresAt', async () => {
    await expect(createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'public',
      expiresAt: 'not-a-date',
    })).rejects.toThrow('Invalid expires_at');
  });

  it('throws when expiresAt is in the past', async () => {
    await expect(createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'public',
      expiresAt: '2020-01-01T00:00:00.000Z',
    })).rejects.toThrow('expires_at must be in the future');
  });

  it('throws when select after insert returns null', async () => {
    const drizzle = buildDrizzleMock({ selectGet: null });
    mocks.getDb.mockReturnValue(drizzle);

    await expect(createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'public',
    })).rejects.toThrow('Failed to create share');
  });
});

describe('listThreadShares', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns mapped share records', async () => {
    const rows = [
      makeShareRow({ id: 'share-1' }),
      makeShareRow({ id: 'share-2', mode: 'password' }),
    ];
    const drizzle = buildDrizzleMock({ selectAll: rows });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listThreadShares({} as D1Database, 'thread-1');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('share-1');
    expect(result[0].mode).toBe('public');
    expect(result[1].id).toBe('share-2');
    expect(result[1].mode).toBe('password');
  });

  it('returns empty array when no shares exist', async () => {
    const drizzle = buildDrizzleMock({ selectAll: [] });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listThreadShares({} as D1Database, 'thread-1');
    expect(result).toEqual([]);
  });
});

describe('revokeThreadShare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.now.mockReturnValue('2026-03-02T00:00:00.000Z');
  });

  it('returns true when revocation succeeds', async () => {
    const drizzle = buildDrizzleMock({ updateReturning: [{ id: 'share-1' }] });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await revokeThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      shareId: 'share-1',
    });

    expect(result).toBe(true);
  });

  it('returns false when share is not found or already revoked', async () => {
    const drizzle = buildDrizzleMock({ updateReturning: [] });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await revokeThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      shareId: 'share-999',
    });

    expect(result).toBe(false);
  });
});

describe('getThreadShareByToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns share record with password_hash for valid token', async () => {
    const row = makeShareRow({ passwordHash: 'some-hash' });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getThreadShareByToken({} as D1Database, 'token-abc123');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('share-1');
    expect(result!.password_hash).toBe('some-hash');
  });

  it('returns null when token not found', async () => {
    const drizzle = buildDrizzleMock({ selectGet: null });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getThreadShareByToken({} as D1Database, 'bad-token');
    expect(result).toBeNull();
  });

  it('returns null when share is revoked', async () => {
    const row = makeShareRow({ revokedAt: '2026-03-01T12:00:00.000Z' });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getThreadShareByToken({} as D1Database, 'token-abc123');
    expect(result).toBeNull();
  });

  it('returns null when share has expired', async () => {
    const row = makeShareRow({ expiresAt: '2020-01-01T00:00:00.000Z' });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getThreadShareByToken({} as D1Database, 'token-abc123');
    expect(result).toBeNull();
  });

  it('returns share when expiresAt is in the future', async () => {
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();
    const row = makeShareRow({ expiresAt: futureDate });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getThreadShareByToken({} as D1Database, 'token-abc123');
    expect(result).not.toBeNull();
  });
});

describe('markThreadShareAccessed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.now.mockReturnValue('2026-03-05T00:00:00.000Z');
  });

  it('updates lastAccessedAt on the share', async () => {
    const drizzle = buildDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    await markThreadShareAccessed({} as D1Database, 'share-1');

    expect(drizzle.update).toHaveBeenCalled();
  });
});

describe('verifyThreadShareAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.now.mockReturnValue('2026-03-05T00:00:00.000Z');
  });

  it('returns share data for valid public share', async () => {
    const row = makeShareRow();
    // Two DB calls: getThreadShareByToken then markThreadShareAccessed
    let callIdx = 0;
    const drizzle = {
      select: vi.fn().mockImplementation(() => {
        callIdx++;
        const chain: Record<string, unknown> = {};
        chain.from = vi.fn().mockReturnValue(chain);
        chain.where = vi.fn().mockReturnValue(chain);
        chain.get = vi.fn().mockResolvedValue(callIdx === 1 ? row : null);
        return chain;
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      }),
    };
    mocks.getDb.mockReturnValue(drizzle);

    const result = await verifyThreadShareAccess({
      db: {} as D1Database,
      token: 'token-abc123',
    });

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.share.id).toBe('share-1');
      expect(result.threadId).toBe('thread-1');
      expect(result.spaceId).toBe('space-1');
    }
  });

  it('returns not_found error for invalid token', async () => {
    const drizzle = buildDrizzleMock({ selectGet: null });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await verifyThreadShareAccess({
      db: {} as D1Database,
      token: 'bad-token',
    });

    expect(result).toEqual({ error: 'not_found' });
  });

  it('returns password_required when password share has no password provided', async () => {
    const row = makeShareRow({ mode: 'password', passwordHash: 'hashed-pw' });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await verifyThreadShareAccess({
      db: {} as D1Database,
      token: 'token-abc123',
    });

    expect(result).toEqual({ error: 'password_required' });
  });

  it('returns forbidden when password is incorrect', async () => {
    const row = makeShareRow({ mode: 'password', passwordHash: 'hashed-pw' });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb.mockReturnValue(drizzle);
    mocks.verifyPassword.mockResolvedValue(false);

    const result = await verifyThreadShareAccess({
      db: {} as D1Database,
      token: 'token-abc123',
      password: 'wrongpassword',
    });

    expect(result).toEqual({ error: 'forbidden' });
  });

  it('returns forbidden when password_hash is null despite password mode', async () => {
    const row = makeShareRow({ mode: 'password', passwordHash: null });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await verifyThreadShareAccess({
      db: {} as D1Database,
      token: 'token-abc123',
      password: 'anypassword',
    });

    expect(result).toEqual({ error: 'forbidden' });
  });

  it('succeeds with correct password on password-protected share', async () => {
    const row = makeShareRow({ mode: 'password', passwordHash: 'hashed-pw' });
    let callIdx = 0;
    const drizzle = {
      select: vi.fn().mockImplementation(() => {
        callIdx++;
        const chain: Record<string, unknown> = {};
        chain.from = vi.fn().mockReturnValue(chain);
        chain.where = vi.fn().mockReturnValue(chain);
        chain.get = vi.fn().mockResolvedValue(callIdx === 1 ? row : null);
        return chain;
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue(undefined),
          }),
        }),
      }),
    };
    mocks.getDb.mockReturnValue(drizzle);
    mocks.verifyPassword.mockResolvedValue(true);

    const result = await verifyThreadShareAccess({
      db: {} as D1Database,
      token: 'token-abc123',
      password: 'correctpassword',
    });

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.threadId).toBe('thread-1');
    }
  });
});
