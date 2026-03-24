import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';

import {
  buildErrorRedirect,
  buildSuccessRedirect,
} from '@/services/oauth/authorization';
import { generateCodeVerifier, generateCodeChallenge } from '@/services/oauth/pkce';
import { computeSHA256 } from '@/utils/hash';

// ---------------------------------------------------------------------------
// Pure function tests (no DB needed)
// ---------------------------------------------------------------------------

describe('buildErrorRedirect', () => {
  it('appends error, error_description, and state to the redirect URI', () => {
    const url = buildErrorRedirect(
      'https://example.com/callback',
      'state123',
      'access_denied',
      'User denied access',
    );

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://example.com/callback');
    expect(parsed.searchParams.get('error')).toBe('access_denied');
    expect(parsed.searchParams.get('error_description')).toBe('User denied access');
    expect(parsed.searchParams.get('state')).toBe('state123');
  });

  it('omits error_description when not provided', () => {
    const url = buildErrorRedirect('https://example.com/callback', 'state', 'server_error');

    const parsed = new URL(url);
    expect(parsed.searchParams.has('error_description')).toBe(false);
    expect(parsed.searchParams.get('error')).toBe('server_error');
    expect(parsed.searchParams.get('state')).toBe('state');
  });

  it('preserves existing query parameters', () => {
    const url = buildErrorRedirect(
      'https://example.com/callback?foo=bar',
      'state',
      'invalid_scope',
    );

    const parsed = new URL(url);
    expect(parsed.searchParams.get('foo')).toBe('bar');
    expect(parsed.searchParams.get('error')).toBe('invalid_scope');
  });
});

describe('buildSuccessRedirect', () => {
  it('appends code and state to the redirect URI', () => {
    const url = buildSuccessRedirect('https://example.com/callback', 'state123', 'auth-code-abc');

    const parsed = new URL(url);
    expect(parsed.searchParams.get('code')).toBe('auth-code-abc');
    expect(parsed.searchParams.get('state')).toBe('state123');
  });
});

// ---------------------------------------------------------------------------
// DB-dependent tests (validateAuthorizationRequest, generateAuthorizationCode, exchangeAuthorizationCode)
// ---------------------------------------------------------------------------

function createMockDrizzleDb() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      })),
    })),
    delete: vi.fn(() => chain),
    _: { get: getMock, all: allMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  revokeTokensByAuthorizationCode: vi.fn().mockResolvedValue(0),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, getDb: mocks.getDb };
});

vi.mock('@/services/oauth/token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/oauth/token')>();
  return { ...actual, revokeTokensByAuthorizationCode: mocks.revokeTokensByAuthorizationCode };
});

import {
  validateAuthorizationRequest,
  generateAuthorizationCode,
  exchangeAuthorizationCode,
} from '@/services/oauth/authorization';

