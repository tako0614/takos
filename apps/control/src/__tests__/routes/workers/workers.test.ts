import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/shared/helpers';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => {
  const listWorkersForUser = vi.fn();
  const listWorkersForWorkspace = vi.fn();
  const createWorker = vi.fn();
  const countWorkersInWorkspace = vi.fn();
  const deleteWorker = vi.fn();
  const getWorkerForUser = vi.fn();
  const getWorkerForUserWithRole = vi.fn();
  const slugifyWorkerName = vi.fn((s: string) => s.toLowerCase().replace(/[^a-z0-9-]/g, '-'));

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
    requireSpaceAccess: vi.fn(),
    deleteHostnameRouting: vi.fn(),
    resolveHostnameRouting: vi.fn(),
    upsertHostnameRouting: vi.fn(),
    createCloudflareApiClient: vi.fn(),
    deleteCloudflareCustomHostname: vi.fn(),
    createCommonEnvService: vi.fn(),
    createWorkerDesiredStateService: vi.fn(),
    createOptionalCloudflareWfpProvider: vi.fn(),
    getDb: vi.fn(),
  };
});

vi.mock('@/services/platform/workers', () => ({
  listServicesForUser: mocks.listWorkersForUser,
  listServicesForSpace: mocks.listWorkersForWorkspace,
  createService: mocks.createWorker,
  countServicesInSpace: mocks.countWorkersInWorkspace,
  deleteService: mocks.deleteWorker,
  getServiceForUser: mocks.getWorkerForUser,
  getServiceForUserWithRole: mocks.getWorkerForUserWithRole,
  slugifyServiceName: mocks.slugifyWorkerName,
  WORKSPACE_WORKER_LIMITS: mocks.WORKSPACE_WORKER_LIMITS,
  WORKSPACE_SERVICE_LIMITS: mocks.WORKSPACE_SERVICE_LIMITS,
}));

vi.mock('@/routes/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/routes/shared/helpers')>();
  return {
    ...actual,
    requireSpaceAccess: mocks.requireSpaceAccess,
  };
});

vi.mock('@/services/routing', () => ({
  deleteHostnameRouting: mocks.deleteHostnameRouting,
  resolveHostnameRouting: mocks.resolveHostnameRouting,
  upsertHostnameRouting: mocks.upsertHostnameRouting,
}));

vi.mock('@/platform/providers/cloudflare/api-client.ts', () => ({
  createCloudflareApiClient: mocks.createCloudflareApiClient,
}));

vi.mock('@/platform/providers/cloudflare/custom-domains.ts', () => ({
  deleteCloudflareCustomHostname: mocks.deleteCloudflareCustomHostname,
}));

vi.mock('@/services/common-env', () => ({
  createCommonEnvService: mocks.createCommonEnvService,
}));

vi.mock('@/services/platform/worker-desired-state', () => ({
  createWorkerDesiredStateService: mocks.createWorkerDesiredStateService,
  createServiceDesiredStateService: mocks.createWorkerDesiredStateService,
}));

