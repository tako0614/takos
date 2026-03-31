import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  groupGet: vi.fn(),
  listResources: vi.fn(),
  createResource: vi.fn(),
  updateManagedResource: vi.fn(),
  listGroupManagedServices: vi.fn(),
  upsertGroupManagedService: vi.fn(),
  createDeployment: vi.fn(),
  executeDeployment: vi.fn(),
  reconcileGroupRouting: vi.fn(),
  groupUpdateRun: vi.fn(),
  getDeploymentById: vi.fn(),
  getBundleContent: vi.fn(),
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
    update: () => ({
      set: () => ({
        where: () => ({
          run: mocks.groupUpdateRun,
        }),
      }),
    }),
  }),
}));

vi.mock('@/services/entities/resource-ops', () => ({
  createResource: mocks.createResource,
  deleteResource: vi.fn(),
  listResources: mocks.listResources,
  updateManagedResource: mocks.updateManagedResource,
}));

vi.mock('@/services/entities/group-managed-services', () => ({
  listGroupManagedServices: mocks.listGroupManagedServices,
  upsertGroupManagedService: mocks.upsertGroupManagedService,
}));

vi.mock('@/services/entities/worker-ops', () => ({
  deleteWorker: vi.fn(),
}));

vi.mock('@/services/entities/container-ops', () => ({
  deleteContainer: vi.fn(),
}));

vi.mock('@/services/entities/service-ops', () => ({
  deleteService: vi.fn(),
}));

vi.mock('@/services/deployment/group-managed-desired-state', () => ({
  syncGroupManagedDesiredState: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/deployment/service', () => ({
  DeploymentService: vi.fn().mockImplementation(() => ({
    createDeployment: mocks.createDeployment,
    executeDeployment: mocks.executeDeployment,
  })),
}));

vi.mock('@/services/deployment/store', () => ({
  getDeploymentById: mocks.getDeploymentById,
}));

vi.mock('@/services/deployment/artifact-io', () => ({
  getBundleContent: mocks.getBundleContent,
}));

vi.mock('@/services/deployment/group-routing', () => ({
  reconcileGroupRouting: mocks.reconcileGroupRouting,
}));