describe('validateAuthorizationRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('rejects unsupported response_type', async () => {
    const result = await validateAuthorizationRequest({} as D1Database, {
      response_type: 'token' as never,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('unsupported_response_type');
  });

  it('rejects missing client_id', async () => {
    const result = await validateAuthorizationRequest({} as D1Database, {
      response_type: 'code',
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_request');
    expect(result.errorDescription).toContain('client_id');
  });

  it('rejects nonexistent client', async () => {
    db._.get.mockResolvedValueOnce(null); // getClientById returns null

    const result = await validateAuthorizationRequest({} as D1Database, {
      response_type: 'code',
      client_id: 'nonexistent',
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_client');
  });

  it('rejects missing redirect_uri', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'int-1',
      clientId: 'client-1',
      clientSecretHash: null,
      clientType: 'public',
      name: 'App',
      description: null,
      logoUri: null,
      clientUri: null,
      policyUri: null,
      tosUri: null,
      redirectUris: '["https://example.com/cb"]',
      grantTypes: '["authorization_code"]',
      responseTypes: '["code"]',
      allowedScopes: '["openid"]',
      ownerAccountId: null,
      registrationAccessTokenHash: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await validateAuthorizationRequest({} as D1Database, {
      response_type: 'code',
      client_id: 'client-1',
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_request');
    expect(result.errorDescription).toContain('redirect_uri');
  });

  it('rejects unregistered redirect_uri', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'int-1',
      clientId: 'client-1',
      clientSecretHash: null,
      clientType: 'public',
      name: 'App',
      description: null,
      logoUri: null,
      clientUri: null,
      policyUri: null,
      tosUri: null,
      redirectUris: '["https://example.com/cb"]',
      grantTypes: '["authorization_code"]',
      responseTypes: '["code"]',
      allowedScopes: '["openid"]',
      ownerAccountId: null,
      registrationAccessTokenHash: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await validateAuthorizationRequest({} as D1Database, {
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'https://evil.com/cb',
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_request');
    expect(result.errorDescription).toContain('redirect_uri not registered');
  });

  it('rejects missing state', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'int-1',
      clientId: 'client-1',
      clientSecretHash: null,
      clientType: 'public',
      name: 'App',
      description: null,
      logoUri: null,
      clientUri: null,
      policyUri: null,
      tosUri: null,
      redirectUris: '["https://example.com/cb"]',
      grantTypes: '["authorization_code"]',
      responseTypes: '["code"]',
      allowedScopes: '["openid"]',
      ownerAccountId: null,
      registrationAccessTokenHash: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await validateAuthorizationRequest({} as D1Database, {
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'https://example.com/cb',
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_request');
    expect(result.errorDescription).toContain('state');
    expect(result.redirectUri).toBe('https://example.com/cb');
  });

  it('rejects missing code_challenge (PKCE is required)', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'int-1',
      clientId: 'client-1',
      clientSecretHash: null,
      clientType: 'public',
      name: 'App',
      description: null,
      logoUri: null,
      clientUri: null,
      policyUri: null,
      tosUri: null,
      redirectUris: '["https://example.com/cb"]',
      grantTypes: '["authorization_code"]',
      responseTypes: '["code"]',
      allowedScopes: '["openid"]',
      ownerAccountId: null,
      registrationAccessTokenHash: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await validateAuthorizationRequest({} as D1Database, {
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'https://example.com/cb',
      state: 'some-state',
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_request');
    expect(result.errorDescription).toContain('code_challenge');
  });

  it('rejects non-S256 code_challenge_method', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'int-1',
      clientId: 'client-1',
      clientSecretHash: null,
      clientType: 'public',
      name: 'App',
      description: null,
      logoUri: null,
      clientUri: null,
      policyUri: null,
      tosUri: null,
      redirectUris: '["https://example.com/cb"]',
      grantTypes: '["authorization_code"]',
      responseTypes: '["code"]',
      allowedScopes: '["openid"]',
      ownerAccountId: null,
      registrationAccessTokenHash: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await validateAuthorizationRequest({} as D1Database, {
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'https://example.com/cb',
      state: 'some-state',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'plain' as never,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_request');
    expect(result.errorDescription).toContain('S256');
  });

  it('rejects invalid scope', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'int-1',
      clientId: 'client-1',
      clientSecretHash: null,
      clientType: 'public',
      name: 'App',
      description: null,
      logoUri: null,
      clientUri: null,
      policyUri: null,
      tosUri: null,
      redirectUris: '["https://example.com/cb"]',
      grantTypes: '["authorization_code"]',
      responseTypes: '["code"]',
      allowedScopes: '["openid"]',
      ownerAccountId: null,
      registrationAccessTokenHash: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await validateAuthorizationRequest({} as D1Database, {
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'https://example.com/cb',
      state: 'some-state',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
      scope: 'openid unknown_scope',
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_scope');
  });

  it('rejects scopes that exceed client allowed scopes', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'int-1',
      clientId: 'client-1',
      clientSecretHash: null,
      clientType: 'public',
      name: 'App',
      description: null,
      logoUri: null,
      clientUri: null,
      policyUri: null,
      tosUri: null,
      redirectUris: '["https://example.com/cb"]',
      grantTypes: '["authorization_code"]',
      responseTypes: '["code"]',
      allowedScopes: '["openid"]', // Only openid allowed
      ownerAccountId: null,
      registrationAccessTokenHash: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await validateAuthorizationRequest({} as D1Database, {
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'https://example.com/cb',
      state: 'some-state',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
      scope: 'openid profile', // profile not in allowed_scopes
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_scope');
    expect(result.errorDescription).toContain('exceeds allowed scopes');
  });

  it('returns valid for a complete correct request', async () => {
    db._.get.mockResolvedValueOnce({
      id: 'int-1',
      clientId: 'client-1',
      clientSecretHash: null,
      clientType: 'public',
      name: 'App',
      description: null,
      logoUri: null,
      clientUri: null,
      policyUri: null,
      tosUri: null,
      redirectUris: '["https://example.com/cb"]',
      grantTypes: '["authorization_code"]',
      responseTypes: '["code"]',
      allowedScopes: '["openid","profile"]',
      ownerAccountId: null,
      registrationAccessTokenHash: null,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await validateAuthorizationRequest({} as D1Database, {
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'https://example.com/cb',
      state: 'state123',
      code_challenge: 'A'.repeat(43),
      code_challenge_method: 'S256',
      scope: 'openid profile',
    });

    expect(result.valid).toBe(true);
    expect(result.client).toBeDefined();
    expect(result.redirectUri).toBe('https://example.com/cb');
  });
});

// ---------------------------------------------------------------------------
// generateAuthorizationCode
// ---------------------------------------------------------------------------

describe('generateAuthorizationCode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns a non-empty authorization code string', async () => {
    // insert().values() resolves via the mock chain
    db._.chain.values.mockResolvedValueOnce(undefined);

    const code = await generateAuthorizationCode({} as D1Database, {
      clientId: 'client-1',
      userId: 'user-1',
      redirectUri: 'https://example.com/cb',
      scope: 'openid',
      codeChallenge: 'A'.repeat(43),
      codeChallengeMethod: 'S256',
    });

    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
  });

  it('calls db.insert to persist the code', async () => {
    db._.chain.values.mockResolvedValueOnce(undefined);

    await generateAuthorizationCode({} as D1Database, {
      clientId: 'client-1',
      userId: 'user-1',
      redirectUri: 'https://example.com/cb',
      scope: 'openid',
      codeChallenge: 'A'.repeat(43),
      codeChallengeMethod: 'S256',
    });

    expect(db.insert).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// exchangeAuthorizationCode
// ---------------------------------------------------------------------------

describe('exchangeAuthorizationCode', () => {
  // Helper: create a stored auth code row that matches a given plaintext code
  async function buildStoredCodeRow(
    code: string,
    overrides: Record<string, unknown> = {},
  ) {
    const codeHash = await computeSHA256(code);
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier, 'S256');

    return {
      row: {
        id: 'code-id-1',
        codeHash,
        clientId: 'client-1',
        accountId: 'user-1',
        redirectUri: 'https://example.com/cb',
        scope: 'openid',
        codeChallenge,
        codeChallengeMethod: 'S256',
        used: false,
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        createdAt: new Date().toISOString(),
        ...overrides,
      },
      codeVerifier,
      codeChallenge,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns invalid_grant when code is not found', async () => {
    db._.get.mockResolvedValueOnce(null);

    const result = await exchangeAuthorizationCode({} as D1Database, {
      code: 'nonexistent-code',
      clientId: 'client-1',
      redirectUri: 'https://example.com/cb',
      codeVerifier: 'dummy-verifier',
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_grant');
    expect(result.errorDescription).toContain('not found');
  });

  it('returns invalid_grant and revokes tokens when code was already used', async () => {
    const code = 'used-code-value';
    const { row } = await buildStoredCodeRow(code, { used: true });

    db._.get.mockResolvedValueOnce(row);

    const result = await exchangeAuthorizationCode({} as D1Database, {
      code,
      clientId: 'client-1',
      redirectUri: 'https://example.com/cb',
      codeVerifier: 'dummy-verifier',
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_grant');
    expect(result.errorDescription).toContain('already used');
    expect(mocks.revokeTokensByAuthorizationCode).toHaveBeenCalledWith(
      expect.anything(),
      'code-id-1',
    );
  });

  it('returns invalid_grant when code is expired', async () => {
    const code = 'expired-code-value';
    const { row, codeVerifier } = await buildStoredCodeRow(code, {
      expiresAt: new Date(Date.now() - 10_000).toISOString(), // expired 10s ago
    });

    db._.get.mockResolvedValueOnce(row);

    const result = await exchangeAuthorizationCode({} as D1Database, {
      code,
      clientId: row.clientId,
      redirectUri: row.redirectUri,
      codeVerifier,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_grant');
    expect(result.errorDescription).toContain('expired');
  });

  it('returns invalid_grant when client_id mismatches', async () => {
    const code = 'client-mismatch-code';
    const { row, codeVerifier } = await buildStoredCodeRow(code);

    db._.get.mockResolvedValueOnce(row);

    const result = await exchangeAuthorizationCode({} as D1Database, {
      code,
      clientId: 'wrong-client-id',
      redirectUri: row.redirectUri,
      codeVerifier,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_grant');
    expect(result.errorDescription).toContain('Client ID mismatch');
  });

  it('returns invalid_grant when redirect_uri mismatches', async () => {
    const code = 'redirect-mismatch-code';
    const { row, codeVerifier } = await buildStoredCodeRow(code);

    db._.get.mockResolvedValueOnce(row);

    const result = await exchangeAuthorizationCode({} as D1Database, {
      code,
      clientId: row.clientId,
      redirectUri: 'https://evil.com/cb',
      codeVerifier,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_grant');
    expect(result.errorDescription).toContain('Redirect URI mismatch');
  });

  it('returns invalid_grant when PKCE verification fails (wrong verifier)', async () => {
    const code = 'pkce-fail-code';
    const { row } = await buildStoredCodeRow(code);

    db._.get.mockResolvedValueOnce(row);

    // Use a deliberately wrong code_verifier
    const result = await exchangeAuthorizationCode({} as D1Database, {
      code,
      clientId: row.clientId,
      redirectUri: row.redirectUri,
      codeVerifier: 'wrong-verifier-that-does-not-match-challenge-at-all',
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_grant');
    expect(result.errorDescription).toContain('PKCE verification failed');
  });

  it('returns valid with the authorization code on successful exchange', async () => {
    const code = 'valid-exchange-code';
    const { row, codeVerifier } = await buildStoredCodeRow(code);

    db._.get.mockResolvedValueOnce(row);

    // db.update().set().where() should resolve with changes: 1 (CAS success)
    // The default mock already returns { meta: { changes: 1 } }

    const result = await exchangeAuthorizationCode({} as D1Database, {
      code,
      clientId: row.clientId,
      redirectUri: row.redirectUri,
      codeVerifier,
    });

    expect(result.valid).toBe(true);
    expect(result.code).toBeDefined();
    expect(result.code!.client_id).toBe('client-1');
    expect(result.code!.user_id).toBe('user-1');
    expect(result.code!.scope).toBe('openid');
  });

  it('returns invalid_grant when CAS update returns zero changes (race condition)', async () => {
    const code = 'race-condition-code';
    const { row, codeVerifier } = await buildStoredCodeRow(code);

    db._.get.mockResolvedValueOnce(row);

    // Override the update mock to simulate zero changes (another process used the code)
    db.update.mockReturnValueOnce({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
      })),
    });

    const result = await exchangeAuthorizationCode({} as D1Database, {
      code,
      clientId: row.clientId,
      redirectUri: row.redirectUri,
      codeVerifier,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_grant');
    expect(result.errorDescription).toContain('already used');
    expect(mocks.revokeTokensByAuthorizationCode).toHaveBeenCalled();
  });
});
