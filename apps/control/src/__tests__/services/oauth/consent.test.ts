import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert';

function createMockDrizzleDb() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => ({
      set: () => ({
        where: (async () => ({ meta: { changes: 1 } })),
      }),
    }),
    _: { get: getMock, all: allMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  revokeAllUserClientTokens: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/oauth/token'
import {
  getConsent,
  hasFullConsent,
  getNewScopes,
  grantConsent,
  getUserConsents,
} from '@/services/oauth/consent';


  
    Deno.test('consent service - getConsent - returns mapped consent when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid","profile"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const consent = await getConsent({} as D1Database, 'user-1', 'client-1');

      assertNotEquals(consent, null);
      assertEquals(consent!.user_id, 'user-1');
      assertEquals(consent!.client_id, 'client-1');
      assertEquals(consent!.scopes, '["openid","profile"]');
      assertEquals(consent!.status, 'active');
})
    Deno.test('consent service - getConsent - returns null when no consent exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

      const consent = await getConsent({} as D1Database, 'user-1', 'client-1');
      assertEquals(consent, null);
})  
  
    Deno.test('consent service - hasFullConsent - returns true when all requested scopes are granted', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid","profile","email"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const result = await hasFullConsent({} as D1Database, 'user-1', 'client-1', ['openid', 'profile']);
      assertEquals(result, true);
})
    Deno.test('consent service - hasFullConsent - returns false when some scopes are not granted', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const result = await hasFullConsent({} as D1Database, 'user-1', 'client-1', ['openid', 'profile']);
      assertEquals(result, false);
})
    Deno.test('consent service - hasFullConsent - returns false when no consent exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

      const result = await hasFullConsent({} as D1Database, 'user-1', 'client-1', ['openid']);
      assertEquals(result, false);
})  
  
    Deno.test('consent service - getNewScopes - returns only scopes not yet granted', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const result = await getNewScopes({} as D1Database, 'user-1', 'client-1', ['openid', 'profile', 'email']);
      assertEquals(result, ['profile', 'email']);
})
    Deno.test('consent service - getNewScopes - returns all requested scopes when no consent exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

      const result = await getNewScopes({} as D1Database, 'user-1', 'client-1', ['openid', 'profile']);
      assertEquals(result, ['openid', 'profile']);
})
    Deno.test('consent service - getNewScopes - returns empty array when all scopes are already granted', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid","profile"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const result = await getNewScopes({} as D1Database, 'user-1', 'client-1', ['openid', 'profile']);
      assertEquals(result, []);
})  
  
    Deno.test('consent service - grantConsent - creates new consent when none exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any; // getConsent returns null

      const consent = await grantConsent({} as D1Database, 'user-1', 'client-1', ['openid', 'profile']);

      assertEquals(consent.user_id, 'user-1');
      assertEquals(consent.client_id, 'client-1');
      assertEquals(consent.status, 'active');
      assertEquals(JSON.parse(consent.scopes), ['openid', 'profile']);
})
    Deno.test('consent service - grantConsent - merges scopes when consent already exists', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  // getConsent finds existing
      db._.get = (async () => ({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const consent = await grantConsent({} as D1Database, 'user-1', 'client-1', ['profile', 'email']);

      // Should merge existing [openid] with new [profile, email]
      const mergedScopes = JSON.parse(consent.scopes);
      assertStringIncludes(mergedScopes, 'openid');
      assertStringIncludes(mergedScopes, 'profile');
      assertStringIncludes(mergedScopes, 'email');
})
    Deno.test('consent service - grantConsent - deduplicates scopes when merging', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
        id: 'consent-1',
        accountId: 'user-1',
        clientId: 'client-1',
        scopes: '["openid","profile"]',
        status: 'active',
        grantedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })) as any;

      const consent = await grantConsent({} as D1Database, 'user-1', 'client-1', ['openid', 'email']);

      const mergedScopes = JSON.parse(consent.scopes);
      // No duplicates
      const uniqueScopes = [...new Set(mergedScopes)];
      assertEquals(mergedScopes.length, uniqueScopes.length);
})  
  
    Deno.test('consent service - getUserConsents - returns mapped consent list', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.all = (async () => [
        {
          id: 'consent-1',
          accountId: 'user-1',
          clientId: 'client-1',
          scopes: '["openid"]',
          status: 'active',
          grantedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'consent-2',
          accountId: 'user-1',
          clientId: 'client-2',
          scopes: '["openid","profile"]',
          status: 'active',
          grantedAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ]) as any;

      const consents = await getUserConsents({} as D1Database, 'user-1');
      assertEquals(consents.length, 2);
      assertEquals(consents[0]!.client_id, 'client-1');
      assertEquals(consents[1]!.client_id, 'client-2');
})
    Deno.test('consent service - getUserConsents - returns empty array when no consents exist', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.all = (async () => []) as any;

      const consents = await getUserConsents({} as D1Database, 'user-1');
      assertEquals(consents, []);
})  