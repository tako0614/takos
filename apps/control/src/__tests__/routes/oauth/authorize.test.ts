import type { Env } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup.ts';

import { assertEquals, assertNotEquals } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = {
  const validateAuthorizationRequest = ((..._args: any[]) => undefined) as any;
  const generateAuthorizationCode = ((..._args: any[]) => undefined) as any;
  const buildErrorRedirect = ((..._args: any[]) => undefined) as any;
  const buildSuccessRedirect = ((..._args: any[]) => undefined) as any;
  const hasFullConsent = ((..._args: any[]) => undefined) as any;
  const getNewScopes = ((..._args: any[]) => undefined) as any;
  const grantConsent = ((..._args: any[]) => undefined) as any;
  const getClientById = ((..._args: any[]) => undefined) as any;
  const getSession = ((..._args: any[]) => undefined) as any;
  const getSessionIdFromCookie = ((..._args: any[]) => undefined) as any;
  const userFindUnique = ((..._args: any[]) => undefined) as any;
  const getDb = () => {
    const chain: Record<string, unknown> = {};
    chain.from = (() => chain);
    chain.where = (() => chain);
    chain.get = async () => userFindUnique();
    chain.all = (async () => []);
    return {
      select: (() => chain),
    };
  };
  const oauthAuthorizeRateLimiter = () => ({
    middleware: () => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    },
  });

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
};

