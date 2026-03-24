import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => {
  const validateAuthorizationRequest = vi.fn();
  const generateAuthorizationCode = vi.fn();
  const buildErrorRedirect = vi.fn();
  const buildSuccessRedirect = vi.fn();
  const hasFullConsent = vi.fn();
  const getNewScopes = vi.fn();
  const grantConsent = vi.fn();
  const getClientById = vi.fn();
  const getSession = vi.fn();
  const getSessionIdFromCookie = vi.fn();
  const userFindUnique = vi.fn();
  const getDb = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.get = vi.fn(async () => userFindUnique());
    chain.all = vi.fn().mockResolvedValue([]);
    return {
      select: vi.fn().mockReturnValue(chain),
    };
  });
  const oauthAuthorizeRateLimiter = vi.fn(() => ({
    middleware: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    }),
  }));

  return {
    validateAuthorizationRequest,
    generateAuthorizationCode,
    buildErrorRedirect,
    buildSuccessRedirect,
    hasFullConsent,
    getNewScopes,
    grantConsent,
    getClientById,
    getSession,
    getSessionIdFromCookie,
    userFindUnique,
    getDb,
    oauthAuthorizeRateLimiter,
  };
});

vi.mock('@/services/oauth/authorization', () => ({
  validateAuthorizationRequest: mocks.validateAuthorizationRequest,
  generateAuthorizationCode: mocks.generateAuthorizationCode,
  buildErrorRedirect: mocks.buildErrorRedirect,
  buildSuccessRedirect: mocks.buildSuccessRedirect,
}));

vi.mock('@/services/oauth/consent', () => ({
  hasFullConsent: mocks.hasFullConsent,
  getNewScopes: mocks.getNewScopes,
  grantConsent: mocks.grantConsent,
}));

vi.mock('@/services/oauth/client', () => ({
  getClientById: mocks.getClientById,
}));

vi.mock('@/services/identity/session', () => ({
  getSession: mocks.getSession,
  getSessionIdFromCookie: mocks.getSessionIdFromCookie,
}));

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/utils/rate-limiter', () => ({
  RateLimiters: {
    oauthAuthorize: mocks.oauthAuthorizeRateLimiter,
  },
}));

import oauthAuthorize from '@/routes/oauth/authorize';

function createEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return createMockEnv({
    ADMIN_DOMAIN: 'admin.takos.test',
    ...overrides,
  }) as unknown as Env;
}

async function callAuthorize(
  body: Partial<Record<string, string>>,
  env: Env = createEnv()
): Promise<Response> {
  const csrfToken = 'test-csrf-token';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) {
      params.set(key, value);
    }
  }
  params.set('csrf_token', csrfToken);

  return oauthAuthorize.fetch(
    new Request('http://localhost/authorize', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: `__Host-tp_session=session-cookie; __Host-csrf=${csrfToken}`,
      },
      body: params.toString(),
    }),
    env,
    {} as ExecutionContext
  );
}

