import type { D1Database } from '@cloudflare/workers-types';

import { normalizeUserCode } from '@/services/oauth/device';

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------


import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';

  Deno.test('normalizeUserCode - uppercases and strips non-alphanumeric characters', () => {
  assertEquals(normalizeUserCode('abcd-efgh'), 'ABCDEFGH');
    assertEquals(normalizeUserCode('ABCD-EFGH'), 'ABCDEFGH');
})
  Deno.test('normalizeUserCode - handles lowercase input', () => {
  assertEquals(normalizeUserCode('abcdefgh'), 'ABCDEFGH');
})
  Deno.test('normalizeUserCode - strips spaces and dashes', () => {
  assertEquals(normalizeUserCode('AB CD EF GH'), 'ABCDEFGH');
    assertEquals(normalizeUserCode('AB-CD-EF-GH'), 'ABCDEFGH');
})
  Deno.test('normalizeUserCode - returns empty string for empty input', () => {
  assertEquals(normalizeUserCode(''), '');
})
  Deno.test('normalizeUserCode - handles null-ish values gracefully', () => {
  assertEquals(normalizeUserCode(null as unknown as string), '');
    assertEquals(normalizeUserCode(undefined as unknown as string), '');
})
  Deno.test('normalizeUserCode - strips special characters', () => {
  assertEquals(normalizeUserCode('AB!@#$%^&*()CD'), 'ABCD');
})
// ---------------------------------------------------------------------------
// DB-dependent tests
// ---------------------------------------------------------------------------

function createMockDrizzleDb() {
  const chain: any = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    get: (async (..._args: any[]) => undefined) as any,
    all: (async (..._args: any[]) => undefined) as any,
  };
  const control = {
    get get() {
      return chain.get;
    },
    set get(value: any) {
      chain.get = value;
    },
    get all() {
      return chain.all;
    },
    set all(value: any) {
      chain.all = value;
    },
    chain,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => ({
      set: () => ({
        where: (async () => ({ meta: { changes: 1 } })),
      }),
    }),
    delete: () => chain,
    _: control,
  };
}

const db = createMockDrizzleDb();
const d1 = db as unknown as D1Database;
(globalThis as typeof globalThis & { __takosDbMock?: unknown }).__takosDbMock = db as never;

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  createDeviceAuthorization,
  getDeviceAuthorizationByUserCode,
  getDeviceAuthorizationByDeviceCode,
  approveDeviceAuthorization,
  denyDeviceAuthorization,
  consumeApprovedDeviceAuthorization,
  pollDeviceAuthorization,
} from '@/services/oauth/device';
import { OAUTH_CONSTANTS } from '@/types/oauth';


  Deno.test('createDeviceAuthorization - returns device code, user code, and expiry info', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const result = await createDeviceAuthorization(d1, {
      clientId: 'client-1',
      scope: 'openid profile',
    });

    assert(result.deviceCode);
    assert(result.userCode);
    // User code should be formatted with dashes (e.g., ABCD-EFGH)
    assert(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(result.userCode));
    assertEquals(result.expiresIn, OAUTH_CONSTANTS.DEVICE_CODE_EXPIRES_IN);
    assertEquals(result.interval, OAUTH_CONSTANTS.DEVICE_POLL_INTERVAL_SECONDS);
    assert(result.id);
})
  Deno.test('createDeviceAuthorization - uses custom expiry and interval when provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const result = await createDeviceAuthorization(d1, {
      clientId: 'client-1',
      scope: 'openid',
      expiresInSeconds: 1800,
      intervalSeconds: 10,
    });

    assertEquals(result.expiresIn, 1800);
    assertEquals(result.interval, 10);
})

  Deno.test('getDeviceAuthorizationByUserCode - returns null for empty user code', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const result = await getDeviceAuthorizationByUserCode(d1, '');
    assertEquals(result, null);
})
  Deno.test('getDeviceAuthorizationByUserCode - returns null when not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;
    const result = await getDeviceAuthorizationByUserCode(d1, 'ABCD-EFGH');
    assertEquals(result, null);
})
  Deno.test('getDeviceAuthorizationByUserCode - returns mapped device code when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
      id: 'dc-1',
      deviceCodeHash: 'hash1',
      userCodeHash: 'hash2',
      clientId: 'client-1',
      scope: 'openid',
      status: 'pending',
      accountId: null,
      intervalSeconds: 5,
      lastPolledAt: null,
      approvedAt: null,
      deniedAt: null,
      usedAt: null,
      expiresAt: '2026-01-01T01:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })) as any;

    const result = await getDeviceAuthorizationByUserCode(d1, 'ABCDEFGH');
    assertNotEquals(result, null);
    assertEquals(result!.client_id, 'client-1');
    assertEquals(result!.status, 'pending');
})

  Deno.test('getDeviceAuthorizationByDeviceCode - returns null for empty device code', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const result = await getDeviceAuthorizationByDeviceCode(d1, '');
    assertEquals(result, null);
})
  Deno.test('getDeviceAuthorizationByDeviceCode - returns null when not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;
    const result = await getDeviceAuthorizationByDeviceCode(d1, 'some-code');
    assertEquals(result, null);
})

  Deno.test('approveDeviceAuthorization - returns true when successfully approved', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const result = await approveDeviceAuthorization(d1, {
      id: 'dc-1',
      userId: 'user-1',
    });
    assertEquals(result, true);
})

  Deno.test('denyDeviceAuthorization - returns true when successfully denied', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const result = await denyDeviceAuthorization(d1, {
      id: 'dc-1',
      userId: 'user-1',
    });
    assertEquals(result, true);
})

  Deno.test('pollDeviceAuthorization - returns not_found for empty device code', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const result = await pollDeviceAuthorization(d1, {
      deviceCode: '',
      clientId: 'client-1',
    });
    assertEquals(result.kind, 'not_found');
})
  Deno.test('pollDeviceAuthorization - returns not_found when device code not in database', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;
    const result = await pollDeviceAuthorization(d1, {
      deviceCode: 'nonexistent',
      clientId: 'client-1',
    });
    assertEquals(result.kind, 'not_found');
})
  Deno.test('pollDeviceAuthorization - returns client_mismatch when client IDs differ', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
      id: 'dc-1',
      deviceCodeHash: 'hash',
      userCodeHash: 'hash',
      clientId: 'client-1',
      scope: 'openid',
      status: 'pending',
      accountId: null,
      intervalSeconds: 5,
      lastPolledAt: null,
      approvedAt: null,
      deniedAt: null,
      usedAt: null,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })) as any;

    const result = await pollDeviceAuthorization(d1, {
      deviceCode: 'some-code',
      clientId: 'different-client',
    });
    assertEquals(result.kind, 'client_mismatch');
})
  Deno.test('pollDeviceAuthorization - returns expired when device code has expired', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
      id: 'dc-1',
      deviceCodeHash: 'hash',
      userCodeHash: 'hash',
      clientId: 'client-1',
      scope: 'openid',
      status: 'pending',
      accountId: null,
      intervalSeconds: 5,
      lastPolledAt: null,
      approvedAt: null,
      deniedAt: null,
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000).toISOString(), // expired
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })) as any;

    const result = await pollDeviceAuthorization(d1, {
      deviceCode: 'some-code',
      clientId: 'client-1',
    });
    assertEquals(result.kind, 'expired');
})

  Deno.test('consumeApprovedDeviceAuthorization - returns true when successfully consumed', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const result = await consumeApprovedDeviceAuthorization(d1, 'dc-1');
    assertEquals(result, true);
})
