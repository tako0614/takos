import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  createDeploymentService: vi.fn(),
  getRequiredPackageFile: vi.fn(),
  decodeArrayBuffer: vi.fn(),
  assertManifestWorkerBundleIntegrity: vi.fn(),
  filterBindingsByCapabilities: vi.fn(),
  generateId: vi.fn(),
  now: vi.fn(),
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils', () => ({
  generateId: mocks.generateId,
  now: mocks.now,
}));

vi.mock('@/services/deployment', () => ({
  createDeploymentService: mocks.createDeploymentService,
}));

vi.mock('@/services/platform/capabilities', () => ({
  filterBindingsByCapabilities: mocks.filterBindingsByCapabilities,
}));

vi.mock('@/services/takopack/manifest', () => ({
  getRequiredPackageFile: mocks.getRequiredPackageFile,
  decodeArrayBuffer: mocks.decodeArrayBuffer,
  assertManifestWorkerBundleIntegrity: mocks.assertManifestWorkerBundleIntegrity,
}));

import { TakopackWorkerService } from '@/services/takopack/workers';

function createService() {
  return new TakopackWorkerService({
    DB: {},
    TENANT_BASE_DOMAIN: 'apps.test',
  } as any);
}

describe('TakopackWorkerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue({});
    mocks.createDeploymentService.mockReturnValue({
      createDeployment: vi.fn(),
      executeDeployment: vi.fn(),
    });
    mocks.getRequiredPackageFile.mockReturnValue(new TextEncoder().encode('export default { fetch() {} };').buffer);
    mocks.decodeArrayBuffer.mockReturnValue('export default { fetch() {} };');
    mocks.assertManifestWorkerBundleIntegrity.mockResolvedValue(undefined);
    mocks.filterBindingsByCapabilities.mockReturnValue({
      allowedBindings: [],
      deniedBindings: [],
    });
    mocks.generateId.mockReturnValue('svc-123456');
    mocks.now.mockReturnValue('2026-03-25T00:00:00.000Z');
  });

  it('fails closed when manifest workers declare scheduled triggers', async () => {
    const service = createService();

    await expect(service.deployManifestWorkers({
      spaceId: 'ws-1',
      takopackId: 'tp-1',
      packageName: 'demo-pack',
      capabilities: [],
      workers: [{
        name: 'api',
        bundle: 'dist/worker.js',
        bundleHash: 'hash',
        bundleSize: 10,
        env: {},
        bindings: { d1: [], r2: [], kv: [], queue: [], analytics: [], workflows: [], vectorize: [] },
        triggers: {
          schedules: [{ cron: '*/5 * * * *', export: 'onSchedule' }],
        },
      }],
      files: new Map(),
    } as any)).rejects.toThrow('Scheduled and queue trigger delivery require Takos-managed orchestration');
  });

  it('fails closed when manifest workers declare workflow bindings', async () => {
    const service = createService();

    await expect(service.deployManifestWorkers({
      spaceId: 'ws-1',
      takopackId: 'tp-1',
      packageName: 'demo-pack',
      capabilities: [],
      workers: [{
        name: 'api',
        bundle: 'dist/worker.js',
        bundleHash: 'hash',
        bundleSize: 10,
        env: {},
        bindings: {
          d1: [],
          r2: [],
          kv: [],
          queue: [],
          analytics: [],
          workflows: ['RUNNER'],
          vectorize: [],
        },
      }],
      files: new Map([
        ['dist/worker.js', new TextEncoder().encode('export default { fetch() {} };').buffer],
      ]),
      provisionedResources: {
        d1: [],
        r2: [],
        kv: [],
        queue: [],
        analyticsEngine: [],
        workflow: [{
          binding: 'RUNNER',
          name: 'demo-workflow',
          resourceId: 'res-workflow-1',
          wasAdopted: false,
        }],
        vectorize: [],
        durableObject: [],
      },
    } as any)).rejects.toThrow('workflow bindings are not materialized into tenant worker runtime bindings yet');
  });
});
