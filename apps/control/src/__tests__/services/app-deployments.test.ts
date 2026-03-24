import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const bucketGet = vi.fn();
  return {
    getDb: vi.fn(),
    checkRepoAccess: vi.fn(),
    resolveRef: vi.fn(),
    getCommitData: vi.fn(),
    getBlobAtPath: vi.fn(),
    getEntryAtPath: vi.fn(),
    flattenTree: vi.fn(),
    getBlob: vi.fn(),
    parseAppManifestYaml: vi.fn(),
    parseAndValidateWorkflowYaml: vi.fn(),
    validateDeployProducerJob: vi.fn(),
    appManifestToBundleDocs: vi.fn(),
    buildBundlePackageData: vi.fn(),
    extractBuildSourcesFromManifestJson: vi.fn(),
    install: vi.fn(),
    bucketGet,
    workerBundlesPut: vi.fn(),
  };
});

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/source/repos', () => ({
  checkRepoAccess: mocks.checkRepoAccess,
}));

vi.mock('@/services/git-smart', () => ({
  resolveRef: mocks.resolveRef,
  getCommitData: mocks.getCommitData,
  getBlobAtPath: mocks.getBlobAtPath,
  getEntryAtPath: mocks.getEntryAtPath,
  flattenTree: mocks.flattenTree,
  getBlob: mocks.getBlob,
}));

vi.mock('@/services/source/app-manifest', () => ({
  parseAppManifestYaml: mocks.parseAppManifestYaml,
  parseAndValidateWorkflowYaml: mocks.parseAndValidateWorkflowYaml,
  validateDeployProducerJob: mocks.validateDeployProducerJob,
  appManifestToBundleDocs: mocks.appManifestToBundleDocs,
  buildBundlePackageData: mocks.buildBundlePackageData,
  extractBuildSourcesFromManifestJson: mocks.extractBuildSourcesFromManifestJson,
  selectAppManifestPathFromRepo: (entries: ReadonlyArray<string>) => entries[0] || null,
}));

vi.mock('@/services/platform/bundle-deployment-orchestrator', () => ({
  createBundleDeploymentOrchestrator: () => ({
    install: mocks.install,
  }),
}));

import { AppDeploymentService } from '@/services/platform/app-deployments';

describe('AppDeploymentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRepoAccess.mockResolvedValue({
      spaceId: 'space-1',
      repo: { default_branch: 'main' },
    });
    mocks.resolveRef.mockResolvedValue('commit-1');
    mocks.getCommitData.mockResolvedValue({ tree: 'tree-1' });
    mocks.getBlobAtPath.mockImplementation(async (_bucket: unknown, _tree: string, filePath: string) => {
      if (filePath === '.takos/app.yml') return new TextEncoder().encode('manifest').buffer;
      if (filePath === '.takos/workflows/build.yml') return new TextEncoder().encode('workflow').buffer;
      return null;
    });
    mocks.parseAppManifestYaml.mockReturnValue({
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'App',
      metadata: { name: 'sample-app' },
      spec: {
        version: '1.0.0',
        services: {
          web: {
            type: 'worker',
            build: {
              fromWorkflow: {
                path: '.takos/workflows/build.yml',
                job: 'build-web',
                artifact: 'web-dist',
                artifactPath: 'dist/worker.mjs',
              },
            },
          },
        },
      },
    });
    mocks.parseAndValidateWorkflowYaml.mockReturnValue({
      jobs: { 'build-web': { runsOn: 'ubuntu-latest', steps: [] } },
    });
    mocks.appManifestToBundleDocs.mockReturnValue([{ kind: 'Package' }]);
    mocks.buildBundlePackageData.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    // Create Drizzle-compatible mock for workflow queries
    {
      const getMock = vi.fn();
      const allMock = vi.fn();
      const chain = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        get: getMock,
        all: allMock,
      };
      // Call sequence in resolveBuildArtifacts + resolveWorkflowArtifactFileForJob:
      // 1. all() -> matching workflow runs
      // 2. get() -> matching workflow job for the first run
      // 3. get() -> inventory artifact lookup (null = not found, falls back to prefix)
      allMock.mockResolvedValueOnce([
        { id: 'run-1', sha: 'sha-1', completedAt: '2026-01-01', createdAt: '2026-01-01' },
      ]);
      getMock
        .mockResolvedValueOnce({ id: 'job-1' })  // workflowJobs match
        .mockResolvedValueOnce(null);             // no inventory artifact -> prefix-fallback
      mocks.getDb.mockReturnValue({
        select: vi.fn(() => chain),
        insert: vi.fn(() => chain),
        update: vi.fn(() => chain),
        delete: vi.fn(() => chain),
      });
    }
    mocks.install.mockResolvedValue({
      bundleDeploymentId: 'bundle-1',
      appId: 'app-1',
      name: 'Sample App',
      version: '1.0.0',
      applyReport: [],
      resourcesCreated: [],
      sourceRepoId: 'repo-1',
      sourceTag: 'branch:main',
    });
  });

  it('resolves workflow artifacts from the successful job artifact prefix', async () => {
    mocks.bucketGet.mockImplementation(async (key: string) => {
      if (key === 'actions/artifacts/job-1/web-dist/dist/worker.mjs') {
        return {
          arrayBuffer: async () => new TextEncoder().encode('artifact').buffer,
        };
      }
      return null;
    });

    const service = new AppDeploymentService({
      DB: {} as never,
      GIT_OBJECTS: { get: mocks.bucketGet } as never,
      WORKER_BUNDLES: { put: mocks.workerBundlesPut } as never,
    } as never);

    const result = await service.deployFromRepoRef('space-1', 'user-1', {
      repoId: 'repo-1',
      ref: 'main',
      refType: 'branch',
    });

    expect(mocks.bucketGet).toHaveBeenCalledWith('actions/artifacts/job-1/web-dist/dist/worker.mjs');
    expect(mocks.workerBundlesPut).toHaveBeenCalled();
    expect(result.build_sources).toEqual([{
      service_name: 'web',
      workflow_path: '.takos/workflows/build.yml',
      workflow_job: 'build-web',
      workflow_artifact: 'web-dist',
      artifact_path: 'dist/worker.mjs',
      workflow_run_id: 'run-1',
      workflow_job_id: 'job-1',
      source_sha: 'sha-1',
    }]);
  });
});
