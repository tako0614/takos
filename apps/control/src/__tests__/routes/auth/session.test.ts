import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  setSessionCookie: vi.fn(),
  clearSessionCookie: vi.fn(),
  getSessionIdFromCookie: vi.fn(),
  storeOAuthState: vi.fn(),
  validateOAuthState: vi.fn(),
  auditLog: vi.fn(),
  createAuthSession: vi.fn(),
  cleanupUserSessions: vi.fn(),
  getDb: vi.fn(),
  provisionGoogleOAuthUser: vi.fn(),
  sanitizeReturnTo: vi.fn(),
}));

vi.mock('@/services/identity/session', () => ({
  createSession: mocks.createSession,
  deleteSession: mocks.deleteSession,
  setSessionCookie: mocks.setSessionCookie,
  clearSessionCookie: mocks.clearSessionCookie,
  getSessionIdFromCookie: mocks.getSessionIdFromCookie,
}));

vi.mock('@/services/identity/auth-utils', () => ({
  storeOAuthState: mocks.storeOAuthState,
  validateOAuthState: mocks.validateOAuthState,
  auditLog: mocks.auditLog,
  createAuthSession: mocks.createAuthSession,
  cleanupUserSessions: mocks.cleanupUserSessions,
}));

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/routes/auth/utils', () => ({
  sanitizeReturnTo: mocks.sanitizeReturnTo,
  provisionGoogleOAuthUser: mocks.provisionGoogleOAuthUser,
}));

import { authSessionRouter } from '@/routes/auth/session';

function createEnv(): Env {
  return createMockEnv({
    ADMIN_DOMAIN: 'test.takos.jp',
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    ENCRYPTION_KEY: 'test-encryption-key',
  }) as unknown as Env;
}

describe('auth session Google OAuth signup', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.validateOAuthState.mockResolvedValue({
      valid: true,
      returnTo: '/chat/me',
    });
    mocks.sanitizeReturnTo.mockReturnValue('/');
    mocks.createSession.mockResolvedValue({
      id: 'session-1',
      user_id: 'user-1',
      created_at: Date.now(),
      expires_at: Date.now() + 1000,
    });
    mocks.setSessionCookie.mockReturnValue('__Host-tp_session=session-1');
    mocks.createAuthSession.mockResolvedValue({
      token: 'auth-session-token',
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    mocks.cleanupUserSessions.mockResolvedValue(undefined);
    mocks.auditLog.mockResolvedValue(undefined);

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
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
    }));
  });

  it('auto-provisions a new user instead of rejecting first-time Google login', async () => {
    // The production code uses Drizzle chains:
    //   db.select().from(authIdentities).where(...).get() -> null (no identity)
    //   provisionGoogleOAuthUser() -> new user
    //   db.insert(authIdentities).values({...})
    const insertValues = vi.fn().mockResolvedValue(undefined);
    const selectGet = vi.fn().mockResolvedValue(null);
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.get = selectGet;
    chain.all = vi.fn().mockResolvedValue([]);

    const mockDb = {
      select: vi.fn().mockReturnValue(chain),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    };
    mocks.getDb.mockReturnValue(mockDb);

    mocks.provisionGoogleOAuthUser.mockResolvedValue({
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
    });

    const app = authSessionRouter;

    const response = await app.fetch(
      new Request('https://test.takos.jp/callback?code=oauth-code&state=oauth-state'),
      createEnv(),
      {} as ExecutionContext,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/setup');
    expect(response.headers.get('set-cookie')).toBe('__Host-tp_session=session-1');

    // Verify DB was used to look up existing user by auth identity (select queries)
    expect(mockDb.select).toHaveBeenCalled();
    // Verify new user was provisioned via provisionGoogleOAuthUser
    expect(mocks.provisionGoogleOAuthUser).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'new-user@example.com' }),
    );
    // Verify auth identity was created via insert
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mocks.auditLog).toHaveBeenCalledWith(
      'oauth_success',
      expect.objectContaining({ email: 'new-user@example.com' }),
    );
  });
});
