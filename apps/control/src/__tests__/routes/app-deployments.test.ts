import { Hono } from 'hono';
import { GoneError, isAppError } from 'takos-common/errors';
import type { Env } from '@/types';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';

const mocks = ({
  requireSpaceAccess: ((..._args: any[]) => undefined) as any,
  deployFromRepoRef: ((..._args: any[]) => undefined) as any,
  list: ((..._args: any[]) => undefined) as any,
  get: ((..._args: any[]) => undefined) as any,
  remove: ((..._args: any[]) => undefined) as any,
  rollback: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/platform/app-deployments'
// [Deno] vi.mock removed - manually stub imports from '@/routes/route-auth'
// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
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

for (const { name, method, path, body, setup } of [
  {
    name: 'lists deployments',
    method: 'GET',
    path: '/spaces/ws1/app-deployments',
    body: undefined as Record<string, unknown> | undefined,
    setup: () => {
      mocks.list = (async () => { throw new GoneError(removedMessage); }) as any;
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
      mocks.deployFromRepoRef = (async () => { throw new GoneError(removedMessage); }) as any;
    },
  },
  {
    name: 'gets a deployment',
    method: 'GET',
    path: '/spaces/ws1/app-deployments/appdep-1',
    body: undefined as Record<string, unknown> | undefined,
    setup: () => {
      mocks.get = (async () => { throw new GoneError(removedMessage); }) as any;
    },
  },
  {
    name: 'rolls back a deployment',
    method: 'POST',
    path: '/spaces/ws1/app-deployments/appdep-1/rollback',
    body: { approve_oauth_auto_env: true },
    setup: () => {
      mocks.rollback = (async () => { throw new GoneError(removedMessage); }) as any;
    },
  },
  {
    name: 'removes a deployment',
    method: 'DELETE',
    path: '/spaces/ws1/app-deployments/appdep-1',
    body: undefined as Record<string, unknown> | undefined,
    setup: () => {
      mocks.remove = (async () => { throw new GoneError(removedMessage); }) as any;
    },
  },
]) {
  Deno.test(`${name} returns gone instead of 500`, async () => {
    setup();

    const app = createApp({ id: 'user-1' });
    const res = await app.request(path, body ? {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    } : {
      method,
    }, makeEnv());

    assertEquals(res.status, 410);
    await assertObjectMatch(await res.json(), {
      error: {
        code: 'GONE',
        message: removedMessage,
      },
    });
  });
}

for (const { method, path } of [
  { method: 'GET', path: '/spaces/ws1/app-deployments/appdep-1/rollout' },
  { method: 'POST', path: '/spaces/ws1/app-deployments/appdep-1/rollout/pause' },
  { method: 'POST', path: '/spaces/ws1/app-deployments/appdep-1/rollout/resume' },
  { method: 'POST', path: '/spaces/ws1/app-deployments/appdep-1/rollout/abort' },
  { method: 'POST', path: '/spaces/ws1/app-deployments/appdep-1/rollout/promote' },
]) {
  Deno.test(`returns gone for removed rollout endpoint ${path}`, async () => {
    const app = createApp({ id: 'user-1' });
    const res = await app.request(path, { method }, makeEnv());

    assertEquals(res.status, 410);
    await assertObjectMatch(await res.json(), {
      error: {
        code: 'GONE',
        message: removedMessage,
      },
    });
  });
}
