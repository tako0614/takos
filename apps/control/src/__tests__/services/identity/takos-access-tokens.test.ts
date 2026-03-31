import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals, assertNotEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

function createMockDrizzleDb() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    get: getMock,
    run: runMock,
  };
  return {
    select: () => chain,
    update: () => chain,
    _: { get: getMock, run: runMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  issueTakosAccessToken,
  validateTakosAccessToken,
  validateTakosPersonalAccessToken,
} from '@/services/identity/takos-access-tokens';


  Deno.test('issueTakosAccessToken - generates a token with tak_pat_ prefix', async () => {
  const { token, tokenHash, tokenPrefix } = await issueTakosAccessToken();

    assert(/^tak_pat_/.test(token));
    assert(/^[a-f0-9]{64}$/.test(tokenHash));
    assertEquals(tokenPrefix, token.slice(0, 12));
    assertEquals(tokenPrefix.length, 12);
})
  Deno.test('issueTakosAccessToken - produces unique tokens on successive calls', async () => {
  const a = await issueTakosAccessToken();
    const b = await issueTakosAccessToken();
    assertNotEquals(a.token, b.token);
    assertNotEquals(a.tokenHash, b.tokenHash);
})

  Deno.test('validateTakosAccessToken - returns managed_builtin validation when managed token matches', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  // First call: managed token lookup
    db._.get = (async () => ({
      id: 'tok-1',
      subjectAccountId: 'user-1',
      scopesJson: '["spaces:read", "files:read"]',
    })) as any;

    const result = await validateTakosAccessToken({} as D1Database, 'some-token');

    assertEquals(result, {
      userId: 'user-1',
      scopes: ['spaces:read', 'files:read'],
      tokenKind: 'managed_builtin',
    });
})
  Deno.test('validateTakosAccessToken - falls through to personal token validation when managed returns null', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  // Managed token lookup returns null
    db._.get = (async () => null) as any;
    // Personal token lookup returns a match
    db._.get = (async () => ({
      id: 'pat-1',
      accountId: 'user-2',
      scopes: '["openid"]',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    })) as any;

    const result = await validateTakosAccessToken({} as D1Database, 'some-token');

    assertEquals(result, {
      userId: 'user-2',
      scopes: ['openid'],
      tokenKind: 'personal',
    });
})
  Deno.test('validateTakosAccessToken - returns null when neither managed nor personal token matches', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;
    db._.get = (async () => null) as any;

    const result = await validateTakosAccessToken({} as D1Database, 'nonexistent');
    assertEquals(result, null);
})
  Deno.test('validateTakosAccessToken - returns null when managed token has missing required scopes', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  // Managed token found but scopes don't match
    db._.get = (async () => ({
      id: 'tok-1',
      subjectAccountId: 'user-1',
      scopesJson: '["spaces:read"]',
    })) as any;
    // Personal token lookup also returns null
    db._.get = (async () => null) as any;

    const result = await validateTakosAccessToken({} as D1Database, 'some-token', ['spaces:write']);
    assertEquals(result, null);
})
  Deno.test('validateTakosAccessToken - returns null when personal token is expired', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any; // managed not found
    db._.get = (async () => ({
      id: 'pat-1',
      accountId: 'user-1',
      scopes: '["openid"]',
      expiresAt: new Date(Date.now() - 3600_000).toISOString(), // expired
    })) as any;

    const result = await validateTakosAccessToken({} as D1Database, 'some-token');
    assertEquals(result, null);
})
  Deno.test('validateTakosAccessToken - returns all scopes when scopesJson is "*"', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
      id: 'tok-1',
      subjectAccountId: 'user-1',
      scopesJson: '*',
    })) as any;

    const result = await validateTakosAccessToken({} as D1Database, 'some-token');
    assertNotEquals(result, null);
    assertEquals(result!.tokenKind, 'managed_builtin');
    // Should contain all scopes from ALL_SCOPES
    assert(result!.scopes.length > 0);
    assertStringIncludes(result!.scopes, 'openid');
    assertStringIncludes(result!.scopes, 'spaces:read');
})
  Deno.test('validateTakosAccessToken - returns null when scopesJson is invalid JSON', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
      id: 'tok-1',
      subjectAccountId: 'user-1',
      scopesJson: 'not-json',
    })) as any;
    // Falls through to personal
    db._.get = (async () => null) as any;

    const result = await validateTakosAccessToken({} as D1Database, 'some-token');
    assertEquals(result, null);
})

  Deno.test('validateTakosPersonalAccessToken - validates only personal tokens (not managed)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
      id: 'pat-1',
      accountId: 'user-1',
      scopes: '["openid"]',
      expiresAt: null, // no expiry
    })) as any;

    const result = await validateTakosPersonalAccessToken({} as D1Database, 'some-token');

    assertEquals(result, {
      userId: 'user-1',
      scopes: ['openid'],
      tokenKind: 'personal',
    });
})
  Deno.test('validateTakosPersonalAccessToken - returns null when personal token not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

    const result = await validateTakosPersonalAccessToken({} as D1Database, 'nonexistent');
    assertEquals(result, null);
})