import { applyManifest, getGroupState, planManifest } from '@/services/deployment/apply-engine';

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
    mocks.reconcileGroupRouting.mockResolvedValue({ routes: {}, failedRoutes: [] });
    mocks.groupUpdateRun.mockResolvedValue(undefined);
    mocks.createResource.mockResolvedValue(undefined);
    mocks.updateManagedResource.mockResolvedValue(undefined);
  });

  it('plans against canonical group resources/services state', async () => {
    const desiredSpecJson = JSON.stringify(makeManifest());

    mocks.groupGet.mockResolvedValue({
      id: 'group-1',
      spaceId: 'ws-1',
      name: 'demo-app',
      provider: 'cloudflare',
      env: 'production',
      appVersion: '1.0.0',
      desiredSpecJson,
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
            sourceKind: 'worker',
            executionProfile: 'workers',
            artifactKind: 'worker-bundle',
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

    const result = await planManifest({ DB: {} as never } as never, 'group-1', makeManifest() as never);

    expect(result.diff.hasChanges).toBe(false);
    expect(result.diff.summary).toEqual({
      create: 0,
      update: 0,
      delete: 0,
      unchanged: 2,
    });
    expect(result.translationReport.provider).toBe('cloudflare');
    expect(result.translationReport.resources).toEqual([]);
    expect(result.translationReport.workloads).toEqual([
      expect.objectContaining({ name: 'api', category: 'worker', provider: 'workers-dispatch', status: 'native' }),
    ]);
  });

  it('derives observed routes from desiredSpecJson instead of stored observedStateJson', async () => {
    mocks.groupGet.mockResolvedValue({
      id: 'group-1',
      spaceId: 'ws-1',
      name: 'demo-app',
      provider: 'cloudflare',
      env: 'production',
      appVersion: '1.0.0',
      desiredSpecJson: JSON.stringify(makeManifest()),
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
          sourceKind: 'worker',
          executionProfile: 'workers',
          artifactKind: 'worker-bundle',
          specFingerprint: JSON.stringify(makeManifest().spec.workers.api),
        },
      },
    ]);

    const state = await getGroupState({ DB: {} as never } as never, 'group-1');

    expect(state?.routes['api-route']).toMatchObject({
      path: '/api',
      url: 'https://grp-group-1-production-worker-api.example.test/api',
    });
    expect(state?.routes['api-route']?.url).toContain('/api');
  });

  it('applies worker workloads through deployment service and routing reconcile', async () => {
    const manifest = makeManifest();
    mocks.groupGet.mockResolvedValue({
      id: 'group-1',
      spaceId: 'ws-1',
      name: 'demo-app',
      provider: 'cloudflare',
      env: 'production',
      appVersion: '1.0.0',
      desiredSpecJson: JSON.stringify(manifest),
      providerStateJson: '{}',
      reconcileStatus: 'ready',
      lastAppliedAt: '2026-03-29T00:00:00.000Z',
      createdAt: '2026-03-29T00:00:00.000Z',
      updatedAt: '2026-03-29T00:00:00.000Z',
    });
    mocks.listResources.mockResolvedValue([]);
    mocks.listGroupManagedServices
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          row: {
            id: 'svc-api',
            accountId: 'ws-1',
            groupId: 'group-1',
            serviceType: 'app',
            nameType: null,
            status: 'pending',
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
            specFingerprint: JSON.stringify(manifest.spec.workers?.api),
          },
        },
      ])
      .mockResolvedValue([
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
            activeDeploymentId: 'dep-1',
            fallbackDeploymentId: null,
            currentVersion: 1,
            workloadKind: 'worker-bundle',
            createdAt: '2026-03-29T00:00:00.000Z',
            updatedAt: '2026-03-29T00:00:00.000Z',
          },
          config: {
            managedBy: 'group',
            manifestName: 'api',
            componentKind: 'worker',
            specFingerprint: JSON.stringify(manifest.spec.workers?.api),
            deployedAt: '2026-03-29T00:00:01.000Z',
          },
        },
      ]);
    mocks.upsertGroupManagedService.mockResolvedValue({
      row: {
        id: 'svc-api',
        accountId: 'ws-1',
        groupId: 'group-1',
        serviceType: 'app',
        nameType: null,
        status: 'pending',
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
        specFingerprint: JSON.stringify(manifest.spec.workers?.api),
      },
    });
    mocks.createDeployment.mockResolvedValue({
      id: 'dep-1',
    });
    mocks.executeDeployment.mockResolvedValue({
      id: 'dep-1',
      completed_at: '2026-03-29T00:00:01.000Z',
      provider_state_json: '{}',
      bundle_hash: 'sha256:demo',
    });

    const result = await applyManifest({ DB: {} as never } as never, 'group-1', manifest as never, {
      artifacts: {
        api: {
          kind: 'worker-bundle',
          bundleContent: 'export default {}',
        },
      },
    });

    expect(mocks.createDeployment).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: 'svc-api',
      artifactKind: 'worker-bundle',
      provider: { name: 'workers-dispatch' },
    }));
    expect(mocks.executeDeployment).toHaveBeenCalledWith('dep-1');
    expect(mocks.reconcileGroupRouting).toHaveBeenCalled();
    expect(result.applied).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'api', category: 'worker', status: 'success' }),
    ]));
  });

  it('resolves worker bundle artifacts from desired manifest direct-artifact references', async () => {
    const manifest = {
      ...makeManifest(),
      spec: {
        ...makeManifest().spec,
        workers: {
          api: {
            artifact: {
              kind: 'bundle',
              deploymentId: 'dep-source',
              artifactRef: 'worker-api-v7',
            },
          },
        },
      },
    };

    mocks.groupGet.mockResolvedValue({
      id: 'group-1',
      spaceId: 'ws-1',
      name: 'demo-app',
      provider: 'cloudflare',
      env: 'production',
      appVersion: '1.0.0',
      desiredSpecJson: JSON.stringify(manifest),
      providerStateJson: '{}',
      reconcileStatus: 'ready',
      lastAppliedAt: '2026-03-29T00:00:00.000Z',
      createdAt: '2026-03-29T00:00:00.000Z',
      updatedAt: '2026-03-29T00:00:00.000Z',
    });
    mocks.listResources.mockResolvedValue([]);
    mocks.listGroupManagedServices
      .mockResolvedValue([]);
    mocks.upsertGroupManagedService.mockResolvedValue({
      row: { id: 'svc-api', routeRef: 'grp-api', updatedAt: '2026-03-29T00:00:00.000Z' },
      config: {},
    });
    mocks.getDeploymentById.mockResolvedValue({
      id: 'dep-source',
      bundle_r2_key: 'deployments/svc-api/7/bundle.js',
      bundle_hash: null,
      bundle_size: null,
    });
    mocks.getBundleContent.mockResolvedValue('export default { fetch() { return new Response("ok"); } };');
    mocks.createDeployment.mockResolvedValue({
      id: 'dep-2',
      version: 2,
      status: 'pending',
      deploy_state: 'pending',
      artifact_kind: 'worker-bundle',
      routing_status: 'active',
      routing_weight: 100,
      created_at: '2026-03-29T00:00:00.000Z',
    });
    mocks.executeDeployment.mockResolvedValue({
      provider_state_json: '{}',
      completed_at: '2026-03-29T00:00:00.000Z',
      bundle_hash: 'sha256-123',
    });

    await applyManifest({ DB: {} as never, WORKER_BUNDLES: {} as never } as never, 'group-1');

    expect(mocks.getDeploymentById).toHaveBeenCalledWith({} as never, 'dep-source');
    expect(mocks.getBundleContent).toHaveBeenCalled();
    expect(mocks.createDeployment).toHaveBeenCalledWith(expect.objectContaining({
      bundleContent: expect.stringContaining('export default'),
    }));
  });

  it('passes canonical resource specs into resource creation', async () => {
    const manifest = {
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'App',
      metadata: { name: 'demo-app' },
      spec: {
        version: '1.0.0',
        resources: {
          events: {
            type: 'analyticsEngine',
            binding: 'EVENTS',
            analyticsEngine: {
              dataset: 'tenant-events',
            },
          },
        },
      },
    };

    mocks.groupGet.mockResolvedValue({
      id: 'group-1',
      spaceId: 'ws-1',
      name: 'demo-app',
      provider: 'cloudflare',
      env: 'production',
      appVersion: '1.0.0',
      desiredSpecJson: JSON.stringify(manifest),
      providerStateJson: '{}',
      reconcileStatus: 'ready',
      lastAppliedAt: '2026-03-29T00:00:00.000Z',
      createdAt: '2026-03-29T00:00:00.000Z',
      updatedAt: '2026-03-29T00:00:00.000Z',
    });
    mocks.listResources.mockResolvedValue([]);
    mocks.listGroupManagedServices.mockResolvedValue([]);

    await applyManifest({ DB: {} as never } as never, 'group-1', manifest as never);

    expect(mocks.createResource).toHaveBeenCalledWith(
      expect.anything(),
      'group-1',
      'events',
      expect.objectContaining({
        type: 'analyticsEngine',
        spec: manifest.spec.resources.events,
      }),
    );
  });
});
