import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';
import { requireOAuthAuth } from '@/middleware/oauth-auth';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getCachedUser: ((..._args: any[]) => undefined) as any,
  validateTakosAccessToken: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/utils/user-cache'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/takos-access-tokens'
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


  Deno.test('requireOAuthAuth PAT scope validation - rejects PAT with invalid JSON scopes', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.validateTakosAccessToken = (async () => null) as any;
    const env = createMockEnv();

    const app = createApp();

    const response = await app.fetch(
      new Request('https://takos.jp/protected', {
        headers: { Authorization: 'Bearer tak_pat_malformed_scopes' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 401);
    await assertEquals(await response.json(), {
      error: 'invalid_token',
      error_description: 'Invalid or expired PAT',
    });
    assertSpyCalls(mocks.getCachedUser, 0);
    assertSpyCalls(mocks.validateTakosAccessToken, 1);
})
  Deno.test('requireOAuthAuth PAT scope validation - accepts PAT with valid scopes and required scope present', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.validateTakosAccessToken = (async () => ({
      userId: 'user-1',
      scopes: ['repo:read', 'repo:write'],
      tokenKind: 'personal',
    })) as any;
    mocks.getCachedUser = (async () => resolvedUser) as any;
    const env = createMockEnv();

    const app = createApp();

    const response = await app.fetch(
      new Request('https://takos.jp/protected', {
        headers: { Authorization: 'Bearer tak_pat_valid_scope' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { ok: true, userId: 'user-1' });
    assertSpyCalls(mocks.getCachedUser, 1);
})
  Deno.test('requireOAuthAuth PAT scope validation - accepts managed built-in token with valid scopes', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.validateTakosAccessToken = (async () => ({
      userId: 'user-1',
      scopes: ['repo:read', 'repo:write'],
      tokenKind: 'managed_builtin',
    })) as any;
    mocks.getCachedUser = (async () => resolvedUser) as any;
    const env = createMockEnv();

    const app = createApp();

    const response = await app.fetch(
      new Request('https://takos.jp/protected', {
        headers: { Authorization: 'Bearer tak_pat_managed_scope_token' },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), { ok: true, userId: 'user-1' });
})
  Deno.test('requireOAuthAuth PAT scope validation - rejects PAT when required scope missing', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.validateTakosAccessToken = (async () => null) as any;
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

    assertEquals(response.status, 401);
    await assertEquals(await response.json(), {
      error: 'invalid_token',
      error_description: 'Invalid or expired PAT',
    });
    assertSpyCalls(mocks.getCachedUser, 0);
})