import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  createShortcut: ((..._args: any[]) => undefined) as any,
  deleteShortcut: ((..._args: any[]) => undefined) as any,
  getOrCreatePersonalWorkspace: ((..._args: any[]) => undefined) as any,
  listShortcuts: ((..._args: any[]) => undefined) as any,
  updateShortcut: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/identity/shortcuts'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/spaces'
import shortcuts from '@/routes/shortcuts';

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
  app.route('/api/shortcuts', shortcuts);
  return app;
}


  Deno.test('shortcut create contract - rejects legacy resource types', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // No longer used since shortcuts now use user.id directly
  const app = createApp();
    const response = await app.fetch(
      new Request('http://localhost/api/shortcuts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Legacy project shortcut',
          resourceType: 'project',
          resourceId: 'project-1',
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
  Deno.test('shortcut create contract - allows current worker/resource/link shortcut types', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    // No longer used since shortcuts now use user.id directly
  mocks.createShortcut = (async () => ({
      id: 'shortcut-1',
      user_id: 'user-1',
      space_id: 'space-personal-1',
      resource_type: 'service',
      resource_id: 'worker-1',
      name: 'Service shortcut',
      icon: null,
      position: 0,
      created_at: '2026-03-06T00:00:00.000Z',
      updated_at: '2026-03-06T00:00:00.000Z',
    })) as any;

    const app = createApp();
    const response = await app.fetch(
      new Request('http://localhost/api/shortcuts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'Service shortcut',
          resourceType: 'service',
          resourceId: 'worker-1',
        }),
      }),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 201);
    assertSpyCallArgs(mocks.createShortcut, 0, [
      expect.anything(),
      'user-1',
      'user-1',
      {
        name: 'Service shortcut',
        resourceType: 'service',
        resourceId: 'worker-1',
      },
    ]);
})