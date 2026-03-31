import { Hono } from 'hono';
import { AppError, ErrorCodes } from 'takos-common/errors';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/route-auth';
import type * as DbModule from '@/db';
import type * as RouteAuthModule from '@/routes/route-auth';
import { createMockEnv } from '../../../../test/integration/setup';

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
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
  listResourceAccess: ((..._args: any[]) => undefined) as any,
  listResourceBindings: ((..._args: any[]) => undefined) as any,
  markResourceDeleting: ((..._args: any[]) => undefined) as any,
  provisionManagedResource: ((..._args: any[]) => undefined) as any,
  deleteManagedResource: ((..._args: any[]) => undefined) as any,
  updateResourceMetadata: ((..._args: any[]) => undefined) as any,
  resolveActorPrincipalId: ((..._args: any[]) => undefined) as any,
  getPlatformServices: ((..._args: any[]) => undefined) as any,
  getDb: ((..._args: any[]) => undefined) as any,
  CloudflareResourceService: ((..._args: any[]) => undefined) as any,
  upsertGroupDesiredResource: ((..._args: any[]) => undefined) as any,
  removeGroupDesiredResource: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/routes/route-auth'
// [Deno] vi.mock removed - manually stub imports from '@/services/resources'
// [Deno] vi.mock removed - manually stub imports from '@/services/identity/principals'
// [Deno] vi.mock removed - manually stub imports from '@/platform/accessors.ts'
// [Deno] vi.mock removed - manually stub imports from '@/platform/providers/cloudflare/resources.ts'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/group-desired-projector'
import resourcesBase from '@/routes/resources/routes';

const TEST_USER_ID = 'user-1';
const TEST_TIMESTAMP = '2026-03-01T00:00:00.000Z';

