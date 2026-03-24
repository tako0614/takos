import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';
import type { OAuthClient } from '@/types/oauth';
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
    redirect_uris: JSON.stringify(['https://example.com/callback']),
    grant_types: JSON.stringify(['authorization_code', 'refresh_token']),
    response_types: JSON.stringify(['code']),
    allowed_scopes: JSON.stringify(['openid', 'profile']),
    owner_id: null,
    registration_access_token_hash: null,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('validateRedirectUri', () => {
  it('returns true when URI is in the registered list', () => {
    const client = makeClient({
      redirect_uris: JSON.stringify([
        'https://example.com/callback',
        'https://other.example.com/auth',
      ]),
    });

    expect(validateRedirectUri(client, 'https://example.com/callback')).toBe(true);
    expect(validateRedirectUri(client, 'https://other.example.com/auth')).toBe(true);
  });

  it('returns false when URI is not in the registered list', () => {
    const client = makeClient();
    expect(validateRedirectUri(client, 'https://evil.com/callback')).toBe(false);
  });

  it('does exact string matching (no normalization)', () => {
    const client = makeClient({
      redirect_uris: JSON.stringify(['https://example.com/callback']),
    });

    // Trailing slash is different
    expect(validateRedirectUri(client, 'https://example.com/callback/')).toBe(false);
  });

  it('returns false when redirect_uris is invalid JSON', () => {
    const client = makeClient({ redirect_uris: 'not-json' });
    expect(validateRedirectUri(client, 'https://example.com/callback')).toBe(false);
  });

  it('returns false for empty redirect_uris', () => {
    const client = makeClient({ redirect_uris: '[]' });
    expect(validateRedirectUri(client, 'https://example.com/callback')).toBe(false);
  });
});

describe('validateRedirectUris', () => {
  it('accepts valid HTTPS URIs', () => {
    expect(() => validateRedirectUris(['https://example.com/callback'])).not.toThrow();
  });

  it('accepts localhost HTTP URIs', () => {
    expect(() =>
      validateRedirectUris(['http://localhost:3000/callback']),
    ).not.toThrow();
    expect(() =>
      validateRedirectUris(['http://127.0.0.1:8080/callback']),
    ).not.toThrow();
    expect(() =>
      validateRedirectUris(['http://[::1]:3000/callback']),
    ).not.toThrow();
    expect(() =>
      validateRedirectUris(['http://sub.localhost/callback']),
    ).not.toThrow();
  });

  it('throws for empty array', () => {
    expect(() => validateRedirectUris([])).toThrow('At least one redirect_uri is required');
  });

  it('throws for non-HTTPS non-localhost URIs', () => {
    expect(() => validateRedirectUris(['http://example.com/callback'])).toThrow('must use HTTPS');
  });

  it('throws for URIs with fragments', () => {
    expect(() =>
      validateRedirectUris(['https://example.com/callback#fragment']),
    ).toThrow('fragment not allowed');
  });

  it('throws for malformed URIs', () => {
    expect(() => validateRedirectUris(['not-a-url'])).toThrow('Invalid redirect_uri');
  });

  it('accepts multiple valid URIs', () => {
    expect(() =>
      validateRedirectUris([
        'https://example.com/callback',
        'https://other.example.com/auth',
        'http://localhost:3000/callback',
      ]),
    ).not.toThrow();
  });
});

describe('supportsGrantType', () => {
  it('returns true when grant type is in the list', () => {
    const client = makeClient({
      grant_types: JSON.stringify(['authorization_code', 'refresh_token']),
    });

    expect(supportsGrantType(client, 'authorization_code')).toBe(true);
    expect(supportsGrantType(client, 'refresh_token')).toBe(true);
  });

  it('returns false when grant type is not in the list', () => {
    const client = makeClient({
      grant_types: JSON.stringify(['authorization_code']),
    });

    expect(supportsGrantType(client, 'client_credentials')).toBe(false);
  });

  it('returns false for invalid JSON', () => {
    const client = makeClient({ grant_types: 'not-json' });
    expect(supportsGrantType(client, 'authorization_code')).toBe(false);
  });
});

describe('getClientAllowedScopes', () => {
  it('parses and returns the allowed scopes', () => {
    const client = makeClient({
      allowed_scopes: JSON.stringify(['openid', 'profile', 'spaces:read']),
    });

    expect(getClientAllowedScopes(client)).toEqual(['openid', 'profile', 'spaces:read']);
  });

  it('returns empty array for invalid JSON', () => {
    const client = makeClient({ allowed_scopes: 'bad' });
    expect(getClientAllowedScopes(client)).toEqual([]);
  });
});

