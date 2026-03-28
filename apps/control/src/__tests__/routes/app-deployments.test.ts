import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
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
  AppDeploymentService: class {
    deployFromRepoRef = mocks.deployFromRepoRef;
    list = mocks.list;
    get = mocks.get;
    remove = mocks.remove;
    rollback = mocks.rollback;
  },
}));

vi.mock('@/routes/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/routes/shared/helpers')>();
  return {
    ...actual,
    requireSpaceAccess: mocks.requireSpaceAccess,
  };
});

import appDeploymentRoutes from '@/routes/app-deployments';

function createApp(user?: { id: string }) {
  const app = new Hono<{ Bindings: Env; Variables: { user?: { id: string } } }>();
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

  it('lists deployments for an authorized user', async () => {
    mocks.list.mockResolvedValue([{ id: 'appdep-1', name: 'sample-app' }]);

    const app = createApp({ id: 'user-1' });
    const res = await app.request('/spaces/ws1/app-deployments', {}, makeEnv());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ id: 'appdep-1', name: 'sample-app' }] });
  });

  it('rejects create when repo_id is missing', async () => {
    const app = createApp({ id: 'user-1' });
    const res = await app.request('/spaces/ws1/app-deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }, makeEnv());

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(expect.objectContaining({ error: 'Validation error' }));
  });

  it('deploys from repo ref and forwards metadata to the service', async () => {
    mocks.deployFromRepoRef.mockResolvedValue({
      app_deployment_id: 'appdep-1',
      app_id: 'sample-app',
      name: 'Sample App',
      version: '1.0.0',
    });

    const app = createApp({ id: 'user-1' });
    const res = await app.request('/spaces/ws1/app-deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_id: 'repo-1',
        ref: 'main',
        ref_type: 'branch',
        approve_oauth_auto_env: true,
      }),
    }, makeEnv());

    expect(res.status).toBe(201);
    expect(mocks.deployFromRepoRef).toHaveBeenCalledWith('ws1', 'user-1', expect.objectContaining({
      repoId: 'repo-1',
      ref: 'main',
      refType: 'branch',
      approveOauthAutoEnv: true,
    }));
  });
});
