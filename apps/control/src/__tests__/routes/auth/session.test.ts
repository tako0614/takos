import type { Env } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup';

import { assertEquals, assert } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  createSession: ((..._args: any[]) => undefined) as any,
  deleteSession: ((..._args: any[]) => undefined) as any,
  setSessionCookie: ((..._args: any[]) => undefined) as any,
  clearSessionCookie: ((..._args: any[]) => undefined) as any,
  getSessionIdFromCookie: ((..._args: any[]) => undefined) as any,
  storeOAuthState: ((..._args: any[]) => undefined) as any,
  validateOAuthState: ((..._args: any[]) => undefined) as any,
  auditLog: ((..._args: any[]) => undefined) as any,
  createAuthSession: ((..._args: any[]) => undefined) as any,
  cleanupUserSessions: ((..._args: any[]) => undefined) as any,
  getDb: ((..._args: any[]) => undefined) as any,
  provisionGoogleOAuthUser: ((..._args: any[]) => undefined) as any,
  sanitizeReturnTo: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/identity/session'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/auth-utils'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/routes/auth/provisioning'
import { authSessionRouter } from '@/routes/auth/session';

function createEnv(): Env {
  return createMockEnv({
    ADMIN_DOMAIN: 'test.takos.jp',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    ENCRYPTION_KEY: 'test-encryption-key',
  }) as unknown as Env;
}


  Deno.test('auth session Google OAuth signup - auto-provisions a new user instead of rejecting first-time Google login', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

    mocks.validateOAuthState = (async () => ({
      valid: true,
      returnTo: '/chat/me',
    })) as any;
    mocks.sanitizeReturnTo = (() => '/') as any;
    mocks.createSession = (async () => ({
      id: 'session-1',
      user_id: 'user-1',
      created_at: Date.now(),
      expires_at: Date.now() + 1000,
    })) as any;
    mocks.setSessionCookie = (() => '__Host-tp_session=session-1') as any;
    mocks.createAuthSession = (async () => ({
      token: 'auth-session-token',
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    })) as any;
    mocks.cleanupUserSessions = (async () => undefined) as any;
    mocks.auditLog = (async () => undefined) as any;

    (globalThis as any).fetch = async (input: RequestInfo | URL => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === 'https://oauth2.googleapis.com/token') {
        return new Response(JSON.stringify({
          access_token: 'google-access-token',
          refresh_token: 'google-refresh-token',
          expires_in: 3600,
          id_token: 'google-id-token',
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url === 'https://www.googleapis.com/oauth2/v2/userinfo') {
        return new Response(JSON.stringify({
          id: 'google-user-1',
          email: 'new-user@example.com',
          name: 'New User',
          picture: 'https://example.com/avatar.png',
          verified_email: true,
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
  // The production code uses Drizzle chains:
    //   db.select().from(authIdentities).where(...).get() -> null (no identity)
    //   provisionGoogleOAuthUser() -> new user
    //   db.insert(authIdentities).values({...})
    const insertValues = (async () => undefined);
    const selectGet = (async () => null);
    const chain: Record<string, unknown> = {};
    chain.from = (() => chain);
    chain.where = (() => chain);
    chain.get = selectGet;
    chain.all = (async () => []);

    const mockDb = {
      select: (() => chain),
      insert: (() => ({ values: insertValues })),
      update: (() => ({ set: (() => ({ where: (async () => undefined) })) })),
    };
    mocks.getDb = (() => mockDb) as any;

    mocks.provisionGoogleOAuthUser = (async () => ({
      id: 'new-user-id',
      email: 'new-user@example.com',
      name: 'New User',
      username: 'new-user',
      bio: null,
      picture: 'https://example.com/avatar.png',
      trust_tier: 'normal',
      setup_completed: false,
      created_at: '2026-03-13T00:00:00.000Z',
      updated_at: '2026-03-13T00:00:00.000Z',
    })) as any;

    const app = authSessionRouter;

    const response = await app.fetch(
      new Request('https://test.takos.jp/callback?code=oauth-code&state=oauth-state'),
      createEnv(),
      {} as ExecutionContext,
    );

    assertEquals(response.status, 302);
    assertEquals(response.headers.get('location'), '/setup');
    assertEquals(response.headers.get('set-cookie'), '__Host-tp_session=session-1');

    // Verify DB was used to look up existing user by auth identity (select queries)
    assert(mockDb.select.calls.length > 0);
    // Verify new user was provisioned via provisionGoogleOAuthUser
    assertSpyCallArgs(mocks.provisionGoogleOAuthUser, 0, [
      expect.anything(),
      ({ email: 'new-user@example.com' }),
    ]);
    // Verify auth identity was created via insert
    assert(mockDb.insert.calls.length > 0);
    assertSpyCallArgs(mocks.auditLog, 0, [
      'oauth_success',
      ({ email: 'new-user@example.com' }),
    ]);
})