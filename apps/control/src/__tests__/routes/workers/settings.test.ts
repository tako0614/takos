import { Hono } from 'hono';
import { isAppError } from 'takos-common/errors';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/shared/helpers';
import { createMockEnv } from '../../../../test/integration/setup.ts';

import { assertEquals, assert } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  getServiceForUser: ((..._args: any[]) => undefined) as any,
  getServiceForUserWithRole: ((..._args: any[]) => undefined) as any,
  ServiceDesiredStateService: ((..._args: any[]) => undefined) as any,
  createCommonEnvDeps: ((..._args: any[]) => undefined) as any,
  listServiceCommonEnvLinks: ((..._args: any[]) => undefined) as any,
  listServiceBuiltins: ((..._args: any[]) => undefined) as any,
  listServiceManualLinkNames: ((..._args: any[]) => undefined) as any,
  setServiceManualLinks: ((..._args: any[]) => undefined) as any,
  patchServiceManualLinks: ((..._args: any[]) => undefined) as any,
  upsertServiceTakosAccessTokenConfig: ((..._args: any[]) => undefined) as any,
  deleteServiceTakosAccessTokenConfig: ((..._args: any[]) => undefined) as any,
  buildCommonEnvActor: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/platform/workers'
// [Deno] vi.mock removed - manually stub imports from '@/services/platform/worker-desired-state'
// [Deno] vi.mock removed - manually stub imports from '@/application/services/common-env'
// [Deno] vi.mock removed - manually stub imports from '@/routes/common-env-handlers'
import workersSettings from '@/routes/workers/settings';

function mockCommonEnvDeps() {
  const deps = {
    serviceLink: { kind: 'service-link' },
    manualLink: { kind: 'manual-link' },
  };
  mocks.createCommonEnvDeps = (() => deps) as any;
  return deps;
}

function createLinkPresenceDb(sources: string[] = []) {
  return {
    prepare: () => ({
      bind: () => ({
        all: (async () => ({
          results: sources.map((source) => ({ source })),
          success: true,
          meta: {},
        })),
      }),
    }),
  };
}

/**
 * Create a mock Drizzle DB that supports select().from().where().all()/.get() chains.
 * - `allResults` is returned by `.all()` calls
 * - `getResult` is returned by `.get()` calls
 */
function createDrizzleDb(options: {
  allResults?: unknown[];
  getResult?: unknown;
} = {}) {
  const chain: Record<string, unknown> = {};
  chain.from = (() => chain);
  chain.leftJoin = (() => chain);
  chain.where = (() => chain);
  chain.orderBy = (() => chain);
  chain.limit = (() => chain);
  chain.all = (async () => options.allResults ?? []);
  chain.get = (async () => options.getResult ?? null);
  return {
    select: (() => chain),
    update: (() => ({ set: (() => ({ where: (async () => undefined) })) })),
    insert: (() => ({ values: (async () => undefined) })),
    delete: (() => ({ where: (async () => undefined) })),
    _chain: chain,
  };
}

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

