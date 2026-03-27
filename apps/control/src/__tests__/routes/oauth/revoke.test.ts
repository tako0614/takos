import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => {
  const validateClientCredentials = vi.fn();
  const verifyAccessToken = vi.fn();
  const getRefreshToken = vi.fn();
  const revokeToken = vi.fn();
  const tryLogOAuthEvent = vi.fn();
  const oauthRevokeRateLimiter = vi.fn(() => ({
    middleware: vi.fn(() => async (_c: unknown, next: () => Promise<void>) => {
      await next();
    }),
  }));

  return {
    validateClientCredentials,
    verifyAccessToken,
    getRefreshToken,
    revokeToken,
    tryLogOAuthEvent,
    oauthRevokeRateLimiter,
  };
});

vi.mock('@/services/oauth/client', () => ({
  validateClientCredentials: mocks.validateClientCredentials,
}));

vi.mock('@/services/oauth/token', () => ({
  verifyAccessToken: mocks.verifyAccessToken,
  getRefreshToken: mocks.getRefreshToken,
  revokeToken: mocks.revokeToken,
}));

vi.mock('@/routes/oauth/request-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/routes/oauth/request-utils')>();
  return {
    ...actual,
    tryLogOAuthEvent: mocks.tryLogOAuthEvent,
  };
});

vi.mock('@/utils/rate-limiter', () => ({
  RateLimiters: {
    oauthRevoke: mocks.oauthRevokeRateLimiter,
  },
}));

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

describe('oauth revoke client ownership regression (issue 010)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.validateClientCredentials.mockResolvedValue({ valid: true });
    mocks.verifyAccessToken.mockResolvedValue(null);
    mocks.getRefreshToken.mockResolvedValue(null);
    mocks.revokeToken.mockResolvedValue(false);
    mocks.tryLogOAuthEvent.mockResolvedValue(undefined);
  });

  it('returns success without revoking when refresh token belongs to another client', async () => {
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

    const response = await callRevoke({
      token: 'refresh-token',
      token_type_hint: 'refresh_token',
      client_id: 'client-b',
      client_secret: 'secret-b',
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
    expect(mocks.revokeToken).not.toHaveBeenCalled();
    expect(mocks.tryLogOAuthEvent).not.toHaveBeenCalled();
  });

  it('returns success without revoking when access token belongs to another client', async () => {
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

    const response = await callRevoke({
      token: 'access-token',
      token_type_hint: 'access_token',
      client_id: 'client-b',
      client_secret: 'secret-b',
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
    expect(mocks.revokeToken).not.toHaveBeenCalled();
    expect(mocks.tryLogOAuthEvent).not.toHaveBeenCalled();
  });

  it('continues revoking when token belongs to authenticated client', async () => {
    const env = createEnv();
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
    mocks.revokeToken.mockResolvedValue(true);

    const response = await callRevoke(
      {
        token: 'refresh-token',
        token_type_hint: 'refresh_token',
        client_id: 'client-a',
        client_secret: 'secret-a',
      },
      env
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('');
    expect(mocks.revokeToken).toHaveBeenCalledWith(env.DB, 'refresh-token', 'refresh_token');
    expect(mocks.tryLogOAuthEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clientId: 'client-a',
        eventType: 'token_revoked',
      })
    );
  });
});
