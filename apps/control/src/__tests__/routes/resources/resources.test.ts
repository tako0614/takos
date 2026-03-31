import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { AppError, ErrorCodes } from 'takos-common/errors';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/route-auth';
import type * as DbModule from '@/db';
import type * as RouteAuthModule from '@/routes/route-auth';
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
  listResourceAccess: vi.fn(),
  listResourceBindings: vi.fn(),
  markResourceDeleting: vi.fn(),
  provisionManagedResource: vi.fn(),
  deleteManagedResource: vi.fn(),
  updateResourceMetadata: vi.fn(),
  resolveActorPrincipalId: vi.fn(),
  getPlatformServices: vi.fn(),
  getDb: vi.fn(),
  CloudflareResourceService: vi.fn(),
  upsertGroupDesiredResource: vi.fn(),
  removeGroupDesiredResource: vi.fn(),
}));

vi.mock('@/routes/route-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof RouteAuthModule>();
  return {
    ...actual,
    requireSpaceAccess: mocks.requireSpaceAccess,
  };
});

vi.mock('@/services/resources', () => ({
  checkResourceAccess: mocks.checkResourceAccess,
  countResourceBindings: mocks.countResourceBindings,
  deleteResource: mocks.deleteResource,
  getResourceById: mocks.getResourceById,
  getResourceByName: mocks.getResourceByName,
  listResourceAccess: mocks.listResourceAccess,
  listResourceBindings: mocks.listResourceBindings,
  listResourcesByType: mocks.listResourcesByType,
  listResourcesForUser: mocks.listResourcesForUser,
  listResourcesForWorkspace: mocks.listResourcesForWorkspace,
  markResourceDeleting: mocks.markResourceDeleting,
  provisionManagedResource: mocks.provisionManagedResource,
  deleteManagedResource: mocks.deleteManagedResource,
  updateResourceMetadata: mocks.updateResourceMetadata,
}));

vi.mock('@/services/identity/principals', () => ({
  resolveActorPrincipalId: mocks.resolveActorPrincipalId,
}));

vi.mock('@/platform/accessors.ts', () => ({
  getPlatformServices: mocks.getPlatformServices,
}));

vi.mock('@/platform/providers/cloudflare/resources.ts', () => ({
  CloudflareResourceService: mocks.CloudflareResourceService,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof DbModule>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/deployment/group-desired-projector', () => ({
  upsertGroupDesiredResource: mocks.upsertGroupDesiredResource,
  removeGroupDesiredResource: mocks.removeGroupDesiredResource,
}));

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

