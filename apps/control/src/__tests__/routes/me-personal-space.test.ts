import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup.ts';

import { assertEquals } from 'jsr:@std/assert';

const mocks = ({
  getOrCreatePersonalWorkspace: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/identity/spaces'
import meRoutes from '@/routes/me';

type TestEnv = {
  Bindings: Env;
  Variables: {
    user: User;
  };
};

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

function createApp(user: User) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/me', meRoutes);
  return app;
}


  Deno.test('me personal-space route - returns the canonical space payload', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getOrCreatePersonalWorkspace = (async () => ({
      id: 'user-1',
      kind: 'user',
      name: 'User One',
      slug: 'user1',
      owner_principal_id: 'user-1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    })) as any;

    const response = await createApp(createUser()).fetch(
      new Request('http://localhost/api/me/personal-space'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), {
      space: {
        id: 'user-1',
        slug: 'user1',
        name: 'User One',
        owner_principal_id: 'user-1',
        kind: 'user',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
      },
    });
})