import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => {
  const validateClientCredentials = vi.fn();
  const verifyAccessToken = vi.fn();
  const isAccessTokenValid = vi.fn();
  const getRefreshToken = vi.fn();
  const oauthRateLimiter = vi.fn(() => ({
    middleware: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    }),
  }));

  return {
    validateClientCredentials,
    verifyAccessToken,
    isAccessTokenValid,
    getRefreshToken,
    oauthRateLimiter,
  };
});

vi.mock('@/services/oauth/client', () => ({
  validateClientCredentials: mocks.validateClientCredentials,
}));

vi.mock('@/services/oauth/token', () => ({
  verifyAccessToken: mocks.verifyAccessToken,
  isAccessTokenValid: mocks.isAccessTokenValid,
  getRefreshToken: mocks.getRefreshToken,
}));

vi.mock('@/utils/rate-limiter', () => ({
  RateLimiters: {
    oauth: mocks.oauthRateLimiter,
    oauthToken: mocks.oauthRateLimiter,
  },
}));

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

describe('oauth introspect client ownership regression (issue 009)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateClientCredentials.mockResolvedValue({ valid: true });
    mocks.verifyAccessToken.mockResolvedValue(null);
    mocks.isAccessTokenValid.mockResolvedValue(false);
    mocks.getRefreshToken.mockResolvedValue(null);
  });

  it('returns active:false when access token belongs to another client', async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      iss: 'https://admin.takos.test',
      sub: 'user-1',
      aud: 'client-a',
      exp: 9999999999,
      iat: 1700000000,
      jti: 'jti-1',
      scope: 'openid profile',
      client_id: 'client-a',
    });

    const response = await callIntrospect({
      token: 'access-token',
      client_id: 'client-b',
      client_secret: 'secret-b',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ active: false });
    expect(mocks.verifyAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedAudience: 'client-b',
      })
    );
    expect(mocks.isAccessTokenValid).not.toHaveBeenCalled();
    expect(mocks.getRefreshToken).not.toHaveBeenCalled();
  });

  it('returns active:false when refresh token belongs to another client', async () => {
    mocks.verifyAccessToken.mockResolvedValue(null);
    mocks.getRefreshToken.mockResolvedValue({
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
    });

    const response = await callIntrospect({
      token: 'refresh-token',
      client_id: 'client-b',
      client_secret: 'secret-b',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ active: false });
    expect(mocks.isAccessTokenValid).not.toHaveBeenCalled();
  });

  it('can return active:true when access token belongs to the authenticated client', async () => {
    mocks.verifyAccessToken.mockResolvedValue({
      iss: 'https://admin.takos.test',
      sub: 'user-1',
      aud: 'client-a',
      exp: 1999999999,
      iat: 1700000000,
      jti: 'jti-1',
      scope: 'openid profile',
      client_id: 'client-a',
    });
    mocks.isAccessTokenValid.mockResolvedValue(true);

    const response = await callIntrospect({
      token: 'access-token',
      client_id: 'client-a',
      client_secret: 'secret-a',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      active: true,
      client_id: 'client-a',
      token_type: 'Bearer',
      sub: 'user-1',
      scope: 'openid profile',
      jti: 'jti-1',
    });
    expect(mocks.getRefreshToken).not.toHaveBeenCalled();
  });
});
