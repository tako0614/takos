import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { GoneError, isAppError } from 'takos-common/errors';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  requireSpaceAccess: vi.fn(),
  deployFromRepoRef: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock('@/services/platform/app-deployments', () => ({
  APP_DEPLOYMENTS_REMOVED_MESSAGE: 'App deployment API is not available in the current implementation. Use `takos apply`.',
  AppDeploymentService: class {
    deployFromRepoRef = mocks.deployFromRepoRef;
    list = mocks.list;
    get = mocks.get;
    remove = mocks.remove;
    rollback = mocks.rollback;
  },
}));

vi.mock('@/routes/route-auth', () => ({
  spaceAccess: () => async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set('access', { space: { id: 'ws1' } });
    c.set('user', { id: 'user-1' });
    await next();
  },
}));

vi.mock('@/routes/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/routes/shared/helpers')>();
  return {
    ...actual,
    requireSpaceAccess: mocks.requireSpaceAccess,
  };
});

import appDeploymentRoutes from '@/routes/apps/deployments';

const removedMessage = 'App deployment API is not available in the current implementation. Use `takos apply`.';

function createApp(user?: { id: string }) {
  const app = new Hono<{ Bindings: Env; Variables: { user?: { id: string } } }>();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(error.toResponse(), error.statusCode as 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 501 | 502 | 503 | 504);
    }
    throw error;
  });
  app.use('*', async (c, next) => {
    if (user) c.set('user', user);
    await next();
  });
  app.route('/', appDeploymentRoutes);
  return app;
}

function makeEnv(): Partial<Env> {
  return {
    DB: {} as Env['DB'],
  };
}

describe('app deployment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSpaceAccess.mockResolvedValue({ workspace: { id: 'ws1' } });
  });

  it.each([
    {
      name: 'lists deployments',
      method: 'GET',
      path: '/spaces/ws1/app-deployments',
      setup: () => {
        mocks.list.mockRejectedValue(new GoneError(removedMessage));
      },
    },
    {
      name: 'deploys from repo ref',
      method: 'POST',
      path: '/spaces/ws1/app-deployments',
      body: {
        repo_id: 'repo-1',
        ref: 'main',
        ref_type: 'branch',
        approve_oauth_auto_env: true,
      },
      setup: () => {
        mocks.deployFromRepoRef.mockRejectedValue(new GoneError(removedMessage));
      },
    },
    {
      name: 'gets a deployment',
      method: 'GET',
      path: '/spaces/ws1/app-deployments/appdep-1',
      setup: () => {
        mocks.get.mockRejectedValue(new GoneError(removedMessage));
      },
    },
    {
      name: 'rolls back a deployment',
      method: 'POST',
      path: '/spaces/ws1/app-deployments/appdep-1/rollback',
      body: { approve_oauth_auto_env: true },
      setup: () => {
        mocks.rollback.mockRejectedValue(new GoneError(removedMessage));
      },
    },
    {
      name: 'removes a deployment',
      method: 'DELETE',
      path: '/spaces/ws1/app-deployments/appdep-1',
      setup: () => {
        mocks.remove.mockRejectedValue(new GoneError(removedMessage));
      },
    },
  ])('$name returns gone instead of 500', async ({ method, path, body, setup }) => {
    setup();

    const app = createApp({ id: 'user-1' });
    const res = await app.request(path, body ? {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : {
      method,
    }, makeEnv());

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: 'GONE',
        message: removedMessage,
      },
    });
  });

  it.each([
    { method: 'GET', path: '/spaces/ws1/app-deployments/appdep-1/rollout' },
    { method: 'POST', path: '/spaces/ws1/app-deployments/appdep-1/rollout/pause' },
    { method: 'POST', path: '/spaces/ws1/app-deployments/appdep-1/rollout/resume' },
    { method: 'POST', path: '/spaces/ws1/app-deployments/appdep-1/rollout/abort' },
    { method: 'POST', path: '/spaces/ws1/app-deployments/appdep-1/rollout/promote' },
  ])('returns gone for removed rollout endpoint $path', async ({ method, path }) => {
    const app = createApp({ id: 'user-1' });
    const res = await app.request(path, { method }, makeEnv());

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toMatchObject({
      error: {
        code: 'GONE',
        message: removedMessage,
      },
    });
  });
});