function createApp(user: User): Hono<AuthenticatedRouteEnv> {
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
  app.route('/api/services', workersSettings);
  return app;
}


  Deno.test('services settings bindings workspace scope - uses workspace boundary scope when listing available resources', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockCommonEnvDeps();
    mocks.listServiceCommonEnvLinks = (async () => []) as any;
    mocks.listServiceBuiltins = (async () => ({})) as any;
    mocks.listServiceManualLinkNames = (async () => []) as any;
    mocks.setServiceManualLinks = (async () => undefined) as any;
    mocks.patchServiceManualLinks = (async () => ({ added: [], removed: [] })) as any;
    mocks.upsertServiceTakosAccessTokenConfig = (async () => undefined) as any;
    mocks.deleteServiceTakosAccessTokenConfig = (async () => undefined) as any;
    mocks.buildCommonEnvActor = (async () => ({
      type: 'user',
      userId: 'user-1',
      requestId: undefined,
      ipHash: undefined,
      userAgent: undefined,
    })) as any;
  // Production code uses Drizzle chains:
    //   db.select({...}).from(resourceAccess).where(...).all() -> accessible IDs
    //   db.select({...}).from(resources).where(...).all() -> resource rows
    const drizzleDb = createDrizzleDb({
      allResults: [{ id: 'res-1', name: 'db-one', providerResourceId: 'cf-d1-1', providerResourceName: 'db-one' }],
    });
    // First .all() call returns resourceAccess rows, second returns resource rows
    let callCount = 0;
    drizzleDb._chain.all = async () => {
      callCount++;
      if (callCount === 1) return [{ resourceId: 'res-1' }]; // resourceAccess rows
      return [{ id: 'res-1', name: 'db-one', providerResourceId: 'cf-d1-1', providerResourceName: 'db-one' }]; // resource rows
    };

    const desiredState = {
      listResourceBindings: (async () => [
        {
          id: 'binding-1',
          name: 'DB',
          type: 'd1',
          resource_id: 'res-1',
          resource_name: 'db-one',
        },
      ]),
    };
    mocks.getDb = (() => drizzleDb) as any;
    mocks.ServiceDesiredStateService = (() => desiredState) as any;
    mocks.getServiceForUser = (async () => ({
      id: 'worker-1',
      space_id: 'ws-1',
    })) as any;

      const app = createApp(createUser());
      const env = createMockEnv() as unknown as Env;
      const response = await app.fetch(
      new Request('http://localhost/api/services/worker-1/bindings'),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    assert(drizzleDb.select.calls.length > 0);
    assertSpyCallArgs(desiredState.listResourceBindings, 0, ['worker-1']);
})
  Deno.test('services settings bindings workspace scope - uses workspace boundary scope when resolving resource_id on bindings update', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockCommonEnvDeps();
    mocks.listServiceCommonEnvLinks = (async () => []) as any;
    mocks.listServiceBuiltins = (async () => ({})) as any;
    mocks.listServiceManualLinkNames = (async () => []) as any;
    mocks.setServiceManualLinks = (async () => undefined) as any;
    mocks.patchServiceManualLinks = (async () => ({ added: [], removed: [] })) as any;
    mocks.upsertServiceTakosAccessTokenConfig = (async () => undefined) as any;
    mocks.deleteServiceTakosAccessTokenConfig = (async () => undefined) as any;
    mocks.buildCommonEnvActor = (async () => ({
      type: 'user',
      userId: 'user-1',
      requestId: undefined,
      ipHash: undefined,
      userAgent: undefined,
    })) as any;
  // Production code uses Drizzle chains:
    //   db.select({...}).from(resourceAccess).where(...).all() -> accessible IDs
    //   db.select({...}).from(resources).where(...).get() -> resource row
    const drizzleDb = createDrizzleDb({
      allResults: [], // no extra accessible resources
      getResult: { id: 'res-1', type: 'd1' }, // found resource
    });
    const desiredState = {
      replaceResourceBindings: (async () => undefined),
    };
    mocks.ServiceDesiredStateService = (() => desiredState) as any;
    mocks.getDb = (() => drizzleDb) as any;
    mocks.getServiceForUserWithRole = (async () => ({
      id: 'worker-1',
      space_id: 'ws-1',
    })) as any;

      const app = createApp(createUser());
      const env = createMockEnv() as unknown as Env;
      const response = await app.fetch(
      new Request('http://localhost/api/services/worker-1/bindings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bindings: [
            {
              name: 'DB',
              type: 'd1',
              resource_id: 'res-1',
            },
          ],
        }),
      }),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    assert(drizzleDb.select.calls.length > 0);
    assertSpyCallArgs(desiredState.replaceResourceBindings, 0, [{
      workerId: 'worker-1',
      bindings: [
        {
          name: 'DB',
          type: 'd1',
          resourceId: 'res-1',
        },
      ],
    }]);
})
  Deno.test('services settings bindings workspace scope - returns builtins alongside service common env links', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockCommonEnvDeps();
    mocks.listServiceCommonEnvLinks = (async () => []) as any;
    mocks.listServiceBuiltins = (async () => ({})) as any;
    mocks.listServiceManualLinkNames = (async () => []) as any;
    mocks.setServiceManualLinks = (async () => undefined) as any;
    mocks.patchServiceManualLinks = (async () => ({ added: [], removed: [] })) as any;
    mocks.upsertServiceTakosAccessTokenConfig = (async () => undefined) as any;
    mocks.deleteServiceTakosAccessTokenConfig = (async () => undefined) as any;
    mocks.buildCommonEnvActor = (async () => ({
      type: 'user',
      userId: 'user-1',
      requestId: undefined,
      ipHash: undefined,
      userAgent: undefined,
    })) as any;
  mocks.listServiceCommonEnvLinks = (async () => [
      {
        name: 'TAKOS_API_URL',
        source: 'manual',
        sync_state: 'managed',
        sync_reason: null,
        has_value: true,
      },
    ]) as any;
    mocks.listServiceBuiltins = (async () => ({
      TAKOS_API_URL: {
        managed: true,
        available: true,
        sync_state: 'managed',
        sync_reason: null,
      },
    })) as any;
    mocks.getServiceForUser = (async () => ({
      id: 'worker-1',
      space_id: 'ws-1',
    })) as any;

      const app = createApp(createUser());
      const env = createMockEnv() as unknown as Env;
      const response = await app.fetch(
      new Request('http://localhost/api/services/worker-1/common-env-links'),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertEquals(await response.json(), {
      links: [
        {
          name: 'TAKOS_API_URL',
          source: 'manual',
          sync_state: 'managed',
          sync_reason: null,
          has_value: true,
        },
      ],
      builtins: {
        TAKOS_API_URL: {
          managed: true,
          available: true,
          sync_state: 'managed',
          sync_reason: null,
        },
      },
    });
    assertSpyCallArgs(mocks.listServiceCommonEnvLinks, 0, [expect.anything(), 'ws-1', 'worker-1']);
    assertSpyCallArgs(mocks.listServiceBuiltins, 0, [expect.anything(), 'ws-1', 'worker-1']);
})
  Deno.test('services settings bindings workspace scope - requires owner or admin to configure TAKOS_ACCESS_TOKEN builtins', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockCommonEnvDeps();
    mocks.listServiceCommonEnvLinks = (async () => []) as any;
    mocks.listServiceBuiltins = (async () => ({})) as any;
    mocks.listServiceManualLinkNames = (async () => []) as any;
    mocks.setServiceManualLinks = (async () => undefined) as any;
    mocks.patchServiceManualLinks = (async () => ({ added: [], removed: [] })) as any;
    mocks.upsertServiceTakosAccessTokenConfig = (async () => undefined) as any;
    mocks.deleteServiceTakosAccessTokenConfig = (async () => undefined) as any;
    mocks.buildCommonEnvActor = (async () => ({
      type: 'user',
      userId: 'user-1',
      requestId: undefined,
      ipHash: undefined,
      userAgent: undefined,
    })) as any;
  mocks.getServiceForUserWithRole
       = (async () => ({
        id: 'worker-1',
        space_id: 'ws-1',
      })) as any
       = (async () => null) as any;

    // getCurrentTakosAccessTokenLinkPresence uses Drizzle:
    // db.select({source}).from(workerCommonEnvLinks).where(...).all()
    mocks.getDb = (() => createDrizzleDb({ allResults: [] })) as any;

      const app = createApp(createUser());
      const env = createMockEnv() as unknown as Env;
      const response = await app.fetch(
      new Request('http://localhost/api/services/worker-1/common-env-links', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keys: ['TAKOS_ACCESS_TOKEN'],
          builtins: {
            TAKOS_ACCESS_TOKEN: {
              scopes: ['repo:read'],
            },
          },
        }),
      }),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 400);
    await assertEquals(await response.json(), {
      error: {
        code: 'BAD_REQUEST',
        message: 'Service not found',
      },
    });
    assertSpyCalls(mocks.setServiceManualLinks, 0);
    assertSpyCalls(mocks.upsertServiceTakosAccessTokenConfig, 0);
})
  Deno.test('services settings bindings workspace scope - requires scopes when TAKOS_ACCESS_TOKEN is first linked', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockCommonEnvDeps();
    mocks.listServiceCommonEnvLinks = (async () => []) as any;
    mocks.listServiceBuiltins = (async () => ({})) as any;
    mocks.listServiceManualLinkNames = (async () => []) as any;
    mocks.setServiceManualLinks = (async () => undefined) as any;
    mocks.patchServiceManualLinks = (async () => ({ added: [], removed: [] })) as any;
    mocks.upsertServiceTakosAccessTokenConfig = (async () => undefined) as any;
    mocks.deleteServiceTakosAccessTokenConfig = (async () => undefined) as any;
    mocks.buildCommonEnvActor = (async () => ({
      type: 'user',
      userId: 'user-1',
      requestId: undefined,
      ipHash: undefined,
      userAgent: undefined,
    })) as any;
  mocks.listServiceBuiltins = (async () => ({})) as any;
    mocks.getServiceForUserWithRole = (async () => ({
      id: 'worker-1',
      space_id: 'ws-1',
    })) as any;

    // getCurrentTakosAccessTokenLinkPresence uses Drizzle chains
    mocks.getDb = (() => createDrizzleDb({ allResults: [] })) as any;

      const app = createApp(createUser());
      const env = createMockEnv() as unknown as Env;
      const response = await app.fetch(
      new Request('http://localhost/api/services/worker-1/common-env-links', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keys: ['TAKOS_ACCESS_TOKEN'],
        }),
      }),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 400);
    await assertEquals(await response.json(), {
      error: {
        code: 'BAD_REQUEST',
        message: 'TAKOS_ACCESS_TOKEN requires builtins.TAKOS_ACCESS_TOKEN.scopes when first linked',
      },
    });
    assertSpyCalls(mocks.setServiceManualLinks, 0);
})
  Deno.test('services settings bindings workspace scope - stores TAKOS_ACCESS_TOKEN scopes when linked explicitly', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mockCommonEnvDeps();
    mocks.listServiceCommonEnvLinks = (async () => []) as any;
    mocks.listServiceBuiltins = (async () => ({})) as any;
    mocks.listServiceManualLinkNames = (async () => []) as any;
    mocks.setServiceManualLinks = (async () => undefined) as any;
    mocks.patchServiceManualLinks = (async () => ({ added: [], removed: [] })) as any;
    mocks.upsertServiceTakosAccessTokenConfig = (async () => undefined) as any;
    mocks.deleteServiceTakosAccessTokenConfig = (async () => undefined) as any;
    mocks.buildCommonEnvActor = (async () => ({
      type: 'user',
      userId: 'user-1',
      requestId: undefined,
      ipHash: undefined,
      userAgent: undefined,
    })) as any;
  mocks.listServiceBuiltins
       = (async () => ({})) as any
       = (async () => ({
        TAKOS_ACCESS_TOKEN: {
          managed: true,
          available: true,
          configured: true,
          scopes: ['repo:read'],
          subject_mode: 'workspace_actor',
          sync_state: 'managed',
          sync_reason: null,
        },
      })) as any;
    mocks.listServiceCommonEnvLinks = (async () => [
      {
        name: 'TAKOS_ACCESS_TOKEN',
        source: 'manual',
        sync_state: 'managed',
        sync_reason: null,
        has_value: true,
      },
    ]) as any;
    mocks.getServiceForUserWithRole = (async () => ({
      id: 'worker-1',
      space_id: 'ws-1',
    })) as any;

    // getCurrentTakosAccessTokenLinkPresence uses Drizzle chains
    mocks.getDb = (() => createDrizzleDb({ allResults: [] })) as any;

      const app = createApp(createUser());
      const env = createMockEnv() as unknown as Env;
      const response = await app.fetch(
      new Request('http://localhost/api/services/worker-1/common-env-links', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keys: ['TAKOS_ACCESS_TOKEN'],
          builtins: {
            TAKOS_ACCESS_TOKEN: {
              scopes: ['repo:read'],
            },
          },
        }),
      }),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    assertSpyCallArgs(mocks.setServiceManualLinks, 0, [
      ({ kind: 'manual-link' }),
      {
        spaceId: 'ws-1',
        serviceId: 'worker-1',
        keys: ['TAKOS_ACCESS_TOKEN'],
        actor: {
          type: 'user',
          userId: 'user-1',
          requestId: undefined,
          ipHash: undefined,
          userAgent: undefined,
        },
      },
    ]);
    assertSpyCallArgs(mocks.upsertServiceTakosAccessTokenConfig, 0, [
      ({ kind: 'manual-link' }),
      {
        spaceId: 'ws-1',
        serviceId: 'worker-1',
        scopes: ['repo:read'],
      },
    ]);
    await assertEquals(await response.json(), {
      success: true,
      links: [
        {
          name: 'TAKOS_ACCESS_TOKEN',
          source: 'manual',
          sync_state: 'managed',
          sync_reason: null,
          has_value: true,
        },
      ],
      builtins: {
        TAKOS_ACCESS_TOKEN: {
          managed: true,
          available: true,
          configured: true,
          scopes: ['repo:read'],
          subject_mode: 'workspace_actor',
          sync_state: 'managed',
          sync_reason: null,
        },
      },
    });
})