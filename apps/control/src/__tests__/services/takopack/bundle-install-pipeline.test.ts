import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  nanoid: vi.fn().mockReturnValue('pipeline-id'),
  now: vi.fn().mockReturnValue('2026-03-01T00:00:00.000Z'),
  getDb: vi.fn(),
  getUserPrincipalId: vi.fn().mockResolvedValue('principal-1'),
  buildNamespacedInfraName: vi.fn((name: string, key: string) => `${name}__${key.slice(0, 8)}`),
  provisionOAuthClient: vi.fn().mockResolvedValue({}),
  markProvisionedResourcesAsTakopackManaged: vi.fn().mockResolvedValue(undefined),
  buildProvisionedResourceReferenceMaps: vi.fn().mockReturnValue({ d1: new Map(), r2: new Map(), kv: new Map() }),
  upsertHostnameRouting: vi.fn().mockResolvedValue(undefined),
  deleteManagedMcpServersByBundleDeployment: vi.fn().mockResolvedValue(undefined),
  bestEffort: vi.fn(async (fn: () => Promise<unknown>) => { try { await fn(); } catch {} }),
}));

vi.mock('nanoid', () => ({ nanoid: mocks.nanoid }));
vi.mock('@/shared/utils', () => ({ now: mocks.now }));
vi.mock('@/db', () => ({ getDb: mocks.getDb }));

vi.mock('@/services/takopack/bundle-deployment-utils', () => ({
  getUserPrincipalId: mocks.getUserPrincipalId,
  buildNamespacedInfraName: mocks.buildNamespacedInfraName,
}));

vi.mock('@/services/takopack/provisioner', () => ({
  provisionOAuthClient: mocks.provisionOAuthClient,
  markProvisionedResourcesAsTakopackManaged: mocks.markProvisionedResourcesAsTakopackManaged,
}));

vi.mock('@/services/takopack/groups', () => ({
  buildProvisionedResourceReferenceMaps: mocks.buildProvisionedResourceReferenceMaps,
}));

vi.mock('@/services/takopack/compensation', () => ({
  CompensationTracker: class {
    add = vi.fn();
    rollback = vi.fn().mockResolvedValue(undefined);
  },
  bestEffort: mocks.bestEffort,
  cleanupDeployedWorkers: vi.fn().mockResolvedValue(undefined),
  cleanupProvisionedResources: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/routing', () => ({
  upsertHostnameRouting: mocks.upsertHostnameRouting,
}));

vi.mock('@/services/platform/mcp', () => ({
  deleteManagedMcpServersByBundleDeployment: mocks.deleteManagedMcpServersByBundleDeployment,
}));

vi.mock('@/services/common-env', () => ({
  TAKOS_ACCESS_TOKEN_ENV_NAME: 'TAKOS_ACCESS_TOKEN',
}));

import { executeBundleInstallPipeline } from '@/services/takopack/bundle-install-pipeline';
import type { BundleInstallPipelineParams } from '@/services/takopack/bundle-install-pipeline';
import type { TakopackManifest } from '@/services/takopack/types';

function createMockDb() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(null),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  };
}

function createBaseManifest(): TakopackManifest {
  return {
    manifestVersion: 'vnext-infra-v1alpha1',
    meta: {
      name: 'test-pack',
      appId: 'dev.takos.test',
      version: '1.0.0',
      createdAt: '2026-03-01T00:00:00.000Z',
    },
    objects: [],
  };
}

function createPipelineParams(overrides?: Partial<BundleInstallPipelineParams>): BundleInstallPipelineParams {
  const db = createMockDb();
  return {
    env: { DB: {} } as any,
    db: db as any,
    resourceService: {
      provisionOrAdoptResources: vi.fn().mockResolvedValue({ d1: [], r2: [], kv: [] }),
    } as any,
    workerService: {
      deployManifestWorkers: vi.fn().mockResolvedValue([]),
    } as any,
    toolService: {
      registerManagedMcpServer: vi.fn().mockResolvedValue(undefined),
    } as any,
    groupService: {
      createShortcutGroup: vi.fn().mockResolvedValue('group-1'),
    } as any,
    commonEnvService: {
      ensureRequiredLinks: vi.fn().mockResolvedValue(undefined),
      upsertWorkerTakosAccessTokenConfig: vi.fn().mockResolvedValue(undefined),
      reconcileWorkers: vi.fn().mockResolvedValue(undefined),
    } as any,
    infraService: {
      upsertWorker: vi.fn().mockResolvedValue(undefined),
      upsertEndpoint: vi.fn().mockResolvedValue(undefined),
      buildRoutingTarget: vi.fn().mockResolvedValue(null),
    } as any,
    spaceId: 'ws-1',
    userId: 'user-1',
    bundleDeploymentId: 'tp-1',
    installKey: 'key-123',
    manifest: createBaseManifest(),
    semver: { major: 1, minor: 0, patch: 0 },
    files: new Map(),
    normalizedApplyReport: [],
    replacedBundleDeploymentId: null,
    requiredEnvKeys: [],
    appBaseUrlForAutoEnv: null,
    tracker: {
      add: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
    } as any,
    hostname: 'test.app.takos.jp',
    ...overrides,
  };
}