vi.mock('@/platform/providers/cloudflare/wfp.ts', () => ({
  createOptionalCloudflareWfpProvider: mocks.createOptionalCloudflareWfpProvider,
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

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
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api/services', routeModule);
  return app;
}

describe('services base routes', () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    env = createMockEnv() as unknown as Env;
  });

  describe('GET /api/services', () => {
    it('returns services list for the authenticated user', async () => {
      const workerList = [
        { id: 'w-1', slug: 'my-worker', status: 'active' },
      ];
      mocks.listWorkersForUser.mockResolvedValue(workerList);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { services: unknown[] };
      expect(json.services).toEqual(workerList);
      expect(mocks.listWorkersForUser).toHaveBeenCalledWith(env.DB, 'user-1');
    });
  });

  describe('GET /api/services/space/:spaceId', () => {
    it('returns services for the specified workspace', async () => {
      mocks.requireSpaceAccess.mockResolvedValue({
        workspace: { id: 'ws-1', name: 'My Space' },
        member: { role: 'owner' },
      });
      mocks.listWorkersForWorkspace.mockResolvedValue([
        { id: 'w-2', slug: 'space-worker' },
      ]);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/space/ws-1'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { services: unknown[] };
      expect(json.services).toHaveLength(1);
      expect(mocks.listWorkersForWorkspace).toHaveBeenCalledWith(env.DB, 'ws-1');
    });

    it('returns error when workspace access is denied', async () => {
      mocks.requireSpaceAccess.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Workspace not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/space/ws-999'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
      expect(mocks.listWorkersForWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/services', () => {
    it('creates a service and returns 201', async () => {
      mocks.countWorkersInWorkspace.mockResolvedValue(0);
      mocks.createWorker.mockResolvedValue({
        service: { id: 'w-new', slug: 'new-worker', status: 'pending' },
      });

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

      expect(res.status).toBe(201);
      const json = await res.json() as { service: { id: string } };
      expect(json.service.id).toBe('w-new');
      expect(mocks.createWorker).toHaveBeenCalledWith(
        env.DB,
        expect.objectContaining({ workerType: 'service' }),
      );
    });

    it('returns 429 when workspace reaches max services', async () => {
      mocks.countWorkersInWorkspace.mockResolvedValue(20);

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

      expect(res.status).toBe(429);
      const json = await res.json() as { error: string };
      expect(json.error).toContain('maximum number of services');
      expect(mocks.createWorker).not.toHaveBeenCalled();
    });

    it('respects space_id to scope service creation to a workspace', async () => {
      mocks.requireSpaceAccess.mockResolvedValue({
        workspace: { id: 'ws-2' },
        member: { role: 'admin' },
      });
      mocks.countWorkersInWorkspace.mockResolvedValue(0);
      mocks.createWorker.mockResolvedValue({
        service: { id: 'w-scoped', slug: 'scoped' },
      });

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

      expect(res.status).toBe(201);
      expect(mocks.createWorker).toHaveBeenCalledWith(
        env.DB,
        expect.objectContaining({ spaceId: 'ws-2' }),
      );
    });
  });

  describe('GET /api/services/:id', () => {
    it('returns service details for the owner', async () => {
      mocks.getWorkerForUser.mockResolvedValue({
        id: 'w-1',
        slug: 'test-worker',
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { service: { id: string } };
      expect(json.service.id).toBe('w-1');
    });

    it('returns 404 when service not found', async () => {
      mocks.getWorkerForUser.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-nonexistent'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/services/:id/logs', () => {
    it('returns empty invocations when no active deployment', async () => {
      mocks.getWorkerForUser.mockResolvedValue({ id: 'w-1' });
      mocks.createWorkerDesiredStateService.mockReturnValue({
        getCurrentDeploymentArtifactRef: vi.fn().mockResolvedValue(null),
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1/logs'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { invocations: unknown[] };
      expect(json.invocations).toEqual([]);
    });

    it('returns 404 when service not found', async () => {
      mocks.getWorkerForUser.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-missing/logs'),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/services/:id', () => {
    it('returns 404 when service not found or unauthorized', async () => {
      mocks.getWorkerForUserWithRole.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
      expect(mocks.deleteWorker).not.toHaveBeenCalled();
    });

    it('deletes service and returns success', async () => {
      const mockDbChain: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      };
      mocks.getDb.mockReturnValue(mockDbChain);
      mocks.getWorkerForUserWithRole.mockResolvedValue({
        id: 'w-1',
        space_id: 'ws-1',
        hostname: null,
        service_name: null,
      });
      mocks.createCommonEnvService.mockReturnValue({
        deleteWorkerTakosAccessTokenConfig: vi.fn().mockResolvedValue(undefined),
      });
      mocks.createOptionalCloudflareWfpProvider.mockReturnValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/services/w-1', { method: 'DELETE' }),
        env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { success: boolean };
      expect(json.success).toBe(true);
      expect(mocks.deleteWorker).toHaveBeenCalledWith(env.DB, 'w-1');
    });
  });
});

describe('services slug routes', () => {
  let env: Env;

  beforeEach(() => {
    vi.clearAllMocks();
    env = createMockEnv() as unknown as Env;
  });

  describe('PATCH /api/services/:id/slug', () => {
    it('returns 404 when service not found', async () => {
      mocks.getWorkerForUserWithRole.mockResolvedValue(null);

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

      expect(res.status).toBe(404);
    });

    it('rejects slugs shorter than 3 characters', async () => {
      mocks.slugifyWorkerName.mockReturnValue('ab');

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

      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toContain('between 3 and 32');
    });

    it('rejects reserved subdomains', async () => {
      mocks.slugifyWorkerName.mockReturnValue('admin');

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

      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toContain('reserved');
    });

    it('rejects empty slug', async () => {
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

      expect(res.status).toBe(400);
    });

    it('detects slug collision and returns 409', async () => {
      mocks.slugifyWorkerName.mockReturnValue('taken-slug');
      mocks.getWorkerForUserWithRole.mockResolvedValue({
        id: 'w-1',
        hostname: 'old.app.test.takos.jp',
        slug: 'old-slug',
      });

      const mockDbChain: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ id: 'w-other' }),
      };
      mocks.getDb.mockReturnValue(mockDbChain);

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

      expect(res.status).toBe(409);
    });
  });
});
