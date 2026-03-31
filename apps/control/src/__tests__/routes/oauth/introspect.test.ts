import type { Env } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = {
  const validateClientCredentials = ((..._args: any[]) => undefined) as any;
  const verifyAccessToken = ((..._args: any[]) => undefined) as any;
  const isAccessTokenValid = ((..._args: any[]) => undefined) as any;
  const getRefreshToken = ((..._args: any[]) => undefined) as any;
  const oauthRateLimiter = () => ({
    middleware: () => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    },
  });

  return {
    validateClientCredentials,
    verifyAccessToken,
    isAccessTokenValid,
    getRefreshToken,
    oauthRateLimiter,
  };
};

// [Deno] vi.mock removed - manually stub imports from '@/services/oauth/client'
// [Deno] vi.mock removed - manually stub imports from '@/services/oauth/token'
// [Deno] vi.mock removed - manually stub imports from '@/utils/rate-limiter'
import oauthIntrospect from '@/routes/oauth/introspect';

function createEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return createMockEnv({
    ADMIN_DOMAIN: 'admin.takos.test',
    PLATFORM_PUBLIC_KEY: 'test-public-key',
    ...overrides,
  }) as unknown as Env;
}

async function callIntrospect(
  body: { token: string; client_id: string; client_secret?: string },
  env: Env = createEnv()
): Promise<Response> {
  const params = new URLSearchParams({
    token: body.token,
    client_id: body.client_id,
  });

  if (body.client_secret !== undefined) {
    params.set('client_secret', body.client_secret);
  }

  return oauthIntrospect.fetch(
    new Request('http://localhost/introspect', {
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


  Deno.test('oauth introspect client ownership regression (issue 009) - returns active:false when access token belongs to another client', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.validateClientCredentials = (async () => ({ valid: true })) as any;
    mocks.verifyAccessToken = (async () => null) as any;
    mocks.isAccessTokenValid = (async () => false) as any;
    mocks.getRefreshToken = (async () => null) as any;
  mocks.verifyAccessToken = (async () => ({
      iss: 'https://admin.takos.test',
      sub: 'user-1',
      aud: 'client-a',
      exp: 9999999999,
      iat: 1700000000,
      jti: 'jti-1',
      scope: 'openid profile',
      client_id: 'client-a',
    })) as any;

    const response = await callIntrospect({
      token: 'access-token',
      client_id: 'client-b',
      client_secret: 'secret-b',
    });

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { active: false });
    assertSpyCallArgs(mocks.verifyAccessToken, 0, [
      ({
        expectedAudience: 'client-b',
      })
    ]);
    assertSpyCalls(mocks.isAccessTokenValid, 0);
    assertSpyCalls(mocks.getRefreshToken, 0);
})
  Deno.test('oauth introspect client ownership regression (issue 009) - returns active:false when refresh token belongs to another client', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.validateClientCredentials = (async () => ({ valid: true })) as any;
    mocks.verifyAccessToken = (async () => null) as any;
    mocks.isAccessTokenValid = (async () => false) as any;
    mocks.getRefreshToken = (async () => null) as any;
  mocks.verifyAccessToken = (async () => null) as any;
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

    const response = await callIntrospect({
      token: 'refresh-token',
      client_id: 'client-b',
      client_secret: 'secret-b',
    });

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { active: false });
    assertSpyCalls(mocks.isAccessTokenValid, 0);
})
  Deno.test('oauth introspect client ownership regression (issue 009) - can return active:true when access token belongs to the authenticated client', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.validateClientCredentials = (async () => ({ valid: true })) as any;
    mocks.verifyAccessToken = (async () => null) as any;
    mocks.isAccessTokenValid = (async () => false) as any;
    mocks.getRefreshToken = (async () => null) as any;
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
    mocks.isAccessTokenValid = (async () => true) as any;

    const response = await callIntrospect({
      token: 'access-token',
      client_id: 'client-a',
      client_secret: 'secret-a',
    });

    assertEquals(response.status, 200);
    await assertObjectMatch(await response.json(), {
      active: true,
      client_id: 'client-a',
      token_type: 'Bearer',
      sub: 'user-1',
      scope: 'openid profile',
      jti: 'jti-1',
    });
    assertSpyCalls(mocks.getRefreshToken, 0);
})