describe('oauth authorize POST revalidation (issue 007)', () => {
  const userRecord = {
    id: 'user-1',
    trustTier: 'normal',
    email: 'user@example.com',
    name: 'User One',
    slug: 'user-one',
    bio: null,
    picture: null,
    setupCompleted: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const baseBody = {
    client_id: 'tampered-client',
    redirect_uri: 'https://attacker.example/callback',
    scope: 'openid profile',
    state: 'raw-state',
    code_challenge: 'raw-challenge',
    code_challenge_method: 'S256',
    action: 'allow',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getSessionIdFromCookie.mockReturnValue('session-1');
    mocks.getSession.mockResolvedValue({
      id: 'session-1',
      user_id: 'user-1',
      expires_at: 4102444800000,
      created_at: 1700000000000,
    });
    mocks.userFindUnique.mockResolvedValue(userRecord);
    // getDb mock is already configured in hoisted mocks to return Drizzle chain
    // that delegates .get() to userFindUnique
    mocks.getClientById.mockResolvedValue({
      client_id: 'client-id-default',
    });
    mocks.hasFullConsent.mockResolvedValue(false);
    mocks.getNewScopes.mockResolvedValue([]);
    mocks.grantConsent.mockResolvedValue(undefined);
    mocks.generateAuthorizationCode.mockResolvedValue('code-default');
    mocks.buildErrorRedirect.mockReturnValue('https://client.example/callback?error=invalid_request');
    mocks.buildSuccessRedirect.mockReturnValue('https://client.example/callback?code=code-default&state=raw-state');
    mocks.validateAuthorizationRequest.mockResolvedValue({
      valid: true,
      client: { client_id: 'client-id-default' },
      redirectUri: 'https://client.example/callback',
    });
  });

  it('returns 400 JSON when POST validation fails without redirect context', async () => {
    mocks.validateAuthorizationRequest.mockResolvedValue({
      valid: false,
      error: 'invalid_request',
      errorDescription: 'tampered authorization payload',
    });

    const response = await callAuthorize(baseBody);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_request',
      error_description: 'tampered authorization payload',
    });
    expect(mocks.buildErrorRedirect).not.toHaveBeenCalled();
    expect(mocks.grantConsent).not.toHaveBeenCalled();
    expect(mocks.generateAuthorizationCode).not.toHaveBeenCalled();
  });

  it('redirects with OAuth error when POST validation fails with redirect context', async () => {
    const errorRedirect = 'https://client.example/callback?error=invalid_scope&state=raw-state';
    mocks.validateAuthorizationRequest.mockResolvedValue({
      valid: false,
      redirectUri: 'https://client.example/callback',
      error: 'invalid_scope',
      errorDescription: 'scope mismatch',
    });
    mocks.buildErrorRedirect.mockReturnValue(errorRedirect);

    const response = await callAuthorize(baseBody);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(errorRedirect);
    expect(mocks.buildErrorRedirect).toHaveBeenCalledWith(
      'https://client.example/callback',
      'raw-state',
      'invalid_scope',
      'scope mismatch'
    );
    expect(mocks.grantConsent).not.toHaveBeenCalled();
    expect(mocks.generateAuthorizationCode).not.toHaveBeenCalled();
  });

  it('uses validated normalized values for approve code issuance', async () => {
    const env = createEnv();
    const successRedirect = 'https://trusted.example/callback?code=code-123&state=raw-state';

    mocks.validateAuthorizationRequest.mockResolvedValue({
      valid: true,
      client: { client_id: 'client-normalized' },
      redirectUri: 'https://trusted.example/callback',
    });
    mocks.generateAuthorizationCode.mockResolvedValue('code-123');
    mocks.buildSuccessRedirect.mockReturnValue(successRedirect);

    const response = await callAuthorize(baseBody, env);

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(successRedirect);

    expect(mocks.validateAuthorizationRequest).toHaveBeenCalledWith(env.DB, {
      response_type: 'code',
      client_id: 'tampered-client',
      redirect_uri: 'https://attacker.example/callback',
      scope: 'openid profile',
      state: 'raw-state',
      code_challenge: 'raw-challenge',
      code_challenge_method: 'S256',
    });

    expect(mocks.grantConsent).toHaveBeenCalledWith(
      env.DB,
      'user-1',
      'client-normalized',
      ['openid', 'profile']
    );

    expect(mocks.generateAuthorizationCode).toHaveBeenCalledWith(env.DB, {
      clientId: 'client-normalized',
      userId: 'user-1',
      redirectUri: 'https://trusted.example/callback',
      scope: 'openid profile',
      codeChallenge: 'raw-challenge',
      codeChallengeMethod: 'S256',
    });

    expect(mocks.buildSuccessRedirect).toHaveBeenCalledWith(
      'https://trusted.example/callback',
      'raw-state',
      'code-123'
    );

    const issued = mocks.generateAuthorizationCode.mock.calls[0]?.[1];
    expect(issued.clientId).not.toBe(baseBody.client_id);
    expect(issued.redirectUri).not.toBe(baseBody.redirect_uri);
  });
});
