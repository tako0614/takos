import { Hono } from 'hono';
import { AppError, ErrorCodes, isAppError } from 'takos-common/errors';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/route-auth';
import { createMockEnv } from '../../../../test/integration/setup.ts';

import { assertEquals, assertStringIncludes, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = {
  const listWorkersForUser = ((..._args: any[]) => undefined) as any;
  const listWorkersForWorkspace = ((..._args: any[]) => undefined) as any;
  const createWorker = ((..._args: any[]) => undefined) as any;
  const countWorkersInWorkspace = ((..._args: any[]) => undefined) as any;
  const deleteWorker = ((..._args: any[]) => undefined) as any;
  const getWorkerForUser = ((..._args: any[]) => undefined) as any;
  const getWorkerForUserWithRole = ((..._args: any[]) => undefined) as any;
  const slugifyWorkerName = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  return {
    listWorkersForUser,
    listWorkersForWorkspace,
    createWorker,
    countWorkersInWorkspace,
    deleteWorker,
    getWorkerForUser,
    getWorkerForUserWithRole,
    slugifyWorkerName,
    WORKSPACE_WORKER_LIMITS: { maxWorkers: 20 },
    WORKSPACE_SERVICE_LIMITS: { maxServices: 20 },
    requireSpaceAccess: ((..._args: any[]) => undefined) as any,
    deleteHostnameRouting: ((..._args: any[]) => undefined) as any,
    resolveHostnameRouting: ((..._args: any[]) => undefined) as any,
    upsertHostnameRouting: ((..._args: any[]) => undefined) as any,
    createCloudflareApiClient: ((..._args: any[]) => undefined) as any,
    deleteCloudflareCustomHostname: ((..._args: any[]) => undefined) as any,
    CommonEnvService: ((..._args: any[]) => undefined) as any,
    deleteServiceTakosAccessTokenConfig: ((..._args: any[]) => undefined) as any,
    ServiceDesiredStateService: ((..._args: any[]) => undefined) as any,
    createOptionalCloudflareWfpProvider: ((..._args: any[]) => undefined) as any,
    getDb: ((..._args: any[]) => undefined) as any,
    upsertGroupDesiredWorkload: ((..._args: any[]) => undefined) as any,
    removeGroupDesiredWorkload: ((..._args: any[]) => undefined) as any,
    renameGroupDesiredWorkload: ((..._args: any[]) => undefined) as any,
  };
};

// [Deno] vi.mock removed - manually stub imports from '@/services/platform/workers'
// [Deno] vi.mock removed - manually stub imports from '/home/tako/Desktop/takos/takos/packages/control/src/server/routes/route-auth.ts'
// [Deno] vi.mock removed - manually stub imports from '@/services/routing'
// [Deno] vi.mock removed - manually stub imports from '@/platform/providers/cloudflare/api-client.ts'
// [Deno] vi.mock removed - manually stub imports from '@/platform/providers/cloudflare/custom-domains.ts'
// [Deno] vi.mock removed - manually stub imports from '/home/tako/Desktop/takos/takos/packages/control/src/application/services/common-env/index.ts'
// [Deno] vi.mock removed - manually stub imports from '@/services/platform/worker-desired-state'
// [Deno] vi.mock removed - manually stub imports from '@/platform/providers/cloudflare/wfp.ts'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/group-desired-projector'
// [Deno] vi.mock removed - manually stub imports from '/home/tako/Desktop/takos/takos/packages/control/src/application/services/platform/workers.ts'
import workersBase from '@/routes/workers/routes';
import workersSlug from '@/routes/workers/slug';

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

function createApp(user: User, routeModule: Hono<AuthenticatedRouteEnv> = workersBase) {
  const app = new Hono<AuthenticatedRouteEnv>();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 501 | 502 | 503 | 504,
      );
    }
    throw error;
  });
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/services', routeModule);
  return app;
}


  let env: Env;
  
    Deno.test('services base routes - GET /api/services - returns services list for the authenticated user', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  const workerList = [
        { id: 'w-1', slug: 'my-worker', status: 'active' },
      ];
      mocks.listWorkersForUser = (async () => workerList) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { services: unknown[] };
      assertEquals(json.services, workerList);
      assertSpyCallArgs(mocks.listWorkersForUser, 0, [env.DB, 'user-1']);
})  
  
    Deno.test('services base routes - GET /api/services/space/:spaceId - returns services for the specified workspace', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => ({
        space: { id: 'ws-1', name: 'My Space' },
        membership: { role: 'owner' },
      })) as any;
      mocks.listWorkersForWorkspace = (async () => [
        { id: 'w-2', slug: 'space-worker' },
      ]) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/space/ws-1'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { services: unknown[] };
      assertEquals(json.services.length, 1);
      assertSpyCallArgs(mocks.listWorkersForWorkspace, 0, [env.DB, 'ws-1']);
})
    Deno.test('services base routes - GET /api/services/space/:spaceId - returns error when workspace access is denied', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => { throw new AppError('Workspace not found', ErrorCodes.NOT_FOUND, 404),; }) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/space/ws-999'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
      assertSpyCalls(mocks.listWorkersForWorkspace, 0);
})  
  
    Deno.test('services base routes - POST /api/services - creates a service and returns 201', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.countWorkersInWorkspace = (async () => 0) as any;
      mocks.createWorker = (async () => ({
        service: { id: 'w-new', slug: 'new-worker', status: 'pending' },
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service_type: 'service' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 201);
      const json = await res.json() as { service: { id: string } };
      assertEquals(json.service.id, 'w-new');
      assertSpyCallArgs(mocks.createWorker, 0, [
        env.DB,
        ({ workerType: 'service' }),
      ]);
})
    Deno.test('services base routes - POST /api/services - returns 429 when workspace reaches max services', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.countWorkersInWorkspace = (async () => 20) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 429);
      const json = await res.json() as { error: string };
      assertStringIncludes(json.error, 'maximum number of services');
      assertSpyCalls(mocks.createWorker, 0);
})
    Deno.test('services base routes - POST /api/services - respects space_id to scope service creation to a workspace', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => ({
        space: { id: 'ws-2' },
        membership: { role: 'admin' },
      })) as any;
      mocks.countWorkersInWorkspace = (async () => 0) as any;
      mocks.createWorker = (async () => ({
        service: { id: 'w-scoped', slug: 'scoped' },
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ space_id: 'ws-2' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 201);
      assertSpyCallArgs(mocks.createWorker, 0, [
        env.DB,
        ({ spaceId: 'ws-2' }),
      ]);
})
    Deno.test('services base routes - POST /api/services - projects grouped service creation back into desired state', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => ({
        space: { id: 'ws-1' },
        membership: { role: 'admin' },
      })) as any;
      mocks.countWorkersInWorkspace = (async () => 0) as any;
      mocks.createWorker = (async () => ({
        service: { id: 'svc-1', slug: 'api-service', status: 'pending' },
      })) as any;
      mocks.getDb = (() => ({
        select: () => ({
          from: (function(this: any) { return this; }),
          where: (function(this: any) { return this; }),
          get: (async () => ({ id: 'group-1', spaceId: 'ws-1' })),
        }),
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            space_id: 'ws-1',
            group_id: 'group-1',
            service_type: 'service',
            config: JSON.stringify({
              port: 8080,
              provider: 'k8s',
              imageRef: 'ghcr.io/takos/api:latest',
              healthPath: '/health',
            }),
          }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 201);
      assertSpyCallArgs(mocks.upsertGroupDesiredWorkload, 0, [
        env,
        ({
          groupId: 'group-1',
          category: 'service',
          name: 'api-service',
          workload: {
            port: 8080,
            provider: 'k8s',
            artifact: {
              kind: 'image',
              imageRef: 'ghcr.io/takos/api:latest',
              provider: 'k8s',
            },
            healthCheck: {
              path: '/health',
              type: 'http',
            },
          },
        }),
      ]);
})
    Deno.test('services base routes - POST /api/services - projects grouped app creation back into desired state', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.requireSpaceAccess = (async () => ({
        space: { id: 'ws-1' },
        membership: { role: 'admin' },
      })) as any;
      mocks.countWorkersInWorkspace = (async () => 0) as any;
      mocks.createWorker = (async () => ({
        service: { id: 'app-1', slug: 'web-app', status: 'pending' },
      })) as any;
      mocks.getDb = (() => ({
        select: () => ({
          from: (function(this: any) { return this; }),
          where: (function(this: any) { return this; }),
          get: (async () => ({ id: 'group-1', spaceId: 'ws-1' })),
        }),
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            space_id: 'ws-1',
            group_id: 'group-1',
            service_type: 'app',
          }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 201);
      assertSpyCallArgs(mocks.upsertGroupDesiredWorkload, 0, [
        env,
        ({
          groupId: 'group-1',
          category: 'worker',
          name: 'web-app',
          workload: {
            artifact: {
              kind: 'bundle',
            },
          },
        }),
      ]);
})  
  
    Deno.test('services base routes - GET /api/services/:id - returns service details for the owner', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getWorkerForUser = (async () => ({
        id: 'w-1',
        slug: 'test-worker',
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { service: { id: string } };
      assertEquals(json.service.id, 'w-1');
})
    Deno.test('services base routes - GET /api/services/:id - returns 404 when service not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getWorkerForUser = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-nonexistent'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})  
  
    Deno.test('services base routes - GET /api/services/:id/logs - returns empty invocations when no active deployment', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getWorkerForUser = (async () => ({ id: 'w-1' })) as any;
      mocks.ServiceDesiredStateService = (() => ({
        getCurrentDeploymentArtifactRef: (async () => null),
      })) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/logs'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { invocations: unknown[] };
      assertEquals(json.invocations, []);
})
    Deno.test('services base routes - GET /api/services/:id/logs - returns 404 when service not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getWorkerForUser = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-missing/logs'),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})  
  
    Deno.test('services base routes - DELETE /api/services/:id - returns 404 when service not found or unauthorized', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getWorkerForUserWithRole = (async () => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
      assertSpyCalls(mocks.deleteWorker, 0);
})
    Deno.test('services base routes - DELETE /api/services/:id - deletes service and returns success', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  const mockDbChain: any = {
        select: (function(this: any) { return this; }),
        from: (function(this: any) { return this; }),
        where: (function(this: any) { return this; }),
        all: (async () => []),
        delete: (() => ({ where: (async () => undefined) })),
      };
      mocks.getDb = (() => mockDbChain) as any;
      mocks.getWorkerForUserWithRole = (async () => ({
        id: 'w-1',
        space_id: 'ws-1',
        hostname: null,
        service_name: null,
      })) as any;
      mocks.deleteServiceTakosAccessTokenConfig = (async () => undefined) as any;
      mocks.createOptionalCloudflareWfpProvider = (() => null) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as { success: boolean };
      assertEquals(json.success, true);
      assertSpyCallArgs(mocks.deleteWorker, 0, [env.DB, 'w-1']);
})  

  let env: Env;
  
    Deno.test('services slug routes - PATCH /api/services/:id/slug - renames grouped desired workload keys after slug updates', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.slugifyWorkerName = (() => 'new-slug') as any;
      mocks.getWorkerForUserWithRole = (async () => ({
        id: 'w-1',
        group_id: 'group-1',
        service_type: 'service',
        slug: 'old-slug',
        hostname: null,
      })) as any;
      mocks.ServiceDesiredStateService = (() => ({
        getRoutingTarget: (async () => null),
      })) as any;

      const updateWhere = (async () => undefined);
      mocks.getDb = (() => ({
        select: () => ({
          from: (function(this: any) { return this; }),
          where: (function(this: any) { return this; }),
          get: (async () => null),
        }),
        update: () => ({
          set: () => ({
            where: updateWhere,
          }),
        }),
      })) as any;

      const app = createApp(createUser(), workersSlug);
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/slug', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: 'new-slug' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      assertSpyCallArgs(mocks.renameGroupDesiredWorkload, 0, [env, {
        groupId: 'group-1',
        category: 'service',
        fromName: 'old-slug',
        toName: 'new-slug',
      }]);
})
    Deno.test('services slug routes - PATCH /api/services/:id/slug - returns 404 when service not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.getWorkerForUserWithRole = (async () => null) as any;

      const app = createApp(createUser(), workersSlug);
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/slug', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: 'new-slug' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 404);
})
    Deno.test('services slug routes - PATCH /api/services/:id/slug - rejects slugs shorter than 3 characters', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.slugifyWorkerName = (() => 'ab') as any;

      const app = createApp(createUser(), workersSlug);
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/slug', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: 'ab' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 400);
      const json = await res.json() as { error: string };
      assertObjectMatch(json.error, {
        code: 'BAD_REQUEST',
        message: expect.stringContaining('between 3 and 32'),
      });
})
    Deno.test('services slug routes - PATCH /api/services/:id/slug - rejects reserved subdomains', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.slugifyWorkerName = (() => 'admin') as any;

      const app = createApp(createUser(), workersSlug);
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/slug', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: 'admin' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 400);
      const json = await res.json() as { error: string };
      assertObjectMatch(json.error, {
        code: 'BAD_REQUEST',
        message: expect.stringContaining('reserved'),
      });
})
    Deno.test('services slug routes - PATCH /api/services/:id/slug - rejects empty slug', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  const app = createApp(createUser(), workersSlug);
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/slug', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: '' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 400);
})
    Deno.test('services slug routes - PATCH /api/services/:id/slug - detects slug collision and returns 409', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    env = createMockEnv() as unknown as Env;
  mocks.slugifyWorkerName = (() => 'taken-slug') as any;
      mocks.getWorkerForUserWithRole = (async () => ({
        id: 'w-1',
        hostname: 'old.app.test.takos.jp',
        slug: 'old-slug',
      })) as any;

      const mockDbChain: any = {
        select: (function(this: any) { return this; }),
        from: (function(this: any) { return this; }),
        where: (function(this: any) { return this; }),
        get: (async () => ({ id: 'w-other' })),
      };
      mocks.getDb = (() => mockDbChain) as any;

      const app = createApp(createUser(), workersSlug);
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/slug', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: 'taken-slug' }),
        }),
        env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 409);
})  