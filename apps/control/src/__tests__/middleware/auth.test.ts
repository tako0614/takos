import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSessionIdFromCookie: vi.fn(),
  getCachedUser: vi.fn(),
  isValidUserId: vi.fn(),
  validateTakosPersonalAccessToken: vi.fn(),
}));

vi.mock('@/services/identity/session', async () => {
  const actual = await vi.importActual<typeof import('@/services/identity/session')>('@/services/identity/session');
  return {
    ...actual,
    getSession: mocks.getSession,
    getSessionIdFromCookie: mocks.getSessionIdFromCookie,
  };
});

vi.mock('@/utils/user-cache', async () => {
  const actual = await vi.importActual<typeof import('@/utils/user-cache')>('@/utils/user-cache');
  return {
    ...actual,
    getCachedUser: mocks.getCachedUser,
    isValidUserId: mocks.isValidUserId,
  };
});

vi.mock('@/services/identity/takos-access-tokens', async () => {
  const actual = await vi.importActual<typeof import('@/services/identity/takos-access-tokens')>('@/services/identity/takos-access-tokens');
  return {
    ...actual,
    validateTakosPersonalAccessToken: mocks.validateTakosPersonalAccessToken,
  };
});

import { optionalAuth, requireAuth } from '@/middleware/auth';

type TestVars = { user?: User };
type TestEnv = { Bindings: Env; Variables: TestVars };

function createApp() {
  const app = new Hono<TestEnv>();
  app.use('*', requireAuth);
  app.get('/api/me', (c) => c.json({ ok: true, user_id: c.get('user')?.id ?? null }));
  return app;
}

function createOptionalApp() {
  const app = new Hono<TestEnv>();
  app.use('*', optionalAuth);
  app.get('/api/repos', (c) => c.json({ ok: true, user_id: c.get('user')?.id ?? null }));
  return app;
}

describe('requireAuth hardening (issue 182)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionIdFromCookie.mockReturnValue(null);
    mocks.getSession.mockResolvedValue(null);
    mocks.getCachedUser.mockResolvedValue(null);
    mocks.isValidUserId.mockReturnValue(true);
    mocks.validateTakosPersonalAccessToken.mockResolvedValue(null);
  });

  it('rejects malformed bearer tokens before session lookup', async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer malformed.token.value' },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'OAuth bearer token is not supported on this endpoint. Use OAuth-protected routes.',
    });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getCachedUser).not.toHaveBeenCalled();
  });

  it('accepts valid PAT bearer tokens', async () => {
    const env = createMockEnv();

    const app = createApp();
    mocks.validateTakosPersonalAccessToken.mockResolvedValue({
      userId: 'user-1',
      scopes: ['repo:read'],
      tokenKind: 'personal',
    });
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
    mocks.getCachedUser.mockResolvedValue(resolvedUser);

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer tak_pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, user_id: 'user-1' });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.validateTakosPersonalAccessToken).toHaveBeenCalledWith(env.DB, 'tak_pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('rejects managed built-in bearer tokens on session/PAT auth routes', async () => {
    const env = createMockEnv();

    const app = createApp();
    mocks.validateTakosPersonalAccessToken.mockResolvedValue(null);

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer tak_pat_managed_token_1234567890' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_token',
      error_description: 'Invalid or expired PAT',
    });
    expect(mocks.validateTakosPersonalAccessToken).toHaveBeenCalledWith(env.DB, 'tak_pat_managed_token_1234567890');
    expect(mocks.getCachedUser).not.toHaveBeenCalled();
  });

  it('accepts dotted PAT bearer tokens and skips OAuth-dot rejection', async () => {
    const env = createMockEnv();

    const app = createApp();
    mocks.validateTakosPersonalAccessToken.mockResolvedValue({
      userId: 'user-1',
      scopes: ['repo:read'],
      tokenKind: 'personal',
    });
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
    mocks.getCachedUser.mockResolvedValue(resolvedUser);

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer tak_pat_xxxxx.xxxxx.xxxxx' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, user_id: 'user-1' });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.validateTakosPersonalAccessToken).toHaveBeenCalledWith(env.DB, 'tak_pat_xxxxx.xxxxx.xxxxx');
  });

  it('rejects invalid PAT bearer tokens', async () => {
    const env = createMockEnv();

    const app = createApp();

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer tak_pat_invalid' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'invalid_token',
      error_description: 'Invalid or expired PAT',
    });
    expect(mocks.validateTakosPersonalAccessToken).toHaveBeenCalledWith(env.DB, 'tak_pat_invalid');
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getCachedUser).not.toHaveBeenCalled();
  });

  it('rejects non-PAT bearer tokens as unauthorized session credentials', async () => {
    const app = createApp();

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer short' },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required', code: 'UNAUTHORIZED' });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getCachedUser).not.toHaveBeenCalled();
  });

  it('treats malformed session payload as expired', async () => {
    const app = createApp();
    mocks.getSession.mockResolvedValue({
      id: 'valid_session_token_1234',
      user_id: 'x'.repeat(500),
      expires_at: Date.now() + 60_000,
      created_at: Date.now(),
    });
    mocks.isValidUserId.mockReturnValue(false);

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer valid_session_token_1234' },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Session expired', code: 'UNAUTHORIZED' });
    expect(mocks.getCachedUser).not.toHaveBeenCalled();
  });

  it('passes through when session and user are valid', async () => {
    const app = createApp();
    mocks.getSession.mockResolvedValue({
      id: 'valid_session_token_1234',
      user_id: 'user-1',
      expires_at: Date.now() + 60_000,
      created_at: Date.now(),
    });
    mocks.isValidUserId.mockReturnValue(true);
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
    mocks.getCachedUser.mockImplementation(async (c) => {
      c.set('user', resolvedUser);
      return resolvedUser;
    });

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer valid_session_token_1234' },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, user_id: 'user-1' });
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    expect(mocks.getCachedUser).toHaveBeenCalledWith(expect.anything(), 'user-1');
  });

  it('optionalAuth resolves valid PAT bearer tokens', async () => {
    const env = createMockEnv();
    const app = createOptionalApp();
    mocks.validateTakosPersonalAccessToken.mockResolvedValue({
      userId: 'user-1',
      scopes: ['repos:read'],
      tokenKind: 'personal',
    });

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
    mocks.getCachedUser.mockResolvedValue(resolvedUser);

    const response = await app.fetch(
      new Request('https://takos.jp/api/repos', {
        headers: { Authorization: 'Bearer tak_pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, user_id: 'user-1' });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.validateTakosPersonalAccessToken).toHaveBeenCalledWith(env.DB, 'tak_pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('optionalAuth ignores managed built-in bearer tokens and keeps anonymous', async () => {
    const env = createMockEnv();
    const app = createOptionalApp();
    mocks.validateTakosPersonalAccessToken.mockResolvedValue(null);

    const response = await app.fetch(
      new Request('https://takos.jp/api/repos', {
        headers: { Authorization: 'Bearer tak_pat_managed_token_1234567890' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, user_id: null });
    expect(mocks.validateTakosPersonalAccessToken).toHaveBeenCalledWith(env.DB, 'tak_pat_managed_token_1234567890');
    expect(mocks.getCachedUser).not.toHaveBeenCalled();
  });

  it('optionalAuth ignores unsupported dotted bearer tokens and keeps anonymous', async () => {
    const app = createOptionalApp();

    const response = await app.fetch(
      new Request('https://takos.jp/api/repos', {
        headers: { Authorization: 'Bearer jwt.like.token' },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, user_id: null });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});
