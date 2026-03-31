import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getSession: ((..._args: any[]) => undefined) as any,
  getSessionIdFromCookie: ((..._args: any[]) => undefined) as any,
  getCachedUser: ((..._args: any[]) => undefined) as any,
  isValidUserId: ((..._args: any[]) => undefined) as any,
  validateTakosPersonalAccessToken: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/identity/session'
// [Deno] vi.mock removed - manually stub imports from '@/utils/user-cache'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/takos-access-tokens'
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


  Deno.test('requireAuth hardening (issue 182) - rejects malformed bearer tokens before session lookup', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getSessionIdFromCookie = (() => null) as any;
    mocks.getSession = (async () => null) as any;
    mocks.getCachedUser = (async () => null) as any;
    mocks.isValidUserId = (() => true) as any;
    mocks.validateTakosPersonalAccessToken = (async () => null) as any;
  const app = createApp();

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer malformed.token.value' },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 401);
    await assertEquals(await response.json(), {
      error: 'OAuth bearer token is not supported on this endpoint. Use OAuth-protected routes.',
    });
    assertSpyCalls(mocks.getSession, 0);
    assertSpyCalls(mocks.getCachedUser, 0);
})
  Deno.test('requireAuth hardening (issue 182) - accepts valid PAT bearer tokens', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getSessionIdFromCookie = (() => null) as any;
    mocks.getSession = (async () => null) as any;
    mocks.getCachedUser = (async () => null) as any;
    mocks.isValidUserId = (() => true) as any;
    mocks.validateTakosPersonalAccessToken = (async () => null) as any;
  const env = createMockEnv();

    const app = createApp();
    mocks.validateTakosPersonalAccessToken = (async () => ({
      userId: 'user-1',
      scopes: ['repo:read'],
      tokenKind: 'personal',
    })) as any;
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
    mocks.getCachedUser = (async () => resolvedUser) as any;

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer tak_pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { ok: true, user_id: 'user-1' });
    assertSpyCalls(mocks.getSession, 0);
    assertSpyCallArgs(mocks.validateTakosPersonalAccessToken, 0, [env.DB, 'tak_pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
})
  Deno.test('requireAuth hardening (issue 182) - rejects managed built-in bearer tokens on session/PAT auth routes', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getSessionIdFromCookie = (() => null) as any;
    mocks.getSession = (async () => null) as any;
    mocks.getCachedUser = (async () => null) as any;
    mocks.isValidUserId = (() => true) as any;
    mocks.validateTakosPersonalAccessToken = (async () => null) as any;
  const env = createMockEnv();

    const app = createApp();
    mocks.validateTakosPersonalAccessToken = (async () => null) as any;

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer tak_pat_managed_token_1234567890' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 401);
    await assertEquals(await response.json(), {
      error: 'invalid_token',
      error_description: 'Invalid or expired PAT',
    });
    assertSpyCallArgs(mocks.validateTakosPersonalAccessToken, 0, [env.DB, 'tak_pat_managed_token_1234567890']);
    assertSpyCalls(mocks.getCachedUser, 0);
})
  Deno.test('requireAuth hardening (issue 182) - accepts dotted PAT bearer tokens and skips OAuth-dot rejection', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getSessionIdFromCookie = (() => null) as any;
    mocks.getSession = (async () => null) as any;
    mocks.getCachedUser = (async () => null) as any;
    mocks.isValidUserId = (() => true) as any;
    mocks.validateTakosPersonalAccessToken = (async () => null) as any;
  const env = createMockEnv();

    const app = createApp();
    mocks.validateTakosPersonalAccessToken = (async () => ({
      userId: 'user-1',
      scopes: ['repo:read'],
      tokenKind: 'personal',
    })) as any;
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
    mocks.getCachedUser = (async () => resolvedUser) as any;

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer tak_pat_xxxxx.xxxxx.xxxxx' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { ok: true, user_id: 'user-1' });
    assertSpyCalls(mocks.getSession, 0);
    assertSpyCallArgs(mocks.validateTakosPersonalAccessToken, 0, [env.DB, 'tak_pat_xxxxx.xxxxx.xxxxx']);
})
  Deno.test('requireAuth hardening (issue 182) - rejects invalid PAT bearer tokens', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getSessionIdFromCookie = (() => null) as any;
    mocks.getSession = (async () => null) as any;
    mocks.getCachedUser = (async () => null) as any;
    mocks.isValidUserId = (() => true) as any;
    mocks.validateTakosPersonalAccessToken = (async () => null) as any;
  const env = createMockEnv();

    const app = createApp();

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer tak_pat_invalid' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 401);
    await assertEquals(await response.json(), {
      error: 'invalid_token',
      error_description: 'Invalid or expired PAT',
    });
    assertSpyCallArgs(mocks.validateTakosPersonalAccessToken, 0, [env.DB, 'tak_pat_invalid']);
    assertSpyCalls(mocks.getSession, 0);
    assertSpyCalls(mocks.getCachedUser, 0);
})
  Deno.test('requireAuth hardening (issue 182) - rejects non-PAT bearer tokens as unauthorized session credentials', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getSessionIdFromCookie = (() => null) as any;
    mocks.getSession = (async () => null) as any;
    mocks.getCachedUser = (async () => null) as any;
    mocks.isValidUserId = (() => true) as any;
    mocks.validateTakosPersonalAccessToken = (async () => null) as any;
  const app = createApp();

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer short' },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 401);
    await assertEquals(await response.json(), { error: 'Authentication required', code: 'UNAUTHORIZED' });
    assertSpyCalls(mocks.getSession, 0);
    assertSpyCalls(mocks.getCachedUser, 0);
})
  Deno.test('requireAuth hardening (issue 182) - treats malformed session payload as expired', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getSessionIdFromCookie = (() => null) as any;
    mocks.getSession = (async () => null) as any;
    mocks.getCachedUser = (async () => null) as any;
    mocks.isValidUserId = (() => true) as any;
    mocks.validateTakosPersonalAccessToken = (async () => null) as any;
  const app = createApp();
    mocks.getSession = (async () => ({
      id: 'valid_session_token_1234',
      user_id: 'x'.repeat(500),
      expires_at: Date.now() + 60_000,
      created_at: Date.now(),
    })) as any;
    mocks.isValidUserId = (() => false) as any;

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer valid_session_token_1234' },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 401);
    await assertEquals(await response.json(), { error: 'Session expired', code: 'UNAUTHORIZED' });
    assertSpyCalls(mocks.getCachedUser, 0);
})
  Deno.test('requireAuth hardening (issue 182) - passes through when session and user are valid', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getSessionIdFromCookie = (() => null) as any;
    mocks.getSession = (async () => null) as any;
    mocks.getCachedUser = (async () => null) as any;
    mocks.isValidUserId = (() => true) as any;
    mocks.validateTakosPersonalAccessToken = (async () => null) as any;
  const app = createApp();
    mocks.getSession = (async () => ({
      id: 'valid_session_token_1234',
      user_id: 'user-1',
      expires_at: Date.now() + 60_000,
      created_at: Date.now(),
    })) as any;
    mocks.isValidUserId = (() => true) as any;
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
    mocks.getCachedUser = async (c) => {
      c.set('user', resolvedUser);
      return resolvedUser;
    } as any;

    const response = await app.fetch(
      new Request('https://takos.jp/api/me', {
        headers: { Authorization: 'Bearer valid_session_token_1234' },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { ok: true, user_id: 'user-1' });
    assertSpyCalls(mocks.getSession, 1);
    assertSpyCallArgs(mocks.getCachedUser, 0, [expect.anything(), 'user-1']);
})
  Deno.test('requireAuth hardening (issue 182) - optionalAuth resolves valid PAT bearer tokens', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getSessionIdFromCookie = (() => null) as any;
    mocks.getSession = (async () => null) as any;
    mocks.getCachedUser = (async () => null) as any;
    mocks.isValidUserId = (() => true) as any;
    mocks.validateTakosPersonalAccessToken = (async () => null) as any;
  const env = createMockEnv();
    const app = createOptionalApp();
    mocks.validateTakosPersonalAccessToken = (async () => ({
      userId: 'user-1',
      scopes: ['repos:read'],
      tokenKind: 'personal',
    })) as any;

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
    mocks.getCachedUser = (async () => resolvedUser) as any;

    const response = await app.fetch(
      new Request('https://takos.jp/api/repos', {
        headers: { Authorization: 'Bearer tak_pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { ok: true, user_id: 'user-1' });
    assertSpyCalls(mocks.getSession, 0);
    assertSpyCallArgs(mocks.validateTakosPersonalAccessToken, 0, [env.DB, 'tak_pat_aaaaaaaaaaaaaaaaaaaaaaaaaaaa']);
})
  Deno.test('requireAuth hardening (issue 182) - optionalAuth ignores managed built-in bearer tokens and keeps anonymous', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getSessionIdFromCookie = (() => null) as any;
    mocks.getSession = (async () => null) as any;
    mocks.getCachedUser = (async () => null) as any;
    mocks.isValidUserId = (() => true) as any;
    mocks.validateTakosPersonalAccessToken = (async () => null) as any;
  const env = createMockEnv();
    const app = createOptionalApp();
    mocks.validateTakosPersonalAccessToken = (async () => null) as any;

    const response = await app.fetch(
      new Request('https://takos.jp/api/repos', {
        headers: { Authorization: 'Bearer tak_pat_managed_token_1234567890' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { ok: true, user_id: null });
    assertSpyCallArgs(mocks.validateTakosPersonalAccessToken, 0, [env.DB, 'tak_pat_managed_token_1234567890']);
    assertSpyCalls(mocks.getCachedUser, 0);
})
  Deno.test('requireAuth hardening (issue 182) - optionalAuth ignores unsupported dotted bearer tokens and keeps anonymous', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getSessionIdFromCookie = (() => null) as any;
    mocks.getSession = (async () => null) as any;
    mocks.getCachedUser = (async () => null) as any;
    mocks.isValidUserId = (() => true) as any;
    mocks.validateTakosPersonalAccessToken = (async () => null) as any;
  const app = createOptionalApp();

    const response = await app.fetch(
      new Request('https://takos.jp/api/repos', {
        headers: { Authorization: 'Bearer jwt.like.token' },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { ok: true, user_id: null });
    assertSpyCalls(mocks.getSession, 0);
})