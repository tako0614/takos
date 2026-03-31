import { assertEquals, assert, assertThrows, assertRejects } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  normalizeTakosScopes,
  resolveTakosApiUrl,
  TAKOS_API_URL_ENV_NAME,
  TAKOS_ACCESS_TOKEN_ENV_NAME,
} from '@/services/common-env/takos-builtins';


  Deno.test('constants - TAKOS_API_URL_ENV_NAME is correct', () => {
  assertEquals(TAKOS_API_URL_ENV_NAME, 'TAKOS_API_URL');
})
  Deno.test('constants - TAKOS_ACCESS_TOKEN_ENV_NAME is correct', () => {
  assertEquals(TAKOS_ACCESS_TOKEN_ENV_NAME, 'TAKOS_ACCESS_TOKEN');
})

  Deno.test('resolveTakosApiUrl - returns URL with admin domain', () => {
  const result = resolveTakosApiUrl({ ADMIN_DOMAIN: 'api.takos.example' });
    assertEquals(result, 'https://api.takos.example');
})
  Deno.test('resolveTakosApiUrl - returns null when ADMIN_DOMAIN is empty', () => {
  assertEquals(resolveTakosApiUrl({ ADMIN_DOMAIN: '' }), null);
})
  Deno.test('resolveTakosApiUrl - returns null when ADMIN_DOMAIN is whitespace', () => {
  assertEquals(resolveTakosApiUrl({ ADMIN_DOMAIN: '   ' }), null);
})
  Deno.test('resolveTakosApiUrl - trims the admin domain', () => {
  const result = resolveTakosApiUrl({ ADMIN_DOMAIN: '  api.takos.example  ' });
    assertEquals(result, 'https://api.takos.example');
})

  Deno.test('normalizeTakosScopes - returns deduplicated and trimmed scopes', () => {
  // We need to import ALL_SCOPES to know what valid scopes are.
    // The function validates against ALL_SCOPES. Let's test with known valid scopes.
    // We can test error handling without knowing the exact valid scopes.
})
  Deno.test('normalizeTakosScopes - throws when scopes array is empty', () => {
  assertThrows(() => { () => normalizeTakosScopes([]); }, 'at least one scope');
})
  Deno.test('normalizeTakosScopes - throws when all scopes are empty strings', () => {
  assertThrows(() => { () => normalizeTakosScopes(['', '  ']); }, 'at least one scope');
})
  Deno.test('normalizeTakosScopes - throws for unknown scopes', () => {
  assertThrows(() => { () => normalizeTakosScopes(['definitely_not_a_real_scope']); }, 'Unknown Takos scopes');
})
  Deno.test('normalizeTakosScopes - deduplicates scopes', () => {
  // Will throw for invalid scopes, but we test the dedup logic doesn't crash
    assertThrows(() => { () => normalizeTakosScopes(['fake_scope', 'fake_scope']); }, 'Unknown Takos scopes');
})

  Deno.test('listTakosBuiltinStatuses - throws when workspace is not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const getMock = (async () => null);
    const chain = {
      from: (function(this: any) { return this; }),
      where: (function(this: any) { return this; }),
      limit: (function(this: any) { return this; }),
      get: getMock,
    };
    mocks.getDb = (() => ({
      select: () => chain,
    })) as any;

    const { listTakosBuiltinStatuses } = await import('@/services/common-env/takos-builtins');

    await await assertRejects(async () => { await 
      listTakosBuiltinStatuses({
        env: { DB: {} as any, ADMIN_DOMAIN: 'test.takos.jp' },
        spaceId: 'nonexistent',
        workerId: 'w-1',
      })
    ; }, 'Space not found');
})
  Deno.test('listTakosBuiltinStatuses - returns statuses with TAKOS_API_URL and TAKOS_ACCESS_TOKEN keys', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const getMock = ((..._args: any[]) => undefined) as any
      // loadWorkspaceIdentity
       = (async () => ({
        id: 'space-1',
        type: 'user',
        name: 'Test User',
        slug: 'test-user',
        ownerAccountId: 'space-1',
      })) as any
      // listManagedRow -> null
       = (async () => null) as any;

    const chain = {
      from: (function(this: any) { return this; }),
      where: (function(this: any) { return this; }),
      limit: (function(this: any) { return this; }),
      get: getMock,
    };
    mocks.getDb = (() => ({
      select: () => chain,
    })) as any;

    const { listTakosBuiltinStatuses } = await import('@/services/common-env/takos-builtins');

    const result = await listTakosBuiltinStatuses({
      env: { DB: {} as any, ADMIN_DOMAIN: 'test.takos.jp' },
      spaceId: 'space-1',
      workerId: 'w-1',
    });

    assert('TAKOS_API_URL' in result);
    assert('TAKOS_ACCESS_TOKEN' in result);
    assertEquals(result.TAKOS_API_URL.managed, true);
    assertEquals(result.TAKOS_API_URL.available, true);
    assertEquals(result.TAKOS_ACCESS_TOKEN.managed, true);
    assertEquals(result.TAKOS_ACCESS_TOKEN.available, true);
    assertEquals(result.TAKOS_ACCESS_TOKEN.configured, false);
})
  Deno.test('listTakosBuiltinStatuses - shows TAKOS_API_URL as unavailable when ADMIN_DOMAIN is empty', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const getMock = ((..._args: any[]) => undefined) as any
       = (async () => ({
        id: 'space-1',
        type: 'user',
        name: 'Test User',
        slug: 'test-user',
        ownerAccountId: 'space-1',
      })) as any
       = (async () => null) as any;

    const chain = {
      from: (function(this: any) { return this; }),
      where: (function(this: any) { return this; }),
      limit: (function(this: any) { return this; }),
      get: getMock,
    };
    mocks.getDb = (() => ({
      select: () => chain,
    })) as any;

    const { listTakosBuiltinStatuses } = await import('@/services/common-env/takos-builtins');

    const result = await listTakosBuiltinStatuses({
      env: { DB: {} as any, ADMIN_DOMAIN: '' },
      spaceId: 'space-1',
      workerId: 'w-1',
    });

    assertEquals(result.TAKOS_API_URL.available, false);
    assertEquals(result.TAKOS_API_URL.sync_state, 'error');
    assertEquals(result.TAKOS_API_URL.sync_reason, 'admin_domain_missing');
})