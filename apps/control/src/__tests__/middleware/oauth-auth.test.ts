import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';
import { requireOAuthAuth } from '@/middleware/oauth-auth';

const mocks = vi.hoisted(() => ({
  getCachedUser: vi.fn(),
  validateTakosAccessToken: vi.fn(),
}));

vi.mock('@/utils/user-cache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/user-cache')>();
  return {
    ...actual,
    getCachedUser: mocks.getCachedUser,
  };
});

vi.mock('@/services/identity/takos-access-tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/identity/takos-access-tokens')>();
  return {
    ...actual,
    validateTakosAccessToken: mocks.validateTakosAccessToken,
  };
});

type TestVars = {
  user?: User;
  oauth?: { userId: string; clientId: string; scope: string; scopes: string[] };
};
type TestEnv = { Bindings: Env; Variables: TestVars };

function createApp() {
  const app = new Hono<TestEnv>();
  app.get('/protected', requireOAuthAuth(), (c) => c.json({ ok: true, userId: c.get('oauth')?.userId }));
  return app;
}

const resolvedUser: User = {
  id: 'user-1',
  email: 'user1@example.com',
  name: 'User1',
  username: 'user1',
  bio: null,
  picture: null,
  trust_tier: 'normal',
  setup_completed: true,
  created_at: '2026-02-13T00:00:00.000Z',
  updated_at: '2026-02-13T00:00:00.000Z',
};

describe('requireOAuthAuth PAT scope validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects PAT with invalid JSON scopes', async () => {
    mocks.validateTakosAccessToken.mockResolvedValue(null);
    const env = createMockEnv();

    const app = createApp();

    const response = await app.fetch(
      new Request('https://takos.jp/protected', {
        headers: { Authorization: 'Bearer tak_pat_malformed_scopes' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_token',
      error_description: 'Invalid or expired PAT',
    });
    expect(mocks.getCachedUser).not.toHaveBeenCalled();
    expect(mocks.validateTakosAccessToken).toHaveBeenCalledTimes(1);
  });

  it('accepts PAT with valid scopes and required scope present', async () => {
    mocks.validateTakosAccessToken.mockResolvedValue({
      userId: 'user-1',
      scopes: ['repo:read', 'repo:write'],
      tokenKind: 'personal',
    });
    mocks.getCachedUser.mockResolvedValue(resolvedUser);
    const env = createMockEnv();

    const app = createApp();

    const response = await app.fetch(
      new Request('https://takos.jp/protected', {
        headers: { Authorization: 'Bearer tak_pat_valid_scope' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, userId: 'user-1' });
    expect(mocks.getCachedUser).toHaveBeenCalledTimes(1);
  });

  it('accepts managed built-in token with valid scopes', async () => {
    mocks.validateTakosAccessToken.mockResolvedValue({
      userId: 'user-1',
      scopes: ['repo:read', 'repo:write'],
      tokenKind: 'managed_builtin',
    });
    mocks.getCachedUser.mockResolvedValue(resolvedUser);
    const env = createMockEnv();

    const app = createApp();

    const response = await app.fetch(
      new Request('https://takos.jp/protected', {
        headers: { Authorization: 'Bearer tak_pat_managed_scope_token' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, userId: 'user-1' });
  });

  it('rejects PAT when required scope missing', async () => {
    mocks.validateTakosAccessToken.mockResolvedValue(null);
    const env = createMockEnv();

    const app = new Hono<TestEnv>();
    app.get('/protected', requireOAuthAuth(['repo:write']), (c) => c.json({ ok: true }));

    const response = await app.fetch(
      new Request('https://takos.jp/protected', {
        headers: { Authorization: 'Bearer tak_pat_missing_scope' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_token',
      error_description: 'Invalid or expired PAT',
    });
    expect(mocks.getCachedUser).not.toHaveBeenCalled();
  });
});