describe('getClientRedirectUris', () => {
  it('parses and returns redirect URIs', () => {
    const client = makeClient({
      redirect_uris: JSON.stringify(['https://a.com/cb', 'https://b.com/cb']),
    });

    expect(getClientRedirectUris(client)).toEqual(['https://a.com/cb', 'https://b.com/cb']);
  });

  it('returns empty array for invalid JSON', () => {
    const client = makeClient({ redirect_uris: '{bad}' });
    expect(getClientRedirectUris(client)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DB-dependent tests
// ---------------------------------------------------------------------------

function createMockDrizzleDb() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, getDb: mocks.getDb };
});

import {
  getClientById,
  getClientsByOwner,
  validateClientCredentials,
  validateRegistrationToken,
  createClient,
  deleteClient,
} from '@/services/oauth/client';

describe('getClientById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns mapped OAuthClient when found', async () => {
    db._.get.mockResolvedValueOnce({
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
    });

    const client = await getClientById({} as D1Database, 'client-1');
    expect(client).not.toBeNull();
    expect(client!.client_id).toBe('client-1');
    expect(client!.client_type).toBe('confidential');
    expect(client!.name).toBe('Test');
  });

  it('returns null when client is not found', async () => {
    db._.get.mockResolvedValueOnce(null);
    const client = await getClientById({} as D1Database, 'nonexistent');
    expect(client).toBeNull();
  });
});

describe('getClientsByOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns array of mapped clients', async () => {
    db._.all.mockResolvedValueOnce([
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
    ]);

    const clients = await getClientsByOwner({} as D1Database, 'owner-1');
    expect(clients).toHaveLength(1);
    expect(clients[0]!.client_id).toBe('client-1');
  });
});

describe('validateClientCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns valid for a public client without secret', async () => {
    db._.get.mockResolvedValueOnce({
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
    });

    const result = await validateClientCredentials({} as D1Database, 'client-1');
    expect(result.valid).toBe(true);
    expect(result.client).not.toBeNull();
  });

  it('returns invalid when client is not found', async () => {
    db._.get.mockResolvedValueOnce(null);

    const result = await validateClientCredentials({} as D1Database, 'nonexistent');
    expect(result.valid).toBe(false);
    expect(result.client).toBeNull();
    expect(result.error).toBe('Client not found');
  });

  it('returns invalid for confidential client without secret', async () => {
    db._.get.mockResolvedValueOnce({
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
    });

    const result = await validateClientCredentials({} as D1Database, 'client-1');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Client secret required');
  });
});

describe('createClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('creates a client and returns registration response', async () => {
    const response = await createClient({} as D1Database, {
      client_name: 'New App',
      redirect_uris: ['https://example.com/callback'],
      scope: 'openid profile',
    });

    expect(response.client_id).toBeTruthy();
    expect(response.client_secret).toBeTruthy(); // confidential by default
    expect(response.client_name).toBe('New App');
    expect(response.redirect_uris).toEqual(['https://example.com/callback']);
    expect(response.scope).toBe('openid profile');
    expect(response.registration_access_token).toBeTruthy();
    expect(response.client_secret_expires_at).toBe(0);
  });

  it('creates a public client when token_endpoint_auth_method is none', async () => {
    const response = await createClient({} as D1Database, {
      client_name: 'Public App',
      redirect_uris: ['https://example.com/callback'],
      token_endpoint_auth_method: 'none',
    });

    expect(response.client_secret).toBeUndefined();
  });

  it('throws for unknown scopes', async () => {
    await expect(
      createClient({} as D1Database, {
        client_name: 'Bad Scopes',
        redirect_uris: ['https://example.com/callback'],
        scope: 'openid unknown_scope',
      }),
    ).rejects.toThrow('Unknown scopes');
  });

  it('defaults grant_types and response_types', async () => {
    const response = await createClient({} as D1Database, {
      client_name: 'Default Grants',
      redirect_uris: ['https://example.com/callback'],
    });

    expect(response.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(response.response_types).toEqual(['code']);
  });
});

describe('deleteClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('sets client status to revoked', async () => {
    (db._.chain as any).run = undefined; // Not used here; the update returns meta
    (db.update as ReturnType<typeof vi.fn>).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      }),
    });

    const result = await deleteClient({} as D1Database, 'client-1');
    expect(result).toBe(true);
  });
});
