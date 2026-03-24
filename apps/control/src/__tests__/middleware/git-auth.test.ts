import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getCachedUser: vi.fn(),
  isValidUserId: vi.fn(),
  validateTakosPersonalAccessToken: vi.fn(),
}));

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

import { optionalGitAuth, requireGitAuth } from '@/middleware/git-auth';

type TestVars = { user?: User };
type TestEnv = { Bindings: Env; Variables: TestVars };

function encodeBasicAuth(password: string): string {
  return `Basic ${Buffer.from(`x-token-auth:${password}`).toString('base64')}`;
}

function createProtectedApp() {
  const app = new Hono<TestEnv>();
  app.use('*', requireGitAuth);
  app.get('/git/repo.git/git-receive-pack', (c) => c.text(c.get('user')?.id ?? 'missing'));
  return app;
}

function createOptionalApp() {
  const app = new Hono<TestEnv>();
  app.use('*', optionalGitAuth);
  app.get('/git/repo.git/info/refs', (c) => c.text(c.get('user')?.id ?? 'anonymous'));
  return app;
}

describe('git auth PAT hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCachedUser.mockResolvedValue(null);
    mocks.isValidUserId.mockReturnValue(true);
    mocks.validateTakosPersonalAccessToken.mockResolvedValue(null);
  });

  it('accepts personal access tokens', async () => {
    const env = createMockEnv();
    const app = createProtectedApp();
    mocks.validateTakosPersonalAccessToken.mockResolvedValue({
      userId: 'user-1',
      scopes: ['repos:write'],
      tokenKind: 'personal',
    });
    mocks.getCachedUser.mockResolvedValue({
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
    } satisfies User);

    const response = await app.fetch(
      new Request('https://takos.jp/git/repo.git/git-receive-pack', {
        headers: { Authorization: encodeBasicAuth('tak_pat_personal_1234567890') },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('user-1');
    expect(mocks.validateTakosPersonalAccessToken).toHaveBeenCalledWith(env.DB, 'tak_pat_personal_1234567890');
  });

  it('rejects managed built-in tokens', async () => {
    const env = createMockEnv();
    const app = createProtectedApp();

    const response = await app.fetch(
      new Request('https://takos.jp/git/repo.git/git-receive-pack', {
        headers: { Authorization: encodeBasicAuth('tak_pat_managed_token_1234567890') },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe('Access denied\n');
    expect(mocks.validateTakosPersonalAccessToken).toHaveBeenCalledWith(env.DB, 'tak_pat_managed_token_1234567890');
    expect(mocks.getCachedUser).not.toHaveBeenCalled();
  });

  it('optional git auth keeps anonymous when only managed token is presented', async () => {
    const env = createMockEnv();
    const app = createOptionalApp();

    const response = await app.fetch(
      new Request('https://takos.jp/git/repo.git/info/refs', {
        headers: { Authorization: encodeBasicAuth('tak_pat_managed_token_1234567890') },
      }),
      env as unknown as Env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('anonymous');
    expect(mocks.validateTakosPersonalAccessToken).toHaveBeenCalledWith(env.DB, 'tak_pat_managed_token_1234567890');
    expect(mocks.getCachedUser).not.toHaveBeenCalled();
  });
});
