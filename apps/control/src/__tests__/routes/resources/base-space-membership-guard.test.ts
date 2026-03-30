import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { AppError, ErrorCodes } from 'takos-common/errors';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/route-auth';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  requireSpaceAccess: vi.fn(),
  listResourcesForWorkspace: vi.fn(),
  listResourcesForUser: vi.fn(),
  listResourcesByType: vi.fn(),
  checkResourceAccess: vi.fn(),
  countResourceBindings: vi.fn(),
  deleteResource: vi.fn(),
  getResourceById: vi.fn(),
  getResourceByName: vi.fn(),
  insertFailedResource: vi.fn(),
  insertResource: vi.fn(),
  listResourceAccess: vi.fn(),
  listResourceBindings: vi.fn(),
  markResourceDeleting: vi.fn(),
  provisionManagedResource: vi.fn(),
  updateResourceMetadata: vi.fn(),
}));

vi.mock('@/routes/route-auth', async () => {
  const actual = await vi.importActual('@/routes/route-auth');
  return {
    ...actual,
    requireSpaceAccess: mocks.requireSpaceAccess,
  };
});

vi.mock('@/services/resources', () => ({
  listResourcesForWorkspace: mocks.listResourcesForWorkspace,
  listResourcesForUser: mocks.listResourcesForUser,
  listResourcesByType: mocks.listResourcesByType,
  checkResourceAccess: mocks.checkResourceAccess,
  countResourceBindings: mocks.countResourceBindings,
  deleteResource: mocks.deleteResource,
  getResourceById: mocks.getResourceById,
  getResourceByName: mocks.getResourceByName,
  insertFailedResource: mocks.insertFailedResource,
  insertResource: mocks.insertResource,
  listResourceAccess: mocks.listResourceAccess,
  listResourceBindings: mocks.listResourceBindings,
  markResourceDeleting: mocks.markResourceDeleting,
  provisionManagedResource: mocks.provisionManagedResource,
  updateResourceMetadata: mocks.updateResourceMetadata,
}));

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

describe('resources workspace query membership guard (issue 023)', () => {
  let app: Hono<AuthenticatedRouteEnv>;
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp(createTestUser());
    env = createMockEnv() as unknown as Env;
  });

  it('rejects non-members before querying workspace resources', async () => {
    mocks.requireSpaceAccess.mockRejectedValue(
      new AppError('Workspace not found or access denied', ErrorCodes.NOT_FOUND, 404),
    );

    const result = await requestResources(app, env, 'workspace-2');

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Workspace not found or access denied' });
    expect(mocks.listResourcesForWorkspace).not.toHaveBeenCalled();
  });

  it('returns resources only after workspace membership check passes', async () => {
    mocks.requireSpaceAccess.mockResolvedValue({
      space: {
        id: 'workspace-2',
      },
      member: {
        role: 'viewer',
      },
    });
    mocks.listResourcesForWorkspace.mockResolvedValue([
      { id: 'res-1', name: 'shared-db', access_level: 'read' },
    ]);

    const result = await requestResources(app, env, 'workspace-2');

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      resources: [{ id: 'res-1', name: 'shared-db', access_level: 'read' }],
    });
    expect(mocks.listResourcesForWorkspace).toHaveBeenCalledWith(
      env.DB,
      TEST_USER_ID,
      'workspace-2',
    );
  });

  it('rejects worker creation on the resources write surface', async () => {
    const result = await createResource(app, env, {
      name: 'legacy-worker',
      type: 'worker',
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid resource type' });
    expect(mocks.provisionManagedResource).not.toHaveBeenCalled();
  });
});
