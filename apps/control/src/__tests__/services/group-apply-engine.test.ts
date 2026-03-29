import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  groupGet: vi.fn(),
  listResources: vi.fn(),
  listGroupManagedServices: vi.fn(),
}));

vi.mock('@/infra/db/client', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: mocks.groupGet,
        }),
      }),
    }),
  }),
}));

vi.mock('@/services/entities/resource-ops', () => ({
  createResource: vi.fn(),
  deleteResource: vi.fn(),
  listResources: mocks.listResources,
  updateManagedResource: vi.fn(),
}));

vi.mock('@/services/entities/group-managed-services', () => ({
  listGroupManagedServices: mocks.listGroupManagedServices,
}));

vi.mock('@/services/entities/worker-ops', () => ({
  deployWorker: vi.fn(),
  deleteWorker: vi.fn(),
}));

vi.mock('@/services/entities/container-ops', () => ({
  deployContainer: vi.fn(),
  deleteContainer: vi.fn(),
}));

vi.mock('@/services/entities/service-ops', () => ({
  deployService: vi.fn(),
  deleteService: vi.fn(),
}));

import { planManifest } from '@/services/deployment/apply-engine';

function makeManifest() {
  return {
    apiVersion: 'takos.dev/v1alpha1',
    kind: 'App',
    metadata: { name: 'demo-app' },
    spec: {
      version: '1.0.0',
      workers: {
        api: {
          build: {
            fromWorkflow: {
              path: '.github/workflows/deploy.yml',
              job: 'build',
              artifact: 'worker',
              artifactPath: 'dist/worker.js',
            },
          },
        },
      },
      routes: [
        { name: 'api-route', target: 'api', path: '/api' },
      ],
    },
  };
}

describe('group apply engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('plans against canonical group resources/services state', async () => {
    mocks.groupGet.mockResolvedValue({
      id: 'group-1',
      spaceId: 'ws-1',
      name: 'demo-app',
      provider: 'cloudflare',
      env: 'production',
      appVersion: '1.0.0',
      manifestJson: null,
      desiredSpecJson: null,
      observedStateJson: JSON.stringify({
        routes: {
          'api-route': {
            name: 'api-route',
            target: 'api',
            path: '/api',
          },
        },
      }),
      providerStateJson: '{}',
      reconcileStatus: 'ready',
      lastAppliedAt: '2026-03-29T00:00:00.000Z',
      createdAt: '2026-03-29T00:00:00.000Z',
      updatedAt: '2026-03-29T00:00:00.000Z',
    });
    mocks.listResources.mockResolvedValue([]);
    mocks.listGroupManagedServices.mockResolvedValue([
      {
        row: {
          id: 'svc-api',
          accountId: 'ws-1',
          groupId: 'group-1',
          serviceType: 'app',
          nameType: null,
          status: 'deployed',
          config: '{}',
          hostname: 'grp-group-1-production-worker-api.example.test',
          routeRef: 'grp-group-1-production-worker-api',
          slug: 'grp-group-1-production-worker-api',
          activeDeploymentId: null,
          fallbackDeploymentId: null,
          currentVersion: 0,
          workloadKind: 'worker-bundle',
          createdAt: '2026-03-29T00:00:00.000Z',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
        config: {
          managedBy: 'group',
          manifestName: 'api',
          componentKind: 'worker',
          specFingerprint: JSON.stringify({
            build: {
              fromWorkflow: {
                artifact: 'worker',
                artifactPath: 'dist/worker.js',
                job: 'build',
                path: '.github/workflows/deploy.yml',
              },
            },
          }),
          deployedAt: '2026-03-29T00:00:00.000Z',
        },
      },
    ]);

    const diff = await planManifest({ DB: {} as never } as never, 'group-1', makeManifest() as never);

    expect(diff.hasChanges).toBe(false);
    expect(diff.summary).toEqual({
      create: 0,
      update: 0,
      delete: 0,
      unchanged: 2,
    });
  });
});
