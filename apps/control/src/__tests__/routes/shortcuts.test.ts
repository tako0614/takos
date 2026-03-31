import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup.ts';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  createShortcut: ((..._args: any[]) => undefined) as any,
  deleteShortcut: ((..._args: any[]) => undefined) as any,
  getOrCreatePersonalWorkspace: ((..._args: any[]) => undefined) as any,
  listShortcuts: (async () => []),
  updateShortcut: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/identity/shortcuts'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/spaces'
import shortcutsRoutes from '@/routes/shortcuts';

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
  app.route('/api/shortcuts', shortcutsRoutes);
  return app;
}


  Deno.test('shortcuts routes input validation - rejects unknown shortcut resource types', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // No longer used since shortcuts now use user.id directly
    mocks.listShortcuts = (async () => []) as any;
  const app = createApp(createUser());
    const response = await app.fetch(
      new Request('http://localhost/api/shortcuts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Legacy Project Shortcut',
          resourceType: 'project',
          resourceId: 'proj-1',
        }),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 400);
    await assertEquals(await response.json(), {
      code: 'BAD_REQUEST',
      error: 'Invalid resourceType. Allowed values: service, resource, link',
    });
    assertSpyCalls(mocks.createShortcut, 0);
})