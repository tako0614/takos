import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { assertEquals, assert } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  requireSpaceAccess: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
import { registerAppApiRoutes } from '@/routes/apps';

function createUser(): User {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    name: 'User One',
    username: 'user1',
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  };
}

function createApp(user: User): Hono<{ Bindings: Env; Variables: { user: User } }> {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  registerAppApiRoutes(app);
  return app;
}


  Deno.test('apps routes workspace scope - scopes app detail lookup to the requested space when X-Takos-Space-Id is provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const selectGet = (async () => undefined);
    mocks.getDb = (() => ({
      select: () => ({
        from: () => ({
          leftJoin: function(this: any) { return this; },
          where: () => ({
            get: selectGet,
          }),
          get: selectGet,
        }),
      }),
    })) as any;
    // Make leftJoin chainable by providing all methods at each level
    mocks.getDb = (() => ({
      select: () => {
        const chain: any = {
          from: () => chain,
          leftJoin: () => chain,
          where: () => chain,
          get: selectGet,
        };
        return chain;
      },
    })) as any;
    mocks.requireSpaceAccess = (async () => ({
      workspace: {
        id: 'ws-1',
      },
    })) as any;

    const app = createApp(createUser());
    const response = await app.fetch(
      new Request('http://localhost/apps/app-1', {
        headers: {
          'X-Takos-Space-Id': 'team-alpha',
        },
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 404);
    assert(mocks.requireSpaceAccess.calls.length > 0);
})