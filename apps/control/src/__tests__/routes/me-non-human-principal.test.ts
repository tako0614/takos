import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup.ts';
import meRoutes from '@/routes/me';

type TestEnv = {
import { assertEquals } from 'jsr:@std/assert';

  Bindings: Env;
  Variables: {
    user: User;
  };
};

function createSpaceAgentPrincipal(): User {
  return {
    id: 'principal-space-agent-1',
    email: '',
    name: 'Space Agent',
    username: 'space-agent-principal-space-agent-1',
    principal_kind: 'space_agent',
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


  Deno.test('non-human principal me route guard - blocks non-human principals from the me surface', async () => {
  const app = createApp(createSpaceAgentPrincipal());
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('http://localhost/api/me'),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 403);
    await assertEquals(await response.json(), {
      code: 'FORBIDDEN',
      error: '/api/me is only available to human accounts',
    });
})
  Deno.test('non-human principal me route guard - blocks non-human principals from minting personal access tokens', async () => {
  const app = createApp(createSpaceAgentPrincipal());
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('http://localhost/api/me/personal-access-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'forbidden',
          scopes: '["repo:read"]',
        }),
      }),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 403);
    await assertEquals(await response.json(), {
      code: 'FORBIDDEN',
      error: '/api/me is only available to human accounts',
    });
})