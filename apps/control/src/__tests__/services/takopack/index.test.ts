import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  parsePackage: vi.fn(),
  checkRepoAccess: vi.fn(),
  resolveAllowedCapabilities: vi.fn(),
  createClient: vi.fn(),
  deleteClient: vi.fn(),
  deleteHostnameRouting: vi.fn(),
  wfpDeleteWorker: vi.fn(),
  wfpDeleteD1Database: vi.fn(),
  wfpDeleteR2Bucket: vi.fn(),
  wfpDeleteKVNamespace: vi.fn(),
}));

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

vi.mock('@/utils', async () => {
  const actual = await vi.importActual<typeof import('@/utils')>('@/utils');
  return {
    ...actual,
    now: () => '2026-03-01T00:00:00.000Z',
    safeJsonParseOrDefault: <T>(value: string | null | undefined, fallback: T): T => {
      if (typeof value !== 'string') return fallback;
      try {
        return JSON.parse(value) as T;
      } catch {
        return fallback;
      }
    },
  };
});

vi.mock('@/services/takopack/manifest', async () => {
  const actual = await vi.importActual<typeof import('@/services/takopack/manifest')>('@/services/takopack/manifest');
  return {
    ...actual,
    parsePackage: mocks.parsePackage,
  };
});

vi.mock('@/services/source/repos', () => ({
  checkRepoAccess: mocks.checkRepoAccess,
}));

vi.mock('@/services/platform/capabilities', () => ({
  capabilityRegistry: {
    validate: () => ({ known: [], unknown: [], duplicates: [] }),
  },
  resolveAllowedCapabilities: mocks.resolveAllowedCapabilities,
}));

vi.mock('@/services/oauth/client', () => ({
  createClient: mocks.createClient,
  deleteClient: mocks.deleteClient,
}));

vi.mock('@/services/routing', () => ({
  deleteHostnameRouting: mocks.deleteHostnameRouting,
}));

