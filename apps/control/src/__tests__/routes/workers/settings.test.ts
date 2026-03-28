import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/shared/helpers';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getServiceForUser: vi.fn(),
  getServiceForUserWithRole: vi.fn(),
  ServiceDesiredStateService: vi.fn(),
  CommonEnvService: vi.fn(),
  buildCommonEnvActor: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/platform/workers', () => ({
  getServiceForUser: mocks.getServiceForUser,
  getServiceForUserWithRole: mocks.getServiceForUserWithRole,
}));

vi.mock('@/services/platform/worker-desired-state', () => ({
  ServiceDesiredStateService: mocks.ServiceDesiredStateService,
}));

vi.mock('@/services/common-env', async () => {
  const actual = await vi.importActual<typeof import('@/services/common-env')>('@/services/common-env');
  return {
    ...actual,
    CommonEnvService: mocks.CommonEnvService,
  };
});

vi.mock('@/routes/common-env-handlers', async () => {
  const actual = await vi.importActual<typeof import('@/routes/common-env-handlers')>('@/routes/common-env-handlers');
  return {
    ...actual,
    buildCommonEnvActor: mocks.buildCommonEnvActor,
  };
});

import workersSettings from '@/routes/workers/settings';

function CommonEnvServiceMock(overrides: Record<string, unknown> = {}) {
  return {
    listServiceCommonEnvLinks: vi.fn().mockResolvedValue([]),
    listServiceBuiltins: vi.fn().mockResolvedValue({}),
    listServiceManualLinkNames: vi.fn().mockResolvedValue([]),
    setServiceManualLinks: vi.fn().mockResolvedValue(undefined),
    patchServiceManualLinks: vi.fn().mockResolvedValue({ added: [], removed: [] }),
    upsertServiceTakosAccessTokenConfig: vi.fn().mockResolvedValue(undefined),
    deleteServiceTakosAccessTokenConfig: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createLinkPresenceDb(sources: string[] = []) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn().mockResolvedValue({
          results: sources.map((source) => ({ source })),
          success: true,
          meta: {},
        }),
      })),
    })),
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
  chain.from = vi.fn().mockReturnValue(chain);
  chain.leftJoin = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.all = vi.fn().mockResolvedValue(options.allResults ?? []);
  chain.get = vi.fn().mockResolvedValue(options.getResult ?? null);
  return {
    select: vi.fn().mockReturnValue(chain),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
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
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/services', workersSettings);
  return app;
}