function createUser(): User {
  return {
    id: TEST_USER_ID,
    email: 'user1@example.com',
    name: 'User One',
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


  let app: Hono<AuthenticatedRouteEnv>;
  let env: Env;
  
    Deno.test('resources base routes - GET /api/resources (no space_id) - returns owned and shared resources for the user', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.listResourcesForUser = (async () => ({
        owned: [{ id: 'res-1', name: 'my-db', type: 'd1' }],
        shared: [{ id: 'res-2', name: 'shared-kv', type: 'kv' }],
      })) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { owned: unknown[]; shared: unknown[] };
      assertEquals(json.owned.length, 1);
      assertEquals(json.shared.length, 1);
})  
  
    Deno.test('resources base routes - GET /api/resources?space_id=... - returns workspace-scoped resources after membership check', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.requireSpaceAccess = (async () => ({
        space: { id: 'ws-1' },
        member: { role: 'viewer' },
      })) as any;
      mocks.listResourcesForWorkspace = (async () => [
        { id: 'res-3', name: 'team-db' },
      ]) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources?space_id=ws-1'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { resources: unknown[] };
      assertEquals(json.resources.length, 1);
})
    Deno.test('resources base routes - GET /api/resources?space_id=... - returns 404 when workspace access is denied', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.requireSpaceAccess = (async () => { throw new AppError('Workspace not found or access denied', ErrorCodes.NOT_FOUND, 404),; }) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources?space_id=ws-unknown'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
      assertSpyCalls(mocks.listResourcesForWorkspace, 0);
})  
  
    Deno.test('resources base routes - GET /api/resources/type/:type - returns resources filtered by valid type', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.listResourcesByType = (async () => [
        { id: 'res-d1-1', name: 'db-1', type: 'sql', implementation: 'd1' },
      ]) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/type/sql'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { resources: unknown[] };
      assertEquals(json.resources.length, 1);
})
    Deno.test('resources base routes - GET /api/resources/type/:type - rejects invalid resource type', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  const res = await app.fetch(
        new Request('http://localhost/api/resources/type/invalid_type'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 400);
      const json = await res.json() as { error: string };
      assertStringIncludes(json.error, 'Invalid resource type');
})  
  
    Deno.test('resources base routes - GET /api/resources/:id - returns resource details for the owner', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.getResourceById = (async () => ({
        id: 'res-1',
        name: 'my-db',
        owner_id: TEST_USER_ID,
      })) as any;
      mocks.listResourceAccess = (async () => []) as any;
      mocks.listResourceBindings = (async () => []) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-1'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { resource: { id: string }; is_owner: boolean };
      assertEquals(json.resource.id, 'res-1');
      assertEquals(json.is_owner, true);
})
    Deno.test('resources base routes - GET /api/resources/:id - returns 404 when resource does not exist', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.getResourceById = (async () => null) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-missing'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('resources base routes - GET /api/resources/:id - returns 404 when user has no access', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.getResourceById = (async () => ({
        id: 'res-other',
        name: 'other-db',
        owner_id: 'other-user',
      })) as any;
      mocks.checkResourceAccess = (async () => false) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-other'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})  
  
    Deno.test('resources base routes - POST /api/resources - creates a sql resource and returns 201', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.provisionManagedResource = (async () => undefined) as any;
      mocks.getResourceById = (async () => ({
        id: 'res-new',
        name: 'new-db',
        type: 'sql',
        implementation: 'd1',
        status: 'ready',
      })) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'new-db', type: 'sql' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 201);
      assert(mocks.provisionManagedResource.calls.length > 0);
})
    Deno.test('resources base routes - POST /api/resources - rejects empty name', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  const res = await app.fetch(
        new Request('http://localhost/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '   ', type: 'd1' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 400);
      assertSpyCalls(mocks.provisionManagedResource, 0);
})
    Deno.test('resources base routes - POST /api/resources - rejects invalid resource type on POST', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  const res = await app.fetch(
        new Request('http://localhost/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'bad', type: 'worker' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 400);
      const json = await res.json() as { error: string };
      assertStringIncludes(json.error, 'Invalid resource type');
})
    Deno.test('resources base routes - POST /api/resources - accepts explicit provider to provision resource', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.provisionManagedResource = (async () => ({
        id: 'res-provider',
        providerResourceId: 'provider-id',
        providerResourceName: 'provider-name',
      })) as any;
      mocks.getResourceById = (async () => ({
        id: 'res-provider',
        name: 'new-db',
        type: 'sql',
        implementation: 'd1',
        status: 'ready',
      })) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'new-db', type: 'sql', provider: 'aws' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 201);
      assertSpyCallArgs(mocks.provisionManagedResource, 0, [
        env,
        ({ providerName: 'aws' }),
      ]);
})
    Deno.test('resources base routes - POST /api/resources - passes analytics config through provisioning and respects dataset resource names', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.provisionManagedResource = (async () => ({
        id: 'res-events',
        providerResourceId: 'provider-id',
        providerResourceName: 'tenant-events',
      })) as any;
      mocks.getResourceById = (async () => ({
        id: 'res-events',
        name: 'events',
        type: 'analyticsEngine',
        implementation: 'analytics_engine',
        status: 'ready',
      })) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'events',
            type: 'analyticsEngine',
            provider: 'local',
            config: {
              analyticsEngine: { dataset: 'tenant-events' },
            },
          }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 201);
      assertSpyCallArgs(mocks.provisionManagedResource, 0, [
        env,
        ({
          providerName: 'local',
          providerResourceName: 'tenant-events',
          analyticsStore: { dataset: 'tenant-events' },
        }),
      ]);
})
    Deno.test('resources base routes - POST /api/resources - rejects invalid provider value', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  const res = await app.fetch(
        new Request('http://localhost/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'new-db', type: 'sql', provider: 'bad-provider' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 400);
      const json = await res.json() as { error: string };
      assertStringIncludes(json.error, 'Invalid provider');
})
    Deno.test('resources base routes - POST /api/resources - validates that unsupported capability types are rejected', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  const res = await app.fetch(
        new Request('http://localhost/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test', type: 'assets' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 400);
})  
  
    Deno.test('resources base routes - PATCH /api/resources/:id - updates resource metadata for the owner and syncs grouped desired state', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.getResourceById = (async () => ({
        id: 'res-1',
        name: 'my-db',
        owner_id: TEST_USER_ID,
        group_id: 'group-1',
        type: 'sql',
        config: JSON.stringify({ sql: { mode: 'rw' } }),
      })) as any;
      mocks.updateResourceMetadata = (async () => ({
        id: 'res-1',
        name: 'renamed-db',
        config: JSON.stringify({ sql: { mode: 'ro' } }),
      })) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'renamed-db' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      assertSpyCallArgs(mocks.removeGroupDesiredResource, 0, [env, {
        groupId: 'group-1',
        name: 'my-db',
      }]);
      assertSpyCallArgs(mocks.upsertGroupDesiredResource, 0, [
        env,
        ({
          groupId: 'group-1',
          name: 'renamed-db',
        }),
      ]);
})
    Deno.test('resources base routes - PATCH /api/resources/:id - returns 403 when non-owner tries to update', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.getResourceById = (async () => ({
        id: 'res-1',
        name: 'their-db',
        owner_id: 'other-user',
      })) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'hacked' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 403);
})  
  
    Deno.test('resources base routes - DELETE /api/resources/:id - returns 404 when resource not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.getResourceById = (async () => null) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-gone', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('resources base routes - DELETE /api/resources/:id - returns 403 when non-owner tries to delete', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.getResourceById = (async () => ({
        id: 'res-1',
        owner_id: 'other-user',
      })) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 403);
})
    Deno.test('resources base routes - DELETE /api/resources/:id - returns 409 when resource has active bindings', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.getResourceById = (async () => ({
        id: 'res-1',
        owner_id: TEST_USER_ID,
      })) as any;
      mocks.countResourceBindings = (async () => ({ count: 2 })) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 409);
      const json = await res.json() as { error: string; binding_count: number };
      assertStringIncludes(json.error, 'in use');
      assertEquals(json.binding_count, 2);
})
    Deno.test('resources base routes - DELETE /api/resources/:id - deletes resource when no bindings remain', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.getResourceById = (async () => ({
        id: 'res-1',
        owner_id: TEST_USER_ID,
        type: 'sql',
        implementation: 'd1',
        provider_resource_id: 'cf-123',
        provider_resource_name: 'name',
      })) as any;
      mocks.countResourceBindings = (async () => ({ count: 0 })) as any;
      mocks.CloudflareResourceService = () => ({
        deleteResource: (async () => undefined),
      }) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { success: boolean };
      assertEquals(json.success, true);
      assertSpyCallArgs(mocks.markResourceDeleting, 0, [env.DB, 'res-1']);
      assertSpyCallArgs(mocks.deleteResource, 0, [env.DB, 'res-1']);
})  
  
    Deno.test('resources base routes - GET /api/resources/by-name/:name - returns resource by name for the owner', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.getResourceByName = (async () => ({
        _internal_id: 'res-1',
        name: 'my-db',
        type: 'sql',
        implementation: 'd1',
      })) as any;
      mocks.listResourceAccess = (async () => []) as any;
      mocks.listResourceBindings = (async () => []) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/by-name/my-db'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { resource: Record<string, unknown>; is_owner: boolean };
      assertEquals(json.is_owner, true);
      // Internal id should not be exposed
      assert(!('_internal_id' in json.resource));
})
    Deno.test('resources base routes - GET /api/resources/by-name/:name - returns 404 for unknown resource name', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.getResourceByName = (async () => null) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/by-name/unknown'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})  
  
    Deno.test('resources base routes - DELETE /api/resources/by-name/:name - returns 404 when resource name not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.getResourceByName = (async () => null) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/by-name/gone', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('resources base routes - DELETE /api/resources/by-name/:name - returns 409 when resource has bindings', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices = (() => ({ sql: { binding: env.DB } })) as any;
  mocks.getResourceByName = (async () => ({
        _internal_id: 'res-2',
        name: 'in-use-db',
        type: 'sql',
        implementation: 'd1',
        provider_resource_id: null,
        provider_resource_name: null,
      })) as any;
      mocks.countResourceBindings = (async () => ({ count: 1 })) as any;

      const res = await app.fetch(
        new Request('http://localhost/api/resources/by-name/in-use-db', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 409);
})  