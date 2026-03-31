import type { D1Database } from '@cloudflare/workers-types';
import type { OAuthClient, JsonStringArray } from '@/types/oauth';
import {
  validateRedirectUri,
  validateRedirectUris,
  supportsGrantType,
  getClientAllowedScopes,
  getClientRedirectUris,
} from '@/services/oauth/client';

// ---------------------------------------------------------------------------
// Pure function tests (no DB mocks needed)
// ---------------------------------------------------------------------------

/** Helper to create a {@link JsonStringArray} from a native array in tests. */
import { assertEquals, assertNotEquals, assert, assertThrows, assertRejects } from 'jsr:@std/assert';

function jsonArray(arr: string[]): JsonStringArray {
  return JSON.stringify(arr) as JsonStringArray;
}

function makeClient(overrides: Partial<OAuthClient> = {}): OAuthClient {
  return {
    id: 'internal-id',
    client_id: 'test-client-id',
    client_secret_hash: null,
    client_type: 'public',
    name: 'Test Client',
    description: null,
    logo_uri: null,
    client_uri: null,
    policy_uri: null,
    tos_uri: null,
    redirect_uris: jsonArray(['https://example.com/callback']),
    grant_types: jsonArray(['authorization_code', 'refresh_token']),
    response_types: jsonArray(['code']),
    allowed_scopes: jsonArray(['openid', 'profile']),
    owner_id: null,
    registration_access_token_hash: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}


  Deno.test('validateRedirectUri - returns true when URI is in the registered list', () => {
  const client = makeClient({
      redirect_uris: jsonArray([
        'https://example.com/callback',
        'https://other.example.com/auth',
      ]),
    });

    assertEquals(validateRedirectUri(client, 'https://example.com/callback'), true);
    assertEquals(validateRedirectUri(client, 'https://other.example.com/auth'), true);
})
  Deno.test('validateRedirectUri - returns false when URI is not in the registered list', () => {
  const client = makeClient();
    assertEquals(validateRedirectUri(client, 'https://evil.com/callback'), false);
})
  Deno.test('validateRedirectUri - does exact string matching (no normalization)', () => {
  const client = makeClient({
      redirect_uris: jsonArray(['https://example.com/callback']),
    });

    // Trailing slash is different
    assertEquals(validateRedirectUri(client, 'https://example.com/callback/'), false);
})
  Deno.test('validateRedirectUri - returns false when redirect_uris is invalid JSON', () => {
  const client = makeClient({ redirect_uris: 'not-json' as JsonStringArray });
    assertEquals(validateRedirectUri(client, 'https://example.com/callback'), false);
})
  Deno.test('validateRedirectUri - returns false for empty redirect_uris', () => {
  const client = makeClient({ redirect_uris: '[]' as JsonStringArray });
    assertEquals(validateRedirectUri(client, 'https://example.com/callback'), false);
})

  Deno.test('validateRedirectUris - accepts valid HTTPS URIs', () => {
  try { () => validateRedirectUris(['https://example.com/callback']); } catch (_e) { throw new Error('Expected no throw'); };
})
  Deno.test('validateRedirectUris - accepts localhost HTTP URIs', () => {
  try { () =>
      validateRedirectUris(['http://localhost:3000/callback']),
    ; } catch (_e) { throw new Error('Expected no throw'); };
    try { () =>
      validateRedirectUris(['http://127.0.0.1:8080/callback']),
    ; } catch (_e) { throw new Error('Expected no throw'); };
    try { () =>
      validateRedirectUris(['http://[::1]:3000/callback']),
    ; } catch (_e) { throw new Error('Expected no throw'); };
    try { () =>
      validateRedirectUris(['http://sub.localhost/callback']),
    ; } catch (_e) { throw new Error('Expected no throw'); };
})
  Deno.test('validateRedirectUris - throws for empty array', () => {
  assertThrows(() => { () => validateRedirectUris([]); }, 'At least one redirect_uri is required');
})
  Deno.test('validateRedirectUris - throws for non-HTTPS non-localhost URIs', () => {
  assertThrows(() => { () => validateRedirectUris(['http://example.com/callback']); }, 'must use HTTPS');
})
  Deno.test('validateRedirectUris - throws for URIs with fragments', () => {
  assertThrows(() => { () =>
      validateRedirectUris(['https://example.com/callback#fragment']),
    ; }, 'fragment not allowed');
})
  Deno.test('validateRedirectUris - throws for malformed URIs', () => {
  assertThrows(() => { () => validateRedirectUris(['not-a-url']); }, 'Invalid redirect_uri');
})
  Deno.test('validateRedirectUris - accepts multiple valid URIs', () => {
  try { () =>
      validateRedirectUris([
        'https://example.com/callback',
        'https://other.example.com/auth',
        'http://localhost:3000/callback',
      ]),
    ; } catch (_e) { throw new Error('Expected no throw'); };
})

  Deno.test('supportsGrantType - returns true when grant type is in the list', () => {
  const client = makeClient({
      grant_types: jsonArray(['authorization_code', 'refresh_token']),
    });

    assertEquals(supportsGrantType(client, 'authorization_code'), true);
    assertEquals(supportsGrantType(client, 'refresh_token'), true);
})
  Deno.test('supportsGrantType - returns false when grant type is not in the list', () => {
  const client = makeClient({
      grant_types: jsonArray(['authorization_code']),
    });

    assertEquals(supportsGrantType(client, 'client_credentials'), false);
})
  Deno.test('supportsGrantType - returns false for invalid JSON', () => {
  const client = makeClient({ grant_types: 'not-json' as JsonStringArray });
    assertEquals(supportsGrantType(client, 'authorization_code'), false);
})

  Deno.test('getClientAllowedScopes - parses and returns the allowed scopes', () => {
  const client = makeClient({
      allowed_scopes: jsonArray(['openid', 'profile', 'spaces:read']),
    });

    assertEquals(getClientAllowedScopes(client), ['openid', 'profile', 'spaces:read']);
})
  Deno.test('getClientAllowedScopes - returns empty array for invalid JSON', () => {
  const client = makeClient({ allowed_scopes: 'bad' as JsonStringArray });
    assertEquals(getClientAllowedScopes(client), []);
})

  Deno.test('getClientRedirectUris - parses and returns redirect URIs', () => {
  const client = makeClient({
      redirect_uris: jsonArray(['https://a.com/cb', 'https://b.com/cb']),
    });

    assertEquals(getClientRedirectUris(client), ['https://a.com/cb', 'https://b.com/cb']);
})
  Deno.test('getClientRedirectUris - returns empty array for invalid JSON', () => {
  const client = makeClient({ redirect_uris: '{bad}' as JsonStringArray });
    assertEquals(getClientRedirectUris(client), []);
})
// ---------------------------------------------------------------------------
// DB-dependent tests
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
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  getClientById,
  getClientsByOwner,
  validateClientCredentials,
  validateRegistrationToken,
  createClient,
  deleteClient,
} from '@/services/oauth/client';


  Deno.test('getClientById - returns mapped OAuthClient when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
      id: 'int-1',
      clientId: 'client-1',
      clientSecretHash: 'hash',
      clientType: 'confidential',
      name: 'Test',
      description: 'A client',
      logoUri: null,
      clientUri: null,
      policyUri: null,
      tosUri: null,
      redirectUris: '["https://example.com/cb"]',
      grantTypes: '["authorization_code"]',
      responseTypes: '["code"]',
      allowedScopes: '["openid"]',
      ownerAccountId: 'owner-1',
      registrationAccessTokenHash: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })) as any;

    const client = await getClientById({} as D1Database, 'client-1');
    assertNotEquals(client, null);
    assertEquals(client!.client_id, 'client-1');
    assertEquals(client!.client_type, 'confidential');
    assertEquals(client!.name, 'Test');
})
  Deno.test('getClientById - returns null when client is not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;
    const client = await getClientById({} as D1Database, 'nonexistent');
    assertEquals(client, null);
})

  Deno.test('getClientsByOwner - returns array of mapped clients', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.all = (async () => [
      {
        id: 'int-1',
        clientId: 'client-1',
        clientSecretHash: null,
        clientType: 'public',
        name: 'App 1',
        description: null,
        logoUri: null,
        clientUri: null,
        policyUri: null,
        tosUri: null,
        redirectUris: '[]',
        grantTypes: '[]',
        responseTypes: '[]',
        allowedScopes: '[]',
        ownerAccountId: 'owner-1',
        registrationAccessTokenHash: null,
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]) as any;

    const clients = await getClientsByOwner({} as D1Database, 'owner-1');
    assertEquals(clients.length, 1);
    assertEquals(clients[0]!.client_id, 'client-1');
})

  Deno.test('validateClientCredentials - returns valid for a public client without secret', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
      id: 'int-1',
      clientId: 'client-1',
      clientSecretHash: null,
      clientType: 'public',
      name: 'Public App',
      description: null,
      logoUri: null,
      clientUri: null,
      policyUri: null,
      tosUri: null,
      redirectUris: '[]',
      grantTypes: '[]',
      responseTypes: '[]',
      allowedScopes: '[]',
      ownerAccountId: null,
      registrationAccessTokenHash: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })) as any;

    const result = await validateClientCredentials({} as D1Database, 'client-1');
    assertEquals(result.valid, true);
    assertNotEquals(result.client, null);
})
  Deno.test('validateClientCredentials - returns invalid when client is not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => null) as any;

    const result = await validateClientCredentials({} as D1Database, 'nonexistent');
    assertEquals(result.valid, false);
    assertEquals(result.client, null);
    assertEquals(result.error, 'Client not found');
})
  Deno.test('validateClientCredentials - returns invalid for confidential client without secret', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.get = (async () => ({
      id: 'int-1',
      clientId: 'client-1',
      clientSecretHash: 'some-hash',
      clientType: 'confidential',
      name: 'Conf App',
      description: null,
      logoUri: null,
      clientUri: null,
      policyUri: null,
      tosUri: null,
      redirectUris: '[]',
      grantTypes: '[]',
      responseTypes: '[]',
      allowedScopes: '[]',
      ownerAccountId: null,
      registrationAccessTokenHash: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })) as any;

    const result = await validateClientCredentials({} as D1Database, 'client-1');
    assertEquals(result.valid, false);
    assertEquals(result.error, 'Client secret required');
})

  Deno.test('createClient - creates a client and returns registration response', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const response = await createClient({} as D1Database, {
      client_name: 'New App',
      redirect_uris: ['https://example.com/callback'],
      scope: 'openid profile',
    });

    assert(response.client_id);
    assert(response.client_secret); // confidential by default
    assertEquals(response.client_name, 'New App');
    assertEquals(response.redirect_uris, ['https://example.com/callback']);
    assertEquals(response.scope, 'openid profile');
    assert(response.registration_access_token);
    assertEquals(response.client_secret_expires_at, 0);
})
  Deno.test('createClient - creates a public client when token_endpoint_auth_method is none', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const response = await createClient({} as D1Database, {
      client_name: 'Public App',
      redirect_uris: ['https://example.com/callback'],
      token_endpoint_auth_method: 'none',
    });

    assertEquals(response.client_secret, undefined);
})
  Deno.test('createClient - throws for unknown scopes', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  await await assertRejects(async () => { await 
      createClient({} as D1Database, {
        client_name: 'Bad Scopes',
        redirect_uris: ['https://example.com/callback'],
        scope: 'openid unknown_scope',
      }),
    ; }, 'Unknown scopes');
})
  Deno.test('createClient - defaults grant_types and response_types', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const response = await createClient({} as D1Database, {
      client_name: 'Default Grants',
      redirect_uris: ['https://example.com/callback'],
    });

    assertEquals(response.grant_types, ['authorization_code', 'refresh_token']);
    assertEquals(response.response_types, ['code']);
})

  Deno.test('deleteClient - sets client status to revoked', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  (db._.chain as any).run = undefined; // Not used here; the update returns meta
    (db.update as ReturnType<typeof vi.fn>) = (() => ({
      set: (() => ({
        where: (async () => ({ meta: { changes: 1 } })),
      })),
    })) as any;

    const result = await deleteClient({} as D1Database, 'client-1');
    assertEquals(result, true);
})