describe('services settings bindings workspace scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildCommonEnvActor.mockResolvedValue({
      type: 'user',
      userId: 'user-1',
      requestId: undefined,
      ipHash: undefined,
      userAgent: undefined,
    });
  });

  it('uses workspace boundary scope when listing available resources', async () => {
    // Production code uses Drizzle chains:
    //   db.select({...}).from(resourceAccess).where(...).all() -> accessible IDs
    //   db.select({...}).from(resources).where(...).all() -> resource rows
    const drizzleDb = createDrizzleDb({
      allResults: [{ id: 'res-1', name: 'db-one', cfId: 'cf-d1-1', cfName: 'db-one' }],
    });
    // First .all() call returns resourceAccess rows, second returns resource rows
    let callCount = 0;
    drizzleDb._chain.all = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return [{ resourceId: 'res-1' }]; // resourceAccess rows
      return [{ id: 'res-1', name: 'db-one', cfId: 'cf-d1-1', cfName: 'db-one' }]; // resource rows
    });

    const desiredState = {
      listResourceBindings: vi.fn().mockResolvedValue([
        {
          id: 'binding-1',
          name: 'DB',
          type: 'd1',
          resource_id: 'res-1',
          resource_name: 'db-one',
        },
      ]),
    };
    mocks.getDb.mockReturnValue(drizzleDb);
    mocks.ServiceDesiredStateService.mockReturnValue(desiredState);
    mocks.getServiceForUser.mockResolvedValue({
      id: 'worker-1',
      space_id: 'ws-1',
    });

      const app = createApp(createUser());
      const env = createMockEnv() as unknown as Env;
      const response = await app.fetch(
      new Request('http://localhost/api/services/worker-1/bindings'),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    expect(drizzleDb.select).toHaveBeenCalled();
    expect(desiredState.listResourceBindings).toHaveBeenCalledWith('worker-1');
  });

  it('uses workspace boundary scope when resolving resource_id on bindings update', async () => {
    // Production code uses Drizzle chains:
    //   db.select({...}).from(resourceAccess).where(...).all() -> accessible IDs
    //   db.select({...}).from(resources).where(...).get() -> resource row
    const drizzleDb = createDrizzleDb({
      allResults: [], // no extra accessible resources
      getResult: { id: 'res-1', type: 'd1' }, // found resource
    });
    const desiredState = {
      replaceResourceBindings: vi.fn().mockResolvedValue(undefined),
    };
    mocks.ServiceDesiredStateService.mockReturnValue(desiredState);
    mocks.getDb.mockReturnValue(drizzleDb);
    mocks.getServiceForUserWithRole.mockResolvedValue({
      id: 'worker-1',
      space_id: 'ws-1',
    });

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

    expect(response.status).toBe(200);
    expect(drizzleDb.select).toHaveBeenCalled();
    expect(desiredState.replaceResourceBindings).toHaveBeenCalledWith({
      workerId: 'worker-1',
      bindings: [
        {
          name: 'DB',
          type: 'd1',
          resourceId: 'res-1',
        },
      ],
    });
  });

  it('returns builtins alongside service common env links', async () => {
    const commonEnvService = CommonEnvServiceMock({
      listServiceCommonEnvLinks: vi.fn().mockResolvedValue([
        {
          name: 'TAKOS_API_URL',
          source: 'manual',
          sync_state: 'managed',
          sync_reason: null,
          has_value: true,
        },
      ]),
      listServiceBuiltins: vi.fn().mockResolvedValue({
        TAKOS_API_URL: {
          managed: true,
          available: true,
          sync_state: 'managed',
          sync_reason: null,
        },
      }),
    });
    mocks.CommonEnvService.mockReturnValue(commonEnvService);
    mocks.getServiceForUser.mockResolvedValue({
      id: 'worker-1',
      space_id: 'ws-1',
    });

      const app = createApp(createUser());
      const env = createMockEnv() as unknown as Env;
      const response = await app.fetch(
      new Request('http://localhost/api/services/worker-1/common-env-links'),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
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
    expect(commonEnvService.listServiceCommonEnvLinks).toHaveBeenCalledWith('ws-1', 'worker-1');
    expect(commonEnvService.listServiceBuiltins).toHaveBeenCalledWith('ws-1', 'worker-1');
  });

  it('requires owner or admin to configure TAKOS_ACCESS_TOKEN builtins', async () => {
    const commonEnvService = CommonEnvServiceMock();
    mocks.CommonEnvService.mockReturnValue(commonEnvService);
    mocks.getServiceForUserWithRole
      .mockResolvedValueOnce({
        id: 'worker-1',
        space_id: 'ws-1',
      })
      .mockResolvedValueOnce(null);

    // getCurrentTakosAccessTokenLinkPresence uses Drizzle:
    // db.select({source}).from(workerCommonEnvLinks).where(...).all()
    mocks.getDb.mockReturnValue(createDrizzleDb({ allResults: [] }));

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

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Service not found', code: 'NOT_FOUND' });
    expect(commonEnvService.setServiceManualLinks).not.toHaveBeenCalled();
    expect(commonEnvService.upsertServiceTakosAccessTokenConfig).not.toHaveBeenCalled();
  });

  it('requires scopes when TAKOS_ACCESS_TOKEN is first linked', async () => {
    const commonEnvService = CommonEnvServiceMock({
      listServiceBuiltins: vi.fn().mockResolvedValue({}),
    });
    mocks.CommonEnvService.mockReturnValue(commonEnvService);
    mocks.getServiceForUserWithRole.mockResolvedValue({
      id: 'worker-1',
      space_id: 'ws-1',
    });

    // getCurrentTakosAccessTokenLinkPresence uses Drizzle chains
    mocks.getDb.mockReturnValue(createDrizzleDb({ allResults: [] }));

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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: 'BAD_REQUEST',
      error: 'TAKOS_ACCESS_TOKEN requires builtins.TAKOS_ACCESS_TOKEN.scopes when first linked',
    });
    expect(commonEnvService.setServiceManualLinks).not.toHaveBeenCalled();
  });

  it('stores TAKOS_ACCESS_TOKEN scopes when linked explicitly', async () => {
    const commonEnvService = CommonEnvServiceMock({
      listServiceBuiltins: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          TAKOS_ACCESS_TOKEN: {
            managed: true,
            available: true,
            configured: true,
            scopes: ['repo:read'],
            subject_mode: 'workspace_actor',
            sync_state: 'managed',
            sync_reason: null,
          },
        }),
      listServiceCommonEnvLinks: vi.fn().mockResolvedValue([
        {
          name: 'TAKOS_ACCESS_TOKEN',
          source: 'manual',
          sync_state: 'managed',
          sync_reason: null,
          has_value: true,
        },
      ]),
    });
    mocks.CommonEnvService.mockReturnValue(commonEnvService);
    mocks.getServiceForUserWithRole.mockResolvedValue({
      id: 'worker-1',
      space_id: 'ws-1',
    });

    // getCurrentTakosAccessTokenLinkPresence uses Drizzle chains
    mocks.getDb.mockReturnValue(createDrizzleDb({ allResults: [] }));

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

    expect(response.status).toBe(200);
    expect(commonEnvService.setServiceManualLinks).toHaveBeenCalledWith({
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
    });
    expect(commonEnvService.upsertServiceTakosAccessTokenConfig).toHaveBeenCalledWith({
      spaceId: 'ws-1',
      serviceId: 'worker-1',
      scopes: ['repo:read'],
    });
    await expect(response.json()).resolves.toEqual({
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
  });
});
