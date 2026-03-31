import { Hono } from 'hono';
import { AppError, ErrorCodes } from 'takos-common/errors';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/route-auth';
import { createMockEnv } from '../../../../test/integration/setup';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  requireSpaceAccess: ((..._args: any[]) => undefined) as any,
  listResourcesForWorkspace: ((..._args: any[]) => undefined) as any,
  listResourcesForUser: ((..._args: any[]) => undefined) as any,
  listResourcesByType: ((..._args: any[]) => undefined) as any,
  checkResourceAccess: ((..._args: any[]) => undefined) as any,
  countResourceBindings: ((..._args: any[]) => undefined) as any,
  deleteResource: ((..._args: any[]) => undefined) as any,
  getResourceById: ((..._args: any[]) => undefined) as any,
  getResourceByName: ((..._args: any[]) => undefined) as any,
  insertFailedResource: ((..._args: any[]) => undefined) as any,
  insertResource: ((..._args: any[]) => undefined) as any,
  listResourceAccess: ((..._args: any[]) => undefined) as any,
  listResourceBindings: ((..._args: any[]) => undefined) as any,
  markResourceDeleting: ((..._args: any[]) => undefined) as any,
  provisionManagedResource: ((..._args: any[]) => undefined) as any,
  updateResourceMetadata: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/routes/route-auth'
// [Deno] vi.mock removed - manually stub imports from '@/services/resources'
import resourcesBase from '@/routes/resources/routes';

const TEST_USER_ID = 'user-1';
const TEST_TIMESTAMP = '2026-02-10T00:00:00.000Z';

function createTestUser(): User {
  return {
    id: TEST_USER_ID,
    email: 'user1@example.com',
    name: 'User 1',
    username: 'user1',
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: TEST_TIMESTAMP,
    updated_at: TEST_TIMESTAMP,
  };
}

function createApp(user: User): Hono<AuthenticatedRouteEnv> {
  const app = new Hono<AuthenticatedRouteEnv>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/resources', resourcesBase);
  return app;
}

async function requestResources(
  app: Hono<AuthenticatedRouteEnv>,
  env: Env,
  spaceId: string,
): Promise<{ status: number; body: unknown }> {
  const response = await app.fetch(
    new Request(`http://localhost/api/resources?space_id=${spaceId}`),
    env,
    {} as ExecutionContext,
  );
  return {
    status: response.status,
    body: await response.json(),
  };
}

async function createResource(
  app: Hono<AuthenticatedRouteEnv>,
  env: Env,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await app.fetch(
    new Request('http://localhost/api/resources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
    {} as ExecutionContext,
  );
  return {
    status: response.status,
    body: await response.json(),
  };
}


  let app: Hono<AuthenticatedRouteEnv>;
  let env: Env;
  Deno.test('resources workspace query membership guard (issue 023) - rejects non-members before querying workspace resources', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createTestUser());
    env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => { throw new AppError('Workspace not found or access denied', ErrorCodes.NOT_FOUND, 404),; }) as any;

    const result = await requestResources(app, env, 'workspace-2');

    assertEquals(result.status, 404);
    assertEquals(result.body, { error: 'Workspace not found or access denied' });
    assertSpyCalls(mocks.listResourcesForWorkspace, 0);
})
  Deno.test('resources workspace query membership guard (issue 023) - returns resources only after workspace membership check passes', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createTestUser());
    env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => ({
      space: {
        id: 'workspace-2',
      },
      member: {
        role: 'viewer',
      },
    })) as any;
    mocks.listResourcesForWorkspace = (async () => [
      { id: 'res-1', name: 'shared-db', access_level: 'read' },
    ]) as any;

    const result = await requestResources(app, env, 'workspace-2');

    assertEquals(result.status, 200);
    assertEquals(result.body, {
      resources: [{ id: 'res-1', name: 'shared-db', access_level: 'read' }],
    });
    assertSpyCallArgs(mocks.listResourcesForWorkspace, 0, [
      env.DB,
      TEST_USER_ID,
      'workspace-2',
    ]);
})
  Deno.test('resources workspace query membership guard (issue 023) - rejects worker creation on the resources write surface', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createTestUser());
    env = createMockEnv() as unknown as Env;
  const result = await createResource(app, env, {
      name: 'legacy-worker',
      type: 'worker',
    });

    assertEquals(result.status, 400);
    assertEquals(result.body, { error: 'Invalid resource type' });
    assertSpyCalls(mocks.provisionManagedResource, 0);
})