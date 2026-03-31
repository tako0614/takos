import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals, assertNotEquals, assert, assertRejects } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  hashPassword: ((..._args: any[]) => undefined) as any,
  verifyPassword: ((..._args: any[]) => undefined) as any,
  now: ((..._args: any[]) => undefined) as any,
  base64UrlEncode: ((..._args: any[]) => undefined) as any,
  randomUUID: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/auth-utils'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
// Mock crypto.randomUUID and crypto.getRandomValues
const originalCrypto = globalThis.crypto;
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
  const runFn = (async () => undefined);
  const getFn = (async () => options.selectGet);
  const allFn = (async () => options.selectAll ?? []);

  const chain: Record<string, unknown> = {};
  chain.from = (() => chain);
  chain.where = (() => chain);
  chain.orderBy = (() => chain);
  chain.limit = (() => chain);
  chain.get = getFn;
  chain.all = allFn;

  const insertChain: Record<string, unknown> = {};
  insertChain.values = (() => insertChain);
  insertChain.returning = (() => insertChain);
  insertChain.get = (async () => options.insertValues);
  insertChain.run = runFn;

  const updateChain: Record<string, unknown> = {};
  updateChain.set = (() => updateChain);
  updateChain.where = (() => updateChain);
  updateChain.returning = (() => options.updateReturning ?? []);
  updateChain.run = runFn;

  return {
    select: (() => chain),
    insert: (() => insertChain),
    update: (() => updateChain),
  };
}


  Deno.test('generateThreadShareToken - returns a string token', () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  mocks.base64UrlEncode = (() => 'abcdefghijklmnopqrstuvwx') as any;
    const token = generateThreadShareToken();
    assertEquals(typeof token, 'string');
    assert(token.length > 0);
})

  Deno.test('createThreadShare - creates a public thread share', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.base64UrlEncode = (() => 'generated-token-abc') as any;
    mocks.randomUUID = (() => 'generated-uuid-1') as any;
  const shareRow = makeShareRow({ id: 'generated-uuid-1', token: 'generated-token-abc' });

    const drizzle = buildDrizzleMock({ selectGet: shareRow });
    mocks.getDb = (() => drizzle) as any;

    const result = await createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'public',
    });

    assertEquals(result.share.id, 'generated-uuid-1');
    assertEquals(result.share.thread_id, 'thread-1');
    assertEquals(result.share.space_id, 'space-1');
    assertEquals(result.share.mode, 'public');
    assertEquals(result.passwordRequired, false);
})
  Deno.test('createThreadShare - creates a password-protected share', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.base64UrlEncode = (() => 'generated-token-abc') as any;
    mocks.randomUUID = (() => 'generated-uuid-1') as any;
  mocks.hashPassword = (async () => 'hashed-pw') as any;
    const shareRow = makeShareRow({ id: 'generated-uuid-1', mode: 'password', passwordHash: 'hashed-pw' });

    const drizzle = buildDrizzleMock({ selectGet: shareRow });
    mocks.getDb = (() => drizzle) as any;

    const result = await createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'password',
      password: 'mypassword123',
    });

    assertEquals(result.share.mode, 'password');
    assertEquals(result.passwordRequired, true);
    assertSpyCallArgs(mocks.hashPassword, 0, ['mypassword123']);
})
  Deno.test('createThreadShare - throws when password mode has short password', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.base64UrlEncode = (() => 'generated-token-abc') as any;
    mocks.randomUUID = (() => 'generated-uuid-1') as any;
  await await assertRejects(async () => { await createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'password',
      password: 'short',
    }); }, 'Password is required (min 8 characters)');
})
  Deno.test('createThreadShare - throws when password mode has empty password', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.base64UrlEncode = (() => 'generated-token-abc') as any;
    mocks.randomUUID = (() => 'generated-uuid-1') as any;
  await await assertRejects(async () => { await createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'password',
      password: '',
    }); }, 'Password is required (min 8 characters)');
})
  Deno.test('createThreadShare - throws on invalid expiresAt', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.base64UrlEncode = (() => 'generated-token-abc') as any;
    mocks.randomUUID = (() => 'generated-uuid-1') as any;
  await await assertRejects(async () => { await createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'public',
      expiresAt: 'not-a-date',
    }); }, 'Invalid expires_at');
})
  Deno.test('createThreadShare - throws when expiresAt is in the past', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.base64UrlEncode = (() => 'generated-token-abc') as any;
    mocks.randomUUID = (() => 'generated-uuid-1') as any;
  await await assertRejects(async () => { await createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'public',
      expiresAt: '2020-01-01T00:00:00.000Z',
    }); }, 'expires_at must be in the future');
})
  Deno.test('createThreadShare - throws when select after insert returns null', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-01T00:00:00.000Z') as any;
    mocks.base64UrlEncode = (() => 'generated-token-abc') as any;
    mocks.randomUUID = (() => 'generated-uuid-1') as any;
  const drizzle = buildDrizzleMock({ selectGet: null });
    mocks.getDb = (() => drizzle) as any;

    await await assertRejects(async () => { await createThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      spaceId: 'space-1',
      createdBy: 'user-1',
      mode: 'public',
    }); }, 'Failed to create share');
})

  Deno.test('listThreadShares - returns mapped share records', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
  const rows = [
      makeShareRow({ id: 'share-1' }),
      makeShareRow({ id: 'share-2', mode: 'password' }),
    ];
    const drizzle = buildDrizzleMock({ selectAll: rows });
    mocks.getDb = (() => drizzle) as any;

    const result = await listThreadShares({} as D1Database, 'thread-1');

    assertEquals(result.length, 2);
    assertEquals(result[0].id, 'share-1');
    assertEquals(result[0].mode, 'public');
    assertEquals(result[1].id, 'share-2');
    assertEquals(result[1].mode, 'password');
})
  Deno.test('listThreadShares - returns empty array when no shares exist', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = buildDrizzleMock({ selectAll: [] });
    mocks.getDb = (() => drizzle) as any;

    const result = await listThreadShares({} as D1Database, 'thread-1');
    assertEquals(result, []);
})

  Deno.test('revokeThreadShare - returns true when revocation succeeds', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-02T00:00:00.000Z') as any;
  const drizzle = buildDrizzleMock({ updateReturning: [{ id: 'share-1' }] });
    mocks.getDb = (() => drizzle) as any;

    const result = await revokeThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      shareId: 'share-1',
    });

    assertEquals(result, true);
})
  Deno.test('revokeThreadShare - returns false when share is not found or already revoked', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-02T00:00:00.000Z') as any;
  const drizzle = buildDrizzleMock({ updateReturning: [] });
    mocks.getDb = (() => drizzle) as any;

    const result = await revokeThreadShare({
      db: {} as D1Database,
      threadId: 'thread-1',
      shareId: 'share-999',
    });

    assertEquals(result, false);
})

  Deno.test('getThreadShareByToken - returns share record with password_hash for valid token', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
  const row = makeShareRow({ passwordHash: 'some-hash' });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb = (() => drizzle) as any;

    const result = await getThreadShareByToken({} as D1Database, 'token-abc123');

    assertNotEquals(result, null);
    assertEquals(result!.id, 'share-1');
    assertEquals(result!.password_hash, 'some-hash');
})
  Deno.test('getThreadShareByToken - returns null when token not found', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = buildDrizzleMock({ selectGet: null });
    mocks.getDb = (() => drizzle) as any;

    const result = await getThreadShareByToken({} as D1Database, 'bad-token');
    assertEquals(result, null);
})
  Deno.test('getThreadShareByToken - returns null when share is revoked', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
  const row = makeShareRow({ revokedAt: '2026-03-01T12:00:00.000Z' });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb = (() => drizzle) as any;

    const result = await getThreadShareByToken({} as D1Database, 'token-abc123');
    assertEquals(result, null);
})
  Deno.test('getThreadShareByToken - returns null when share has expired', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
  const row = makeShareRow({ expiresAt: '2020-01-01T00:00:00.000Z' });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb = (() => drizzle) as any;

    const result = await getThreadShareByToken({} as D1Database, 'token-abc123');
    assertEquals(result, null);
})
  Deno.test('getThreadShareByToken - returns share when expiresAt is in the future', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
  const futureDate = new Date(Date.now() + 86_400_000).toISOString();
    const row = makeShareRow({ expiresAt: futureDate });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb = (() => drizzle) as any;

    const result = await getThreadShareByToken({} as D1Database, 'token-abc123');
    assertNotEquals(result, null);
})

  Deno.test('markThreadShareAccessed - updates lastAccessedAt on the share', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-05T00:00:00.000Z') as any;
  const drizzle = buildDrizzleMock();
    mocks.getDb = (() => drizzle) as any;

    await markThreadShareAccessed({} as D1Database, 'share-1');

    assert(drizzle.update.calls.length > 0);
})

  Deno.test('verifyThreadShareAccess - returns share data for valid public share', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-05T00:00:00.000Z') as any;
  const row = makeShareRow();
    // Two DB calls: getThreadShareByToken then markThreadShareAccessed
    let callIdx = 0;
    const drizzle = {
      select: () => {
        callIdx++;
        const chain: Record<string, unknown> = {};
        chain.from = (() => chain);
        chain.where = (() => chain);
        chain.get = (async () => callIdx === 1 ? row : null);
        return chain;
      },
      update: (() => ({
        set: (() => ({
          where: (() => ({
            run: (async () => undefined),
          })),
        })),
      })),
    };
    mocks.getDb = (() => drizzle) as any;

    const result = await verifyThreadShareAccess({
      db: {} as D1Database,
      token: 'token-abc123',
    });

    assertEquals('error' in result, false);
    if (!('error' in result)) {
      assertEquals(result.share.id, 'share-1');
      assertEquals(result.threadId, 'thread-1');
      assertEquals(result.spaceId, 'space-1');
    }
})
  Deno.test('verifyThreadShareAccess - returns not_found error for invalid token', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-05T00:00:00.000Z') as any;
  const drizzle = buildDrizzleMock({ selectGet: null });
    mocks.getDb = (() => drizzle) as any;

    const result = await verifyThreadShareAccess({
      db: {} as D1Database,
      token: 'bad-token',
    });

    assertEquals(result, { error: 'not_found' });
})
  Deno.test('verifyThreadShareAccess - returns password_required when password share has no password provided', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-05T00:00:00.000Z') as any;
  const row = makeShareRow({ mode: 'password', passwordHash: 'hashed-pw' });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb = (() => drizzle) as any;

    const result = await verifyThreadShareAccess({
      db: {} as D1Database,
      token: 'token-abc123',
    });

    assertEquals(result, { error: 'password_required' });
})
  Deno.test('verifyThreadShareAccess - returns forbidden when password is incorrect', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-05T00:00:00.000Z') as any;
  const row = makeShareRow({ mode: 'password', passwordHash: 'hashed-pw' });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb = (() => drizzle) as any;
    mocks.verifyPassword = (async () => false) as any;

    const result = await verifyThreadShareAccess({
      db: {} as D1Database,
      token: 'token-abc123',
      password: 'wrongpassword',
    });

    assertEquals(result, { error: 'forbidden' });
})
  Deno.test('verifyThreadShareAccess - returns forbidden when password_hash is null despite password mode', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-05T00:00:00.000Z') as any;
  const row = makeShareRow({ mode: 'password', passwordHash: null });
    const drizzle = buildDrizzleMock({ selectGet: row });
    mocks.getDb = (() => drizzle) as any;

    const result = await verifyThreadShareAccess({
      db: {} as D1Database,
      token: 'token-abc123',
      password: 'anypassword',
    });

    assertEquals(result, { error: 'forbidden' });
})
  Deno.test('verifyThreadShareAccess - succeeds with correct password on password-protected share', async () => {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      ...originalCrypto,
      randomUUID: mocks.randomUUID,
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i % 256;
        return arr;
      },
    },
    writable: true,
    configurable: true,
  });
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.now = (() => '2026-03-05T00:00:00.000Z') as any;
  const row = makeShareRow({ mode: 'password', passwordHash: 'hashed-pw' });
    let callIdx = 0;
    const drizzle = {
      select: () => {
        callIdx++;
        const chain: Record<string, unknown> = {};
        chain.from = (() => chain);
        chain.where = (() => chain);
        chain.get = (async () => callIdx === 1 ? row : null);
        return chain;
      },
      update: (() => ({
        set: (() => ({
          where: (() => ({
            run: (async () => undefined),
          })),
        })),
      })),
    };
    mocks.getDb = (() => drizzle) as any;
    mocks.verifyPassword = (async () => true) as any;

    const result = await verifyThreadShareAccess({
      db: {} as D1Database,
      token: 'token-abc123',
      password: 'correctpassword',
    });

    assertEquals('error' in result, false);
    if (!('error' in result)) {
      assertEquals(result.threadId, 'thread-1');
    }
})