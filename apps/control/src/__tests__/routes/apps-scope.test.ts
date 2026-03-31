import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup.ts';

import { assertEquals } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  requireSpaceAccess: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
import { registerAppApiRoutes } from '@/routes/apps';

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use('*', async (c, next) => {
    c.set('user', {
      id: 'user-1',
      name: 'User 1',
      email: 'user1@example.com',
    } as User);
    await next();
  });
  registerAppApiRoutes(app);
  return app;
}


  Deno.test('apps detail workspace scoping - applies X-Takos-Space-Id to custom app detail lookups', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const selectGet = (async () => ({
      id: 'app-1',
      name: 'custom-app',
      description: 'Custom app',
      icon: null,
      appType: 'custom',
      takosClientKey: null,
      createdAt: '2026-03-06T00:00:00.000Z',
      updatedAt: '2026-03-06T00:00:00.000Z',
      workerHostname: 'custom-app.example.com',
      workerStatus: 'deployed',
      accountName: 'Workspace 1',
      accountSlug: 'team-one',
      accountType: 'team',
    }));

    mocks.getDb = (() => ({
      select: () => {
        const chain: any = {
          from: () => chain,
          leftJoin: () => chain,
          where: () => chain,
          limit: () => chain,
          get: selectGet,
        };
        return chain;
      },
    })) as any;
    mocks.requireSpaceAccess = (async () => ({
      workspace: {
        id: 'workspace-1',
      },
    })) as any;

    const app = createApp();
    const response = await app.fetch(
      new Request('http://localhost/apps/app-1', {
        headers: {
          'X-Takos-Space-Id': 'team-one',
        },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), {
      app: ({
        id: 'app-1',
        space_id: 'team-one',
      }),
    });
})