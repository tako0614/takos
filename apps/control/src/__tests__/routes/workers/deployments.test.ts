import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/shared/helpers';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getServiceForUser: vi.fn(),
  getServiceForUserWithRole: vi.fn(),
  DeploymentService: vi.fn(),
  upsertGroupDesiredWorkload: vi.fn(),
}));

vi.mock('@/services/platform/workers', () => ({
  getServiceForUser: mocks.getServiceForUser,
  getServiceForUserWithRole: mocks.getServiceForUserWithRole,
}));

vi.mock('@/services/deployment/index', () => ({
  DeploymentService: mocks.DeploymentService,
}));

vi.mock('@/services/deployment/group-desired-projector', () => ({
  upsertGroupDesiredWorkload: mocks.upsertGroupDesiredWorkload,
}));

import workersDeployments from '@/routes/workers/deployments';

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
  app.route('/api/services', workersDeployments);
  return app;
}

function createDeploymentServiceMock(overrides: Record<string, unknown> = {}) {
  return {
    createDeployment: vi.fn(),
    executeDeployment: vi.fn(),
    getDeploymentHistory: vi.fn().mockResolvedValue([]),
    rollback: vi.fn(),
    rollbackWorker: vi.fn(),
    getDeploymentById: vi.fn(),
    getDeploymentEvents: vi.fn().mockResolvedValue([]),
    getMaskedEnvVars: vi.fn().mockResolvedValue({}),
    getBindings: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('services deployments routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes OCI target configuration into deployment creation', async () => {
    const service = createDeploymentServiceMock({
      createDeployment: vi.fn().mockResolvedValue({
        id: 'dep-1',
        version: 1,
        status: 'pending',
        deploy_state: 'queued',
        provider_name: 'oci',
        target_json: JSON.stringify({
          route_ref: 'takos-worker',
          endpoint: {
            kind: 'http-url',
            base_url: 'https://worker.example.test',
          },
          artifact: {
            image_ref: 'ghcr.io/takos/worker:latest',
            exposed_port: 8080,
          },
        }),
        provider_state_json: '{}',
        routing_status: 'active',
        routing_weight: 100,
        created_at: '2026-03-22T00:00:00.000Z',
      }),
    });
    mocks.DeploymentService.mockImplementation(() => service);
    mocks.getServiceForUserWithRole.mockResolvedValue({
      id: 'worker-1',
      space_id: 'space-1',
    });

    const app = createApp(createUser());
    const env = createMockEnv({
      DEPLOY_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
    }) as unknown as Env;
    const response = await app.fetch(new Request('http://localhost/api/services/worker-1/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bundle: 'export default {}',
        provider: {
          name: 'oci',
        },
        target: {
          route_ref: 'takos-worker',
          endpoint: {
            kind: 'http-url',
            base_url: 'https://worker.example.test',
          },
          artifact: {
            image_ref: 'ghcr.io/takos/worker:latest',
            exposed_port: 8080,
          },
        },
      }),
    }), env, {} as ExecutionContext);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      deployment: {
        id: 'dep-1',
        version: 1,
        status: 'pending',
        deploy_state: 'queued',
        provider: { name: 'oci' },
        target: {
          route_ref: 'takos-worker',
          endpoint: {
            kind: 'http-url',
            base_url: 'https://worker.example.test',
          },
          artifact: {
            image_ref: 'ghcr.io/takos/worker:latest',
            exposed_port: 8080,
          },
        },
        routing_status: 'active',
        routing_weight: 100,
        created_at: '2026-03-22T00:00:00.000Z',
      },
    });
    expect(service.createDeployment).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: 'worker-1',
      spaceId: 'space-1',
      userId: 'user-1',
      provider: {
        name: 'oci',
      },
      target: {
        route_ref: 'takos-worker',
        endpoint: {
          kind: 'http-url',
          base_url: 'https://worker.example.test',
        },
        artifact: {
          image_ref: 'ghcr.io/takos/worker:latest',
          exposed_port: 8080,
        },
      },
    }));
  });

  it('includes provider and generic target in deployment history responses', async () => {
    const service = createDeploymentServiceMock({
      getDeploymentHistory: vi.fn().mockResolvedValue([
        {
          id: 'dep-oci',
          version: 3,
          status: 'success',
          deploy_state: 'completed',
          artifact_ref: 'artifact-1',
          routing_status: 'active',
          routing_weight: 100,
          bundle_hash: 'abc123',
          bundle_size: 1234,
          provider_name: 'oci',
          target_json: JSON.stringify({
            route_ref: 'takos-worker',
            endpoint: {
              kind: 'http-url',
              base_url: 'https://worker.example.test',
            },
          }),
          provider_state_json: '{}',
          deployed_by: 'user-1',
          deploy_message: 'deploy to oci',
          created_at: '2026-03-22T00:00:00.000Z',
          completed_at: '2026-03-22T00:00:10.000Z',
          step_error: null,
        },
      ]),
    });
    mocks.DeploymentService.mockImplementation(() => service);
    mocks.getServiceForUser.mockResolvedValue({
      id: 'worker-1',
      space_id: 'space-1',
    });

      const app = createApp(createUser());
      const env = createMockEnv() as unknown as Env;
      const response = await app.fetch(
      new Request('http://localhost/api/services/worker-1/deployments'),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deployments: [
        expect.objectContaining({
          id: 'dep-oci',
          provider: { name: 'oci' },
          target: {
            route_ref: 'takos-worker',
            endpoint: {
              kind: 'http-url',
              base_url: 'https://worker.example.test',
            },
          },
          status: 'success',
        }),
      ],
    });
  });

  it('preserves provider on rollback responses', async () => {
    const service = createDeploymentServiceMock({
      rollback: vi.fn().mockResolvedValue({
        id: 'dep-rb',
        version: 2,
        provider_name: 'oci',
        target_json: JSON.stringify({
          route_ref: 'takos-worker',
          endpoint: {
            kind: 'service-ref',
            ref: 'takos-worker',
          },
        }),
        provider_state_json: '{}',
        routing_status: 'rollback',
        routing_weight: 100,
      }),
    });
    mocks.DeploymentService.mockImplementation(() => service);
    mocks.getServiceForUserWithRole.mockResolvedValue({
      id: 'worker-1',
      space_id: 'space-1',
    });

    const app = createApp(createUser());
    const env = createMockEnv() as unknown as Env;
    const response = await app.fetch(new Request('http://localhost/api/services/worker-1/deployments/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_version: 1 }),
    }), env, {} as ExecutionContext);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      deployment: {
        id: 'dep-rb',
        version: 2,
        provider: { name: 'oci' },
        target: {
          route_ref: 'takos-worker',
          endpoint: {
            kind: 'service-ref',
            ref: 'takos-worker',
          },
        },
        routing_status: 'rollback',
        routing_weight: 100,
      },
    });
  });

  it('returns parsed target in deployment detail responses', async () => {
    const service = createDeploymentServiceMock({
      getDeploymentById: vi.fn().mockResolvedValue({
        id: 'dep-oci',
        service_id: 'worker-1',
        provider_name: 'oci',
        target_json: JSON.stringify({
          route_ref: 'takos-worker',
          endpoint: {
            kind: 'http-url',
            base_url: 'https://worker.example.test',
          },
        }),
        provider_state_json: '{}',
        step_error: null,
      }),
    });
    mocks.DeploymentService.mockImplementation(() => service);
    mocks.getServiceForUser.mockResolvedValue({
      id: 'worker-1',
      space_id: 'space-1',
    });

      const app = createApp(createUser());
      const env = createMockEnv() as unknown as Env;
      const response = await app.fetch(
      new Request('http://localhost/api/services/worker-1/deployments/dep-oci'),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deployment: expect.objectContaining({
        id: 'dep-oci',
        provider: { name: 'oci' },
        target: {
          route_ref: 'takos-worker',
          endpoint: {
            kind: 'http-url',
            base_url: 'https://worker.example.test',
          },
        },
        error_message: null,
        env_vars_masked: {},
        bindings: [],
      }),
      events: [],
    });
  });
});