// [Deno] vi.mock removed - manually stub imports from '@/services/oauth/authorization'
// [Deno] vi.mock removed - manually stub imports from '@/services/oauth/consent'
// [Deno] vi.mock removed - manually stub imports from '@/services/oauth/client'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/session'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/utils/rate-limiter'
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
  Deno.test('oauth authorize POST revalidation (issue 007) - returns 400 JSON when POST validation fails without redirect context', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

    mocks.getSessionIdFromCookie = (() => 'session-1') as any;
    mocks.getSession = (async () => ({
      id: 'session-1',
      user_id: 'user-1',
      expires_at: 4102444800000,
      created_at: 1700000000000,
    })) as any;
    mocks.userFindUnique = (async () => userRecord) as any;
    // getDb mock is already configured in hoisted mocks to return Drizzle chain
    // that delegates .get() to userFindUnique
    mocks.getClientById = (async () => ({
      client_id: 'client-id-default',
    })) as any;
    mocks.hasFullConsent = (async () => false) as any;
    mocks.getNewScopes = (async () => []) as any;
    mocks.grantConsent = (async () => undefined) as any;
    mocks.generateAuthorizationCode = (async () => 'code-default') as any;
    mocks.buildErrorRedirect = (() => 'https://client.example/callback?error=invalid_request') as any;
    mocks.buildSuccessRedirect = (() => 'https://client.example/callback?code=code-default&state=raw-state') as any;
    mocks.validateAuthorizationRequest = (async () => ({
      valid: true,
      client: { client_id: 'client-id-default' },
      redirectUri: 'https://client.example/callback',
    })) as any;
  mocks.validateAuthorizationRequest = (async () => ({
      valid: false,
      error: 'invalid_request',
      errorDescription: 'tampered authorization payload',
    })) as any;

    const response = await callAuthorize(baseBody);

    assertEquals(response.status, 400);
    await assertEquals(await response.json(), {
      error: 'invalid_request',
      error_description: 'tampered authorization payload',
    });
    assertSpyCalls(mocks.buildErrorRedirect, 0);
    assertSpyCalls(mocks.grantConsent, 0);
    assertSpyCalls(mocks.generateAuthorizationCode, 0);
})
  Deno.test('oauth authorize POST revalidation (issue 007) - redirects with OAuth error when POST validation fails with redirect context', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

    mocks.getSessionIdFromCookie = (() => 'session-1') as any;
    mocks.getSession = (async () => ({
      id: 'session-1',
      user_id: 'user-1',
      expires_at: 4102444800000,
      created_at: 1700000000000,
    })) as any;
    mocks.userFindUnique = (async () => userRecord) as any;
    // getDb mock is already configured in hoisted mocks to return Drizzle chain
    // that delegates .get() to userFindUnique
    mocks.getClientById = (async () => ({
      client_id: 'client-id-default',
    })) as any;
    mocks.hasFullConsent = (async () => false) as any;
    mocks.getNewScopes = (async () => []) as any;
    mocks.grantConsent = (async () => undefined) as any;
    mocks.generateAuthorizationCode = (async () => 'code-default') as any;
    mocks.buildErrorRedirect = (() => 'https://client.example/callback?error=invalid_request') as any;
    mocks.buildSuccessRedirect = (() => 'https://client.example/callback?code=code-default&state=raw-state') as any;
    mocks.validateAuthorizationRequest = (async () => ({
      valid: true,
      client: { client_id: 'client-id-default' },
      redirectUri: 'https://client.example/callback',
    })) as any;
  const errorRedirect = 'https://client.example/callback?error=invalid_scope&state=raw-state';
    mocks.validateAuthorizationRequest = (async () => ({
      valid: false,
      redirectUri: 'https://client.example/callback',
      error: 'invalid_scope',
      errorDescription: 'scope mismatch',
    })) as any;
    mocks.buildErrorRedirect = (() => errorRedirect) as any;

    const response = await callAuthorize(baseBody);

    assertEquals(response.status, 302);
    assertEquals(response.headers.get('location'), errorRedirect);
    assertSpyCallArgs(mocks.buildErrorRedirect, 0, [
      'https://client.example/callback',
      'raw-state',
      'invalid_scope',
      'scope mismatch'
    ]);
    assertSpyCalls(mocks.grantConsent, 0);
    assertSpyCalls(mocks.generateAuthorizationCode, 0);
})
  Deno.test('oauth authorize POST revalidation (issue 007) - uses validated normalized values for approve code issuance', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

    mocks.getSessionIdFromCookie = (() => 'session-1') as any;
    mocks.getSession = (async () => ({
      id: 'session-1',
      user_id: 'user-1',
      expires_at: 4102444800000,
      created_at: 1700000000000,
    })) as any;
    mocks.userFindUnique = (async () => userRecord) as any;
    // getDb mock is already configured in hoisted mocks to return Drizzle chain
    // that delegates .get() to userFindUnique
    mocks.getClientById = (async () => ({
      client_id: 'client-id-default',
    })) as any;
    mocks.hasFullConsent = (async () => false) as any;
    mocks.getNewScopes = (async () => []) as any;
    mocks.grantConsent = (async () => undefined) as any;
    mocks.generateAuthorizationCode = (async () => 'code-default') as any;
    mocks.buildErrorRedirect = (() => 'https://client.example/callback?error=invalid_request') as any;
    mocks.buildSuccessRedirect = (() => 'https://client.example/callback?code=code-default&state=raw-state') as any;
    mocks.validateAuthorizationRequest = (async () => ({
      valid: true,
      client: { client_id: 'client-id-default' },
      redirectUri: 'https://client.example/callback',
    })) as any;
  const env = createEnv();
    const successRedirect = 'https://trusted.example/callback?code=code-123&state=raw-state';

    mocks.validateAuthorizationRequest = (async () => ({
      valid: true,
      client: { client_id: 'client-normalized' },
      redirectUri: 'https://trusted.example/callback',
    })) as any;
    mocks.generateAuthorizationCode = (async () => 'code-123') as any;
    mocks.buildSuccessRedirect = (() => successRedirect) as any;

    const response = await callAuthorize(baseBody, env);

    assertEquals(response.status, 302);
    assertEquals(response.headers.get('location'), successRedirect);

    assertSpyCallArgs(mocks.validateAuthorizationRequest, 0, [env.DB, {
      response_type: 'code',
      client_id: 'tampered-client',
      redirect_uri: 'https://attacker.example/callback',
      scope: 'openid profile',
      state: 'raw-state',
      code_challenge: 'raw-challenge',
      code_challenge_method: 'S256',
    }]);

    assertSpyCallArgs(mocks.grantConsent, 0, [
      env.DB,
      'user-1',
      'client-normalized',
      ['openid', 'profile']
    ]);

    assertSpyCallArgs(mocks.generateAuthorizationCode, 0, [env.DB, {
      clientId: 'client-normalized',
      userId: 'user-1',
      redirectUri: 'https://trusted.example/callback',
      scope: 'openid profile',
      codeChallenge: 'raw-challenge',
      codeChallengeMethod: 'S256',
    }]);

    assertSpyCallArgs(mocks.buildSuccessRedirect, 0, [
      'https://trusted.example/callback',
      'raw-state',
      'code-123'
    ]);

    const issued = mocks.generateAuthorizationCode.calls[0]?.[1];
    assertNotEquals(issued.clientId, baseBody.client_id);
    assertNotEquals(issued.redirectUri, baseBody.redirect_uri);
})