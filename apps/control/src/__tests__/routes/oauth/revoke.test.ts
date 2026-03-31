import type { Env } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = {
  const validateClientCredentials = ((..._args: any[]) => undefined) as any;
  const verifyAccessToken = ((..._args: any[]) => undefined) as any;
  const getRefreshToken = ((..._args: any[]) => undefined) as any;
  const revokeToken = ((..._args: any[]) => undefined) as any;
  const tryLogOAuthEvent = ((..._args: any[]) => undefined) as any;
  const oauthRevokeRateLimiter = () => ({
    middleware: () => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    },
  });

  return {
    validateClientCredentials,
    verifyAccessToken,
    getRefreshToken,
    revokeToken,
    tryLogOAuthEvent,
    oauthRevokeRateLimiter,
  };
};

// [Deno] vi.mock removed - manually stub imports from '@/services/oauth/client'
// [Deno] vi.mock removed - manually stub imports from '@/services/oauth/token'
// [Deno] vi.mock removed - manually stub imports from '@/routes/oauth/request-utils'
// [Deno] vi.mock removed - manually stub imports from '@/utils/rate-limiter'
import oauthRevoke from '@/routes/oauth/revoke';

function createEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return createMockEnv({
    ADMIN_DOMAIN: 'admin.takos.test',
    PLATFORM_PUBLIC_KEY: 'test-public-key',
    ...overrides,
  }) as unknown as Env;
}

async function callRevoke(
  body: { token: string; client_id: string; client_secret?: string; token_type_hint?: string },
  env: Env = createEnv()
): Promise<Response> {
  const params = new URLSearchParams({
    token: body.token,
    client_id: body.client_id,
  });

  if (body.client_secret !== undefined) {
    params.set('client_secret', body.client_secret);
  }
  if (body.token_type_hint !== undefined) {
    params.set('token_type_hint', body.token_type_hint);
  }

  return oauthRevoke.fetch(
    new Request('http://localhost/revoke', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    }),
    env,
    {} as ExecutionContext
  );
}


  Deno.test('oauth revoke client ownership regression (issue 010) - returns success without revoking when refresh token belongs to another client', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.validateClientCredentials = (async () => ({ valid: true })) as any;
    mocks.verifyAccessToken = (async () => null) as any;
    mocks.getRefreshToken = (async () => null) as any;
    mocks.revokeToken = (async () => false) as any;
    mocks.tryLogOAuthEvent = (async () => undefined) as any;
  mocks.getRefreshToken = (async () => ({
      id: 'rt-1',
      token_type: 'refresh',
      token_hash: 'hash-1',
      client_id: 'client-a',
      user_id: 'user-1',
      scope: 'openid profile',
      refresh_token_id: null,
      revoked: false,
      revoked_at: null,
      revoked_reason: null,
      used_at: null,
      token_family: null,
      expires_at: '2099-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    })) as any;

    const response = await callRevoke({
      token: 'refresh-token',
      token_type_hint: 'refresh_token',
      client_id: 'client-b',
      client_secret: 'secret-b',
    });

    assertEquals(response.status, 200);
    await assertEquals(await response.text(), '');
    assertSpyCalls(mocks.revokeToken, 0);
    assertSpyCalls(mocks.tryLogOAuthEvent, 0);
})
  Deno.test('oauth revoke client ownership regression (issue 010) - returns success without revoking when access token belongs to another client', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.validateClientCredentials = (async () => ({ valid: true })) as any;
    mocks.verifyAccessToken = (async () => null) as any;
    mocks.getRefreshToken = (async () => null) as any;
    mocks.revokeToken = (async () => false) as any;
    mocks.tryLogOAuthEvent = (async () => undefined) as any;
  mocks.verifyAccessToken = (async () => ({
      iss: 'https://admin.takos.test',
      sub: 'user-1',
      aud: 'client-a',
      exp: 1999999999,
      iat: 1700000000,
      jti: 'jti-1',
      scope: 'openid profile',
      client_id: 'client-a',
    })) as any;

    const response = await callRevoke({
      token: 'access-token',
      token_type_hint: 'access_token',
      client_id: 'client-b',
      client_secret: 'secret-b',
    });

    assertEquals(response.status, 200);
    await assertEquals(await response.text(), '');
    assertSpyCalls(mocks.revokeToken, 0);
    assertSpyCalls(mocks.tryLogOAuthEvent, 0);
})
  Deno.test('oauth revoke client ownership regression (issue 010) - continues revoking when token belongs to authenticated client', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.validateClientCredentials = (async () => ({ valid: true })) as any;
    mocks.verifyAccessToken = (async () => null) as any;
    mocks.getRefreshToken = (async () => null) as any;
    mocks.revokeToken = (async () => false) as any;
    mocks.tryLogOAuthEvent = (async () => undefined) as any;
  const env = createEnv();
    mocks.getRefreshToken = (async () => ({
      id: 'rt-1',
      token_type: 'refresh',
      token_hash: 'hash-1',
      client_id: 'client-a',
      user_id: 'user-1',
      scope: 'openid profile',
      refresh_token_id: null,
      revoked: false,
      revoked_at: null,
      revoked_reason: null,
      used_at: null,
      token_family: null,
      expires_at: '2099-01-01T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    })) as any;
    mocks.revokeToken = (async () => true) as any;

    const response = await callRevoke(
      {
        token: 'refresh-token',
        token_type_hint: 'refresh_token',
        client_id: 'client-a',
        client_secret: 'secret-a',
      },
      env
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.text(), '');
    assertSpyCallArgs(mocks.revokeToken, 0, [env.DB, 'refresh-token', 'refresh_token']);
    assertSpyCallArgs(mocks.tryLogOAuthEvent, 0, [
      expect.anything(),
      ({
        clientId: 'client-a',
        eventType: 'token_revoked',
      })
    ]);
})