describe('resources base routes', () => {
  let app: Hono<AuthenticatedRouteEnv>;
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp(createUser());
    env = createMockEnv() as unknown as Env;
    mocks.getPlatformServices.mockReturnValue({ sql: { binding: env.DB } });
  });

  describe('GET /api/resources (no space_id)', () => {
    it('returns owned and shared resources for the user', async () => {
      mocks.listResourcesForUser.mockResolvedValue({
        owned: [{ id: 'res-1', name: 'my-db', type: 'd1' }],
        shared: [{ id: 'res-2', name: 'shared-kv', type: 'kv' }],
      });

      const res = await app.fetch(
        new Request('http://localhost/api/resources'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { owned: unknown[]; shared: unknown[] };
      expect(json.owned).toHaveLength(1);
      expect(json.shared).toHaveLength(1);
    });
  });

  describe('GET /api/resources?space_id=...', () => {
    it('returns workspace-scoped resources after membership check', async () => {
      mocks.requireSpaceAccess.mockResolvedValue({
        space: { id: 'ws-1' },
        member: { role: 'viewer' },
      });
      mocks.listResourcesForWorkspace.mockResolvedValue([
        { id: 'res-3', name: 'team-db' },
      ]);

      const res = await app.fetch(
        new Request('http://localhost/api/resources?space_id=ws-1'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { resources: unknown[] };
      expect(json.resources).toHaveLength(1);
    });

    it('returns 404 when workspace access is denied', async () => {
      mocks.requireSpaceAccess.mockRejectedValue(
        new AppError('Workspace not found or access denied', ErrorCodes.NOT_FOUND, 404),
      );

      const res = await app.fetch(
        new Request('http://localhost/api/resources?space_id=ws-unknown'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
      expect(mocks.listResourcesForWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/resources/type/:type', () => {
    it('returns resources filtered by valid type', async () => {
      mocks.listResourcesByType.mockResolvedValue([
        { id: 'res-d1-1', name: 'db-1', type: 'sql', implementation: 'd1' },
      ]);

      const res = await app.fetch(
        new Request('http://localhost/api/resources/type/sql'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { resources: unknown[] };
      expect(json.resources).toHaveLength(1);
    });

    it('rejects invalid resource type', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/resources/type/invalid_type'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toContain('Invalid resource type');
    });
  });

  describe('GET /api/resources/:id', () => {
    it('returns resource details for the owner', async () => {
      mocks.getResourceById.mockResolvedValue({
        id: 'res-1',
        name: 'my-db',
        owner_id: TEST_USER_ID,
      });
      mocks.listResourceAccess.mockResolvedValue([]);
      mocks.listResourceBindings.mockResolvedValue([]);

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-1'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { resource: { id: string }; is_owner: boolean };
      expect(json.resource.id).toBe('res-1');
      expect(json.is_owner).toBe(true);
    });

    it('returns 404 when resource does not exist', async () => {
      mocks.getResourceById.mockResolvedValue(null);

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-missing'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns 404 when user has no access', async () => {
      mocks.getResourceById.mockResolvedValue({
        id: 'res-other',
        name: 'other-db',
        owner_id: 'other-user',
      });
      mocks.checkResourceAccess.mockResolvedValue(false);

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-other'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/resources', () => {
    it('creates a sql resource and returns 201', async () => {
      mocks.provisionManagedResource.mockResolvedValue(undefined);
      mocks.getResourceById.mockResolvedValue({
        id: 'res-new',
        name: 'new-db',
        type: 'sql',
        implementation: 'd1',
        status: 'ready',
      });

      const res = await app.fetch(
        new Request('http://localhost/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'new-db', type: 'sql' }),
        }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(201);
      expect(mocks.provisionManagedResource).toHaveBeenCalled();
    });

    it('rejects empty name', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: '   ', type: 'd1' }),
        }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
      expect(mocks.provisionManagedResource).not.toHaveBeenCalled();
    });

    it('rejects invalid resource type on POST', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'bad', type: 'worker' }),
        }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toContain('Invalid resource type');
    });

    it('accepts explicit provider to provision resource', async () => {
      mocks.provisionManagedResource.mockResolvedValue({
        id: 'res-provider',
        providerResourceId: 'provider-id',
        providerResourceName: 'provider-name',
      });
      mocks.getResourceById.mockResolvedValue({
        id: 'res-provider',
        name: 'new-db',
        type: 'sql',
        implementation: 'd1',
        status: 'ready',
      });

      const res = await app.fetch(
        new Request('http://localhost/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'new-db', type: 'sql', provider: 'aws' }),
        }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(201);
      expect(mocks.provisionManagedResource).toHaveBeenCalledWith(
        env,
        expect.objectContaining({ providerName: 'aws' }),
      );
    });

    it('passes analytics config through provisioning and respects dataset resource names', async () => {
      mocks.provisionManagedResource.mockResolvedValue({
        id: 'res-events',
        providerResourceId: 'provider-id',
        providerResourceName: 'tenant-events',
      });
      mocks.getResourceById.mockResolvedValue({
        id: 'res-events',
        name: 'events',
        type: 'analyticsEngine',
        implementation: 'analytics_engine',
        status: 'ready',
      });

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

      expect(res.status).toBe(201);
      expect(mocks.provisionManagedResource).toHaveBeenCalledWith(
        env,
        expect.objectContaining({
          providerName: 'local',
          providerResourceName: 'tenant-events',
          analyticsStore: { dataset: 'tenant-events' },
        }),
      );
    });

    it('rejects invalid provider value', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'new-db', type: 'sql', provider: 'bad-provider' }),
        }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toContain('Invalid provider');
    });

    it('validates that unsupported capability types are rejected', async () => {
      const res = await app.fetch(
        new Request('http://localhost/api/resources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'test', type: 'assets' }),
        }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/resources/:id', () => {
    it('updates resource metadata for the owner and syncs grouped desired state', async () => {
      mocks.getResourceById.mockResolvedValue({
        id: 'res-1',
        name: 'my-db',
        owner_id: TEST_USER_ID,
        group_id: 'group-1',
        type: 'sql',
        config: JSON.stringify({ sql: { mode: 'rw' } }),
      });
      mocks.updateResourceMetadata.mockResolvedValue({
        id: 'res-1',
        name: 'renamed-db',
        config: JSON.stringify({ sql: { mode: 'ro' } }),
      });

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'renamed-db' }),
        }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(mocks.removeGroupDesiredResource).toHaveBeenCalledWith(env, {
        groupId: 'group-1',
        name: 'my-db',
      });
      expect(mocks.upsertGroupDesiredResource).toHaveBeenCalledWith(
        env,
        expect.objectContaining({
          groupId: 'group-1',
          name: 'renamed-db',
        }),
      );
    });

    it('returns 403 when non-owner tries to update', async () => {
      mocks.getResourceById.mockResolvedValue({
        id: 'res-1',
        name: 'their-db',
        owner_id: 'other-user',
      });

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-1', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'hacked' }),
        }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/resources/:id', () => {
    it('returns 404 when resource not found', async () => {
      mocks.getResourceById.mockResolvedValue(null);

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-gone', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns 403 when non-owner tries to delete', async () => {
      mocks.getResourceById.mockResolvedValue({
        id: 'res-1',
        owner_id: 'other-user',
      });

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(403);
    });

    it('returns 409 when resource has active bindings', async () => {
      mocks.getResourceById.mockResolvedValue({
        id: 'res-1',
        owner_id: TEST_USER_ID,
      });
      mocks.countResourceBindings.mockResolvedValue({ count: 2 });

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(409);
      const json = await res.json() as { error: string; binding_count: number };
      expect(json.error).toContain('in use');
      expect(json.binding_count).toBe(2);
    });

    it('deletes resource when no bindings remain', async () => {
      mocks.getResourceById.mockResolvedValue({
        id: 'res-1',
        owner_id: TEST_USER_ID,
        type: 'sql',
        implementation: 'd1',
        provider_resource_id: 'cf-123',
        provider_resource_name: 'name',
      });
      mocks.countResourceBindings.mockResolvedValue({ count: 0 });
      mocks.CloudflareResourceService.mockImplementation(() => ({
        deleteResource: vi.fn().mockResolvedValue(undefined),
      }));

      const res = await app.fetch(
        new Request('http://localhost/api/resources/res-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { success: boolean };
      expect(json.success).toBe(true);
      expect(mocks.markResourceDeleting).toHaveBeenCalledWith(env.DB, 'res-1');
      expect(mocks.deleteResource).toHaveBeenCalledWith(env.DB, 'res-1');
    });
  });

  describe('GET /api/resources/by-name/:name', () => {
    it('returns resource by name for the owner', async () => {
      mocks.getResourceByName.mockResolvedValue({
        _internal_id: 'res-1',
        name: 'my-db',
        type: 'sql',
        implementation: 'd1',
      });
      mocks.listResourceAccess.mockResolvedValue([]);
      mocks.listResourceBindings.mockResolvedValue([]);

      const res = await app.fetch(
        new Request('http://localhost/api/resources/by-name/my-db'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { resource: Record<string, unknown>; is_owner: boolean };
      expect(json.is_owner).toBe(true);
      // Internal id should not be exposed
      expect(json.resource).not.toHaveProperty('_internal_id');
    });

    it('returns 404 for unknown resource name', async () => {
      mocks.getResourceByName.mockResolvedValue(null);

      const res = await app.fetch(
        new Request('http://localhost/api/resources/by-name/unknown'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/resources/by-name/:name', () => {
    it('returns 404 when resource name not found', async () => {
      mocks.getResourceByName.mockResolvedValue(null);

      const res = await app.fetch(
        new Request('http://localhost/api/resources/by-name/gone', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns 409 when resource has bindings', async () => {
      mocks.getResourceByName.mockResolvedValue({
        _internal_id: 'res-2',
        name: 'in-use-db',
        type: 'sql',
        implementation: 'd1',
        provider_resource_id: null,
        provider_resource_name: null,
      });
      mocks.countResourceBindings.mockResolvedValue({ count: 1 });

      const res = await app.fetch(
        new Request('http://localhost/api/resources/by-name/in-use-db', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(409);
    });
  });
});