describe('executeBundleInstallPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(createMockDb());
  });

  it('returns install result for a minimal manifest', async () => {
    const params = createPipelineParams();
    const result = await executeBundleInstallPipeline(params);

    expect(result.bundleDeploymentId).toBe('tp-1');
    expect(result.appId).toBe('dev.takos.test');
    expect(result.name).toBe('test-pack');
    expect(result.version).toBe('1.0.0');
    expect(result.groupsCreated).toBe(0);
    expect(result.toolsCreated).toBe(0);
    expect(result.resourcesCreated).toEqual({ d1: 0, r2: 0, kv: 0 });
  });

  it('inserts bundle deployment record for new install', async () => {
    const db = createMockDb();
    const params = createPipelineParams({ db: db as any });

    await executeBundleInstallPipeline(params);

    expect(db.insert).toHaveBeenCalled();
  });

  it('updates bundle deployment record for in-place replacement', async () => {
    const db = createMockDb();
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            accountId: 'ws-1',
            name: 'old-pack',
            appId: 'dev.takos.old',
            bundleKey: 'old-key',
            version: '0.9.0',
            versionMajor: 0,
            versionMinor: 9,
            versionPatch: 0,
          }),
        }),
      }),
    });

    const params = createPipelineParams({
      db: db as any,
      replacedBundleDeploymentId: 'tp-1',
      bundleDeploymentId: 'tp-1',
    });

    await executeBundleInstallPipeline(params);

    expect(db.update).toHaveBeenCalled();
  });

  it('provisions resources when manifest declares them', async () => {
    const resourceService = {
      provisionOrAdoptResources: vi.fn().mockResolvedValue({
        d1: [{ binding: 'DB', id: 'cf-1', name: 'db-1', resourceId: 'res-1', wasAdopted: false }],
        r2: [],
        kv: [],
      }),
    };

    const manifest = createBaseManifest();
    manifest.resources = { d1: [{ binding: 'DB' }] };

    const params = createPipelineParams({
      manifest,
      resourceService: resourceService as any,
    });

    const result = await executeBundleInstallPipeline(params);

    expect(resourceService.provisionOrAdoptResources).toHaveBeenCalledTimes(1);
    expect(result.resourcesCreated.d1).toBe(1);
  });

  it('creates shortcut group when manifest declares group', async () => {
    const groupService = {
      createShortcutGroup: vi.fn().mockResolvedValue('group-1'),
    };

    const manifest = createBaseManifest();
    manifest.group = {
      workers: ['api'],
      ui: [],
      resources: { d1: [], r2: [], kv: [] },
      links: [],
    };

    const params = createPipelineParams({
      manifest,
      groupService: groupService as any,
    });

    const result = await executeBundleInstallPipeline(params);

    expect(groupService.createShortcutGroup).toHaveBeenCalledTimes(1);
    expect(result.groupsCreated).toBe(1);
  });

  it('registers MCP servers when manifest declares them', async () => {
    const toolService = {
      registerManagedMcpServer: vi.fn().mockResolvedValue(undefined),
    };

    const manifest = createBaseManifest();
    manifest.mcpServers = [{
      name: 'my-mcp',
      transport: 'streamable-http',
      worker: 'api',
      endpoint: 'main-http',
      path: '/mcp',
    }];

    const params = createPipelineParams({
      manifest,
      toolService: toolService as any,
    });

    const result = await executeBundleInstallPipeline(params);

    expect(toolService.registerManagedMcpServer).toHaveBeenCalledTimes(1);
    expect(result.toolsCreated).toBe(1);
  });

  it('deploys workers and registers infra entries', async () => {
    const workerService = {
      deployManifestWorkers: vi.fn().mockResolvedValue([{
        manifestWorkerName: 'api',
        workerId: 'w-1',
        workerName: 'worker-w1',
        artifactRef: 'artifact-1',
        slug: 'test-api-w1',
        hostname: 'test-api-w1.app.takos.jp',
      }]),
    };

    const infraService = {
      upsertWorker: vi.fn().mockResolvedValue(undefined),
      upsertEndpoint: vi.fn().mockResolvedValue(undefined),
      buildRoutingTarget: vi.fn().mockResolvedValue(null),
    };

    const manifest = createBaseManifest();
    manifest.workers = [{
      name: 'api',
      bundle: 'dist/api.mjs',
      bundleHash: 'sha256:abc',
      bundleSize: 100,
      bindings: { d1: [], r2: [], kv: [] },
      env: {},
    }];

    const params = createPipelineParams({
      manifest,
      workerService: workerService as any,
      infraService: infraService as any,
    });

    await executeBundleInstallPipeline(params);

    expect(workerService.deployManifestWorkers).toHaveBeenCalledTimes(1);
    expect(infraService.upsertWorker).toHaveBeenCalledTimes(1);
  });

  it('includes apply report entries in the result', async () => {
    const params = createPipelineParams({
      normalizedApplyReport: [
        {
          objectName: 'Package',
          kind: 'Package',
          phase: 'planned',
          status: 'success',
          message: 'Planned',
        },
        {
          objectName: 'Note',
          kind: 'Package',
          phase: 'validated',
          status: 'success',
          message: 'Validated',
        },
      ],
    });

    const result = await executeBundleInstallPipeline(params);

    // Should contain both original and applied entries
    expect(result.applyReport.length).toBeGreaterThanOrEqual(2);
    const appliedEntries = result.applyReport.filter((e) => e.phase === 'applied');
    expect(appliedEntries).toHaveLength(1);
    expect(appliedEntries[0].objectName).toBe('Package');
  });
});