vi.mock('@/services/platform/mcp', () => ({
  deleteManagedMcpServersByBundleDeployment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/platform/infra', () => ({
  InfraService: class {
    deleteByBundleDeployment = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('@/services/common-env', () => ({
  CommonEnvService: class {
    deleteWorkerTakosAccessTokenConfigs = vi.fn().mockResolvedValue(undefined);
  },
  TAKOS_ACCESS_TOKEN_ENV_NAME: 'TAKOS_ACCESS_TOKEN',
}));

vi.mock('@/services/wfp', () => ({
  WFPService: class {
    deleteWorker = mocks.wfpDeleteWorker;
    deleteD1Database = mocks.wfpDeleteD1Database;
    deleteR2Bucket = mocks.wfpDeleteR2Bucket;
    deleteKVNamespace = mocks.wfpDeleteKVNamespace;
  },
}));

import { BundleDeploymentOrchestrator } from '@/services/platform/bundle-deployment-orchestrator';

function createService(envOverrides: Partial<Record<string, unknown>> = {}): BundleDeploymentOrchestrator {
  const env = createMockEnv(envOverrides) as unknown as Env;
  return new BundleDeploymentOrchestrator(env);
}

function createUninstallDbMock(resourceRecord: {
  id: string;
  type: string;
  cfId: string | null;
  cfName: string | null;
  config: string;
  metadata: string;
  manifestKey?: string | null;
}) {
  // Production code uninstall() uses drizzle chains:
  //   db.select({...}).from(bundleDeployments).where(...).get() -> deployment
  //   db.select({...}).from(workers).where(...).all() -> workers
  //   db.select({resourceId}).from(workerBindings).where(...).all() -> bindings
  //   db.select({artifactRef}).from(deployments).where(...).all() -> deployment artifacts
  //   db.delete(workerBindings).where(...) -> delete bindings
  //   db.delete(workers).where(...) -> delete workers
  //   db.select({resourceId}).from(workerBindings).where(...).all() -> external bindings
  //   db.select({...}).from(resources).where(...).all() -> resources
  //   db.delete(resources).where(...) -> delete resource
  //   db.delete(shortcutGroupItems).where(...) -> cleanup
  //   db.delete(shortcutGroups).where(...) -> cleanup
  //   db.delete(uiExtensions).where(...) -> cleanup
  //   db.delete(fileHandlers).where(...) -> cleanup
  //   db.delete(bundleDeployments).where(...) -> delete deployment
  //   db.update(bundleDeploymentEvents).set(...).where(...) -> update events
  const selectGet = vi.fn()
    .mockResolvedValueOnce({  // bundleDeployment lookup
      id: 'tp-1',
      manifestJson: JSON.stringify({
        manifestVersion: '1',
        meta: {
          name: 'demo',
          version: '1.0.0',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
      }),
      oauthClientId: null,
    })
    .mockResolvedValue(null);
  const selectAll = vi.fn()
    .mockResolvedValueOnce([{   // workers
      id: 'worker-1',
      workerName: 'worker-one',
      hostname: null,
      config: JSON.stringify({
        source: 'bundle_deployment',
        bundle_deployment_id: 'tp-1',
      }),
    }])
    .mockResolvedValueOnce([{ resourceId: resourceRecord.id }]) // workerBindings
    .mockResolvedValueOnce([])   // deployment artifacts
    .mockResolvedValueOnce([])   // external bindings (no shared resources)
    .mockResolvedValueOnce([resourceRecord]) // resources for cleanup
    .mockResolvedValueOnce([])   // uiExtensions
    .mockResolvedValueOnce([])   // shortcutGroups
    .mockResolvedValue([]);      // any remaining

  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const resourceDeleteSpy = vi.fn().mockResolvedValue(undefined);

  const chain = () => {
    const c: Record<string, unknown> = {};
    c.from = vi.fn().mockReturnValue(c);
    c.where = vi.fn().mockReturnValue(c);
    c.orderBy = vi.fn().mockReturnValue(c);
    c.limit = vi.fn().mockReturnValue(c);
    c.innerJoin = vi.fn().mockReturnValue(c);
    c.all = selectAll;
    c.get = selectGet;
    return c;
  };

  const updateChain = () => {
    const c: Record<string, unknown> = {};
    c.set = vi.fn().mockReturnValue(c);
    c.where = vi.fn().mockResolvedValue(undefined);
    return c;
  };

  const dbMock = {
    select: vi.fn().mockImplementation(() => chain()),
    update: vi.fn().mockImplementation(() => updateChain()),
    delete: vi.fn().mockImplementation(() => ({
      where: resourceDeleteSpy,
    })),
    _resourceDeleteSpy: resourceDeleteSpy,
  };
  return dbMock;
}

describe('BundleDeploymentOrchestrator safety guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRepoAccess.mockResolvedValue(true);
    mocks.resolveAllowedCapabilities.mockResolvedValue({ allowed: new Set<string>() });
  });

  it('fails closed before install when selected dependencies resolve to duplicate appIds', async () => {
    // Production code uses drizzle chains and raw SQL.
    // 1. db.select({...}).from(bundleDeployments).where(...).orderBy(...).all() -> installed (empty)
    // 2. db.all(sql`...`) -> resolve repo refs (two calls)
    // 3. db.select().from(repoReleases).where(...).orderBy(...).limit(...).all() -> releases
    // 4. db.select().from(repoReleaseAssets).where(...).orderBy(...).all() -> release assets
    const selectAll = vi.fn()
      .mockResolvedValueOnce([])  // installed bundleDeployments (empty)
      .mockResolvedValueOnce([{   // repoReleases for repo-a
        id: 'release-a', repoId: 'repo-a', tag: 'v1.0.0',
        isDraft: false, isPrerelease: false, publishedAt: '2026-03-01T00:00:00.000Z',
      }])
      .mockResolvedValueOnce([{   // repoReleaseAssets for release-a
        id: 'asset-a', releaseId: 'release-a', assetKey: 'k-a',
        name: 'a.takopack', contentType: 'application/zip',
        sizeBytes: 1, downloadCount: 0,
        bundleFormat: 'takopack',
        bundleMetaJson: JSON.stringify({
          name: 'shared-app', version: '1.0.0', dependencies: [],
        }),
        createdAt: '2026-03-01T00:00:00.000Z',
      }])
      .mockResolvedValueOnce([{   // repoReleases for repo-b
        id: 'release-b', repoId: 'repo-b', tag: 'v1.0.0',
        isDraft: false, isPrerelease: false, publishedAt: '2026-03-01T00:00:00.000Z',
      }])
      .mockResolvedValueOnce([{   // repoReleaseAssets for release-b
        id: 'asset-b', releaseId: 'release-b', assetKey: 'k-b',
        name: 'b.takopack', contentType: 'application/zip',
        sizeBytes: 1, downloadCount: 0,
        bundleFormat: 'takopack',
        bundleMetaJson: JSON.stringify({
          name: 'shared-app', version: '1.0.0', dependencies: [],
        }),
        createdAt: '2026-03-01T00:00:00.000Z',
      }]);
    const chain = () => {
      const c: Record<string, unknown> = {};
      c.from = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.orderBy = vi.fn().mockReturnValue(c);
      c.limit = vi.fn().mockReturnValue(c);
      c.all = selectAll;
      c.get = vi.fn().mockResolvedValue(null);
      return c;
    };
    const dbLocal = {
      select: vi.fn().mockImplementation(() => chain()),
      all: vi.fn()
        .mockResolvedValueOnce([{
          id: 'repo-a', name: 'alpha', visibility: 'public', owner_username: 'alice',
        }])
        .mockResolvedValueOnce([{
          id: 'repo-b', name: 'beta', visibility: 'public', owner_username: 'alice',
        }]),
    };
    mocks.getDb.mockReturnValue(dbLocal);

    const service = createService();
    const installFromGitSpy = vi.spyOn(service, 'installFromGit').mockResolvedValue({
      bundleDeploymentId: 'unused',
      name: 'unused',
      appId: 'unused.app',
      version: '1.0.0',
      groupsCreated: 0,
      toolsCreated: 0,
      resourcesCreated: { d1: 0, r2: 0, kv: 0 },
      applyReport: [],
    });

    await expect(
      (service as unknown as {
        resolveAndInstallDependencies: (
          spaceId: string,
          userId: string,
          manifest: unknown
        ) => Promise<void>;
      }).resolveAndInstallDependencies('ws-1', 'user-1', {
        manifestVersion: '1',
        meta: {
          name: 'root-app',
          version: '1.0.0',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
        dependencies: [
          { repo: '@alice/alpha', version: '^1.0.0' },
          { repo: '@alice/beta', version: '^1.0.0' },
        ],
      })
    ).rejects.toThrow(/Dependency appId conflict/);

    expect(installFromGitSpy).not.toHaveBeenCalled();
  });

  it('fails closed when oauth.autoEnv is enabled without APP_BASE_URL source', async () => {
    mocks.getDb.mockReturnValue({});
    mocks.parsePackage.mockResolvedValue({
      manifest: {
        manifestVersion: '1',
        meta: {
          name: 'oauth-app',
          version: '1.0.0',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
        oauth: {
          clientName: 'OAuth App',
          redirectUris: ['https://${HOSTNAME}/oauth/callback'],
          scopes: ['openid'],
          autoEnv: true,
        },
      },
      files: new Map<string, ArrayBuffer>(),
    });

    const service = createService({ ADMIN_DOMAIN: '' });

    await expect(
      service.install('ws-1', 'user-1', new ArrayBuffer(1), {
        requireAutoEnvApproval: true,
        oauthAutoEnvApproved: true,
      })
    ).rejects.toThrow(/requires APP_BASE_URL source/);
  });

  it('fails closed when TAKOS_ACCESS_TOKEN is required without Package.spec.takos.scopes', async () => {
    mocks.getDb.mockReturnValue({});
    mocks.parsePackage.mockResolvedValue({
      manifest: {
        manifestVersion: '1',
        meta: {
          name: 'takos-app',
          version: '1.0.0',
          createdAt: '2026-03-01T00:00:00.000Z',
        },
        env: {
          required: ['TAKOS_ACCESS_TOKEN'],
        },
      },
      files: new Map<string, ArrayBuffer>(),
    });

    const service = createService();

    await expect(
      service.install('ws-1', 'user-1', new ArrayBuffer(1))
    ).rejects.toThrow(/Package\.spec\.takos\.scopes is missing/);
  });

  it('lists takopacks with the minimal column set required by the inventory API', async () => {
    // Production code: db.select({...}).from(bundleDeployments).where(...).orderBy(...).all()
    const selectAll = vi.fn().mockResolvedValue([{
      id: 'tp-1',
      name: 'demo-pack',
      appId: 'dev.takos.demo-pack',
      version: '1.2.3',
      description: 'Demo',
      icon: 'icon.svg',
      deployedAt: '2026-03-01T00:00:00.000Z',
      versionMajor: 1,
      versionMinor: 2,
      versionPatch: 3,
      sourceType: 'git',
      sourceRepoId: 'repo-1',
      sourceTag: 'v1.2.3',
      sourceAssetId: 'asset-1',
      isLocked: true,
      lockedAt: '2026-03-02T00:00:00.000Z',
      lockedByAccountId: 'principal-1',
    }]);
    const chain = () => {
      const c: Record<string, unknown> = {};
      c.from = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.orderBy = vi.fn().mockReturnValue(c);
      c.limit = vi.fn().mockReturnValue(c);
      c.all = selectAll;
      c.get = vi.fn().mockResolvedValue(null);
      return c;
    };
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockImplementation(() => chain()),
    });

    const service = createService();

    await expect(service.list('ws-1')).resolves.toEqual([{
      id: 'tp-1',
      name: 'demo-pack',
      appId: 'dev.takos.demo-pack',
      version: '1.2.3',
      description: 'Demo',
      icon: 'icon.svg',
      installedAt: '2026-03-01T00:00:00.000Z',
      versionMajor: 1,
      versionMinor: 2,
      versionPatch: 3,
      sourceType: 'git',
      sourceRepoId: 'repo-1',
      sourceTag: 'v1.2.3',
      sourceAssetId: 'asset-1',
      isPinned: true,
      pinnedAt: '2026-03-02T00:00:00.000Z',
      pinnedBy: 'principal-1',
    }]);

    expect(selectAll).toHaveBeenCalledTimes(1);
  });

  it('propagates invalid array buffer error from takopack inventory lookup', async () => {
    // Production code no longer has a retry/fallback for this error.
    const selectAll = vi.fn().mockRejectedValue(new Error('Invalid array buffer length'));
    const chain = () => {
      const c: Record<string, unknown> = {};
      c.from = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.orderBy = vi.fn().mockReturnValue(c);
      c.limit = vi.fn().mockReturnValue(c);
      c.all = selectAll;
      c.get = vi.fn().mockResolvedValue(null);
      return c;
    };
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockImplementation(() => chain()),
    });

    const service = createService();

    await expect(service.list('ws-1')).rejects.toThrow('Invalid array buffer length');
  });

  it('does not delete bound resources on uninstall when provenance is missing', async () => {
    const dbLocal = createUninstallDbMock({
      id: 'res-1',
      type: 'd1',
      cfId: 'cf-d1-1',
      cfName: 'd1-one',
      config: '{}',
      metadata: '{}',
    });
    mocks.getDb.mockReturnValue(dbLocal);

    const service = createService();
    await service.uninstall('ws-1', 'tp-1');

    expect(mocks.wfpDeleteD1Database).not.toHaveBeenCalled();
  });

  it('deletes bound resources on uninstall when takopack provenance matches', async () => {
    const dbLocal = createUninstallDbMock({
      id: 'res-1',
      type: 'd1',
      cfId: 'cf-d1-1',
      cfName: 'd1-one',
      config: '{}',
      metadata: '{}',
      manifestKey: 'takopack:bundle-key-1:DB',
    });
    mocks.getDb.mockReturnValue(dbLocal);

    const service = createService();
    await service.uninstall('ws-1', 'tp-1');

    expect(mocks.wfpDeleteD1Database).toHaveBeenCalledWith('cf-d1-1');
    // Verify resource delete was called through drizzle chain
    expect(dbLocal._resourceDeleteSpy).toHaveBeenCalled();
  });
});
