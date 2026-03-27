import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  provisionCloudflareResource: vi.fn(),
  CloudflareResourceService: vi.fn(),
  getPackageFile: vi.fn(),
  normalizePackagePath: vi.fn((p: string) => p.replace(/^\.?\//, '')),
  normalizePackageDirectory: vi.fn((p: string) => {
    const normalized = p.replace(/^\.?\//, '');
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
  }),
  decodeArrayBuffer: vi.fn((buf: ArrayBuffer) => new TextDecoder().decode(buf)),
  looksLikeSQL: vi.fn(),
  executeD1Query: vi.fn(),
  queryD1: vi.fn(),
  generateId: vi.fn().mockReturnValue('abc123'),
}));

vi.mock('../../../../../../packages/control/src/infra/db/index.ts', () => ({
  getDb: mocks.getDb,
}));

vi.mock('../../../../../../packages/control/src/shared/utils/index.ts', () => ({
  generateId: mocks.generateId,
}));

vi.mock('../../../../../../packages/control/src/shared/utils/logger.ts', () => ({
  logError: vi.fn(),
}));

vi.mock('../../../../../../packages/control/src/platform/providers/cloudflare/resources.ts', () => ({
  CloudflareResourceService: class {
    executeD1Query = mocks.executeD1Query;
    queryD1 = mocks.queryD1;
    deleteResource = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../../../../../../packages/control/src/application/services/resources/index.ts', () => ({
  provisionCloudflareResource: mocks.provisionCloudflareResource,
}));

vi.mock('../../../../../../packages/control/src/application/services/takopack/manifest.ts', () => ({
  getPackageFile: mocks.getPackageFile,
  normalizePackagePath: mocks.normalizePackagePath,
  normalizePackageDirectory: mocks.normalizePackageDirectory,
  decodeArrayBuffer: mocks.decodeArrayBuffer,
  looksLikeSQL: mocks.looksLikeSQL,
  getRequiredPackageFile: vi.fn(),
}));

import { TakopackResourceService } from '../../../../../../packages/control/src/application/services/takopack/resources.ts';

function createService() {
  return new TakopackResourceService({
    DB: {},
    CF_ACCOUNT_ID: 'test-account',
    CF_API_TOKEN: 'test-token',
    WFP_DISPATCH_NAMESPACE: 'test-namespace',
  } as any);
}

describe('TakopackResourceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeD1Query.mockResolvedValue(undefined);
    mocks.queryD1.mockResolvedValue([]);
    const selectGet = vi.fn().mockResolvedValue(undefined);
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    mocks.getDb.mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: selectGet,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: updateWhere,
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it('provisions D1 resources', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-d1-1',
      cfId: 'cf-d1-1',
    });

    const service = createService();
    const result = await service.provisionOrAdoptResources(
      'ws-1',
      'user-1',
      'test-pack',
      'bundle-key',
      'bundle-deployment-1',
      { d1: [{ binding: 'DB' }] },
      new Map(),
    );

    expect(result.d1).toHaveLength(1);
    expect(result.d1[0]).toEqual({
      binding: 'DB',
      id: 'cf-d1-1',
      name: expect.stringContaining('test-pack'),
      resourceId: 'res-d1-1',
      wasAdopted: false,
    });
    expect(mocks.provisionCloudflareResource).toHaveBeenCalledTimes(1);
  });

  it('provisions R2 resources', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-r2-1',
      cfId: null,
    });

    const service = createService();
    const result = await service.provisionOrAdoptResources(
      'ws-1',
      'user-1',
      'test-pack',
      'bundle-key',
      'bundle-deployment-1',
      { r2: [{ binding: 'STORAGE' }] },
      new Map(),
    );

    expect(result.r2).toHaveLength(1);
    expect(result.r2[0]).toEqual({
      binding: 'STORAGE',
      name: expect.stringContaining('test-pack'),
      resourceId: 'res-r2-1',
      wasAdopted: false,
    });
  });

  it('provisions KV resources', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-kv-1',
      cfId: 'cf-kv-1',
    });

    const service = createService();
    const result = await service.provisionOrAdoptResources(
      'ws-1',
      'user-1',
      'test-pack',
      'bundle-key',
      'bundle-deployment-1',
      { kv: [{ binding: 'CACHE' }] },
      new Map(),
    );

    expect(result.kv).toHaveLength(1);
    expect(result.kv[0]).toEqual({
      binding: 'CACHE',
      id: 'cf-kv-1',
      name: expect.stringContaining('test-pack'),
      resourceId: 'res-kv-1',
      wasAdopted: false,
    });
  });

  it('provisions Queue resources and persists queue config', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-queue-1',
      cfId: 'cf-queue-1',
    });

    const service = createService();
    const result = await service.provisionOrAdoptResources(
      'ws-1',
      'user-1',
      'test-pack',
      'bundle-key',
      'bundle-deployment-1',
      {
        queue: [{
          binding: 'JOBS',
          maxRetries: 5,
          deadLetterQueue: 'JOBS_DLQ',
          deliveryDelaySeconds: 30,
        }],
      },
      new Map(),
    );

    expect(result.queue).toHaveLength(1);
    expect(result.queue[0]).toEqual({
      binding: 'JOBS',
      id: 'cf-queue-1',
      name: expect.stringContaining('test-pack'),
      resourceId: 'res-queue-1',
      wasAdopted: false,
    });
    expect(mocks.provisionCloudflareResource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'queue',
        config: {
          maxRetries: 5,
          deadLetterQueue: 'JOBS_DLQ',
          deliveryDelaySeconds: 30,
        },
      }),
    );
  });

  it('provisions Analytics Engine resources and uses explicit dataset names when provided', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-analytics-1',
      cfId: null,
    });

    const service = createService();
    const result = await service.provisionOrAdoptResources(
      'ws-1',
      'user-1',
      'test-pack',
      'bundle-key',
      'bundle-deployment-1',
      {
        analyticsEngine: [{ binding: 'EVENTS', dataset: 'tenant-events' }],
      },
      new Map(),
    );

    expect(result.analyticsEngine).toHaveLength(1);
    expect(result.analyticsEngine[0]).toEqual({
      binding: 'EVENTS',
      name: 'tenant-events',
      resourceId: 'res-analytics-1',
      wasAdopted: false,
    });
    expect(mocks.provisionCloudflareResource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'analytics_engine',
        cfName: 'tenant-events',
        config: {
          dataset: 'tenant-events',
        },
      }),
    );
  });

  it('provisions queue resources', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-queue-1',
      cfId: 'queue-id-1',
      cfName: 'my-queue',
    });

    const service = createService();
    const result = await service.provisionOrAdoptResources(
      'ws-1',
      'user-1',
      'test-pack',
      'bundle-key',
      'bundle-deployment-1',
      { queue: [{ binding: 'JOBS' }] },
      new Map(),
    );

    expect(result.queue).toHaveLength(1);
    expect(result.queue[0]).toEqual({
      binding: 'JOBS',
      id: 'queue-id-1',
      name: expect.stringContaining('test-pack'),
      resourceId: 'res-queue-1',
      wasAdopted: false,
    });
  });

  it('provisions analytics engine resources', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-analytics-1',
      cfId: null,
      cfName: 'tenant-events',
    });

    const service = createService();
    const result = await service.provisionOrAdoptResources(
      'ws-1',
      'user-1',
      'test-pack',
      'bundle-key',
      'bundle-deployment-1',
      { analyticsEngine: [{ binding: 'EVENTS', dataset: 'tenant-events' }] },
      new Map(),
    );

    expect(result.analyticsEngine).toHaveLength(1);
    expect(result.analyticsEngine[0]).toEqual({
      binding: 'EVENTS',
      name: 'tenant-events',
      resourceId: 'res-analytics-1',
      wasAdopted: false,
    });
  });

  it('provisions all resource types together', async () => {
    let callCount = 0;
    mocks.provisionCloudflareResource.mockImplementation(async () => {
      callCount++;
      return { id: `res-${callCount}`, cfId: `cf-${callCount}` };
    });

    const service = createService();
    const result = await service.provisionOrAdoptResources(
      'ws-1',
      'user-1',
      'test-pack',
      'bundle-key',
      'bundle-deployment-1',
      {
        d1: [{ binding: 'DB' }],
        r2: [{ binding: 'STORAGE' }],
        kv: [{ binding: 'CACHE' }],
        queue: [{ binding: 'JOBS' }],
        analyticsEngine: [{ binding: 'EVENTS', dataset: 'tenant-events' }],
      },
      new Map(),
    );

    expect(result.d1).toHaveLength(1);
    expect(result.r2).toHaveLength(1);
    expect(result.kv).toHaveLength(1);
    expect(result.queue).toHaveLength(1);
    expect(result.analyticsEngine).toHaveLength(1);
    expect(mocks.provisionCloudflareResource).toHaveBeenCalledTimes(5);
  });

  it('returns empty results when no resources are specified', async () => {
    const service = createService();
    const result = await service.provisionOrAdoptResources('ws-1', 'user-1', 'test-pack', 'bundle-key', 'bundle-deployment-1', {}, new Map());

    expect(result).toEqual({
      d1: [],
      r2: [],
      kv: [],
      queue: [],
      analyticsEngine: [],
      workflow: [],
      vectorize: [],
      durableObject: [],
    });
  });

  it('provisions workflow resources while keeping worker bindings out of scope', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-workflow-1',
      cfId: null,
      cfName: 'demo-runner',
    });

    const service = createService();
    const result = await service.provisionOrAdoptResources(
      'ws-1',
      'user-1',
      'test-pack',
      'bundle-key',
      'bundle-deployment-1',
      { workflow: [{ binding: 'RUNNER', service: 'api', export: 'run', timeoutMs: 15_000, maxRetries: 3 }] },
      new Map(),
    );

    expect(result.workflow).toEqual([{
      binding: 'RUNNER',
      name: expect.stringContaining('test-pack'),
      resourceId: 'res-workflow-1',
      wasAdopted: false,
    }]);
    expect(mocks.provisionCloudflareResource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'workflow',
        config: {
          service: 'api',
          export: 'run',
          timeoutMs: 15_000,
          maxRetries: 3,
        },
        workflow: {
          service: 'api',
          export: 'run',
          timeoutMs: 15_000,
          maxRetries: 3,
        },
      }),
    );
  });

  it('applies D1 migrations when specified', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-d1-1',
      cfId: 'cf-d1-1',
    });
    mocks.getPackageFile.mockReturnValue(new TextEncoder().encode('CREATE TABLE test;').buffer);
    mocks.executeD1Query.mockResolvedValue(undefined);
    mocks.queryD1.mockResolvedValue([]);

    const service = createService();
    await service.provisionOrAdoptResources(
      'ws-1',
      'user-1',
      'test-pack',
      'bundle-key',
      'bundle-deployment-1',
      { d1: [{ binding: 'DB', migrations: 'migrations/001.sql' }] },
      new Map(),
    );

    // 1st call: CREATE _takos_migrations, 2nd: migration SQL, 3rd: INSERT record
    expect(mocks.executeD1Query).toHaveBeenCalledTimes(3);
    expect(mocks.executeD1Query).toHaveBeenCalledWith('cf-d1-1', 'CREATE TABLE test;');
  });

  it('throws when D1 migration fails and rolls back', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-d1-1',
      cfId: 'cf-d1-1',
    });
    mocks.getPackageFile.mockReturnValue(new TextEncoder().encode('INVALID SQL').buffer);
    mocks.queryD1.mockResolvedValue([]);
    // First call (CREATE TABLE _takos_migrations) succeeds, second (migration SQL) fails
    mocks.executeD1Query
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('SQL error'));

    const service = createService();
    await expect(
      service.provisionOrAdoptResources(
        'ws-1',
        'user-1',
        'test-pack',
        'bundle-key',
        'bundle-deployment-1',
        { d1: [{ binding: 'DB', migrations: 'migrations/001.sql' }] },
        new Map(),
      ),
    ).rejects.toThrow('SQL error');
  });

  it('throws when D1 migration is specified but cfId is missing', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-d1-1',
      cfId: null,
    });

    const service = createService();
    await expect(
      service.provisionOrAdoptResources(
        'ws-1',
        'user-1',
        'test-pack',
        'bundle-key',
        'bundle-deployment-1',
        { d1: [{ binding: 'DB', migrations: 'migrations/001.sql' }] },
        new Map(),
      ),
    ).rejects.toThrow('missing Cloudflare database ID');
  });

  it('sanitizes package name for resource naming', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-1',
      cfId: 'cf-1',
    });

    const service = createService();
    await service.provisionOrAdoptResources(
      'ws-1',
      'user-1',
      'My Package Name!!',
      'bundle-key',
      'bundle-deployment-1',
      { d1: [{ binding: 'DB' }] },
      new Map(),
    );

    const call = mocks.provisionCloudflareResource.mock.calls[0];
    const cfName = call[1].cfName;
    expect(cfName).toMatch(/^[a-z0-9-]+$/);
    expect(cfName).not.toContain('!');
  });

  it('resolves migration directory with multiple SQL files', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-d1-1',
      cfId: 'cf-d1-1',
    });
    // getPackageFile returns null for directory reference, but files match the directory prefix
    mocks.getPackageFile.mockReturnValue(null);
    mocks.looksLikeSQL.mockReturnValue(false);
    mocks.executeD1Query.mockResolvedValue(undefined);

    const files = new Map<string, ArrayBuffer>();
    files.set('db/001.sql', new TextEncoder().encode('CREATE TABLE a;').buffer as ArrayBuffer);
    files.set('db/002.sql', new TextEncoder().encode('CREATE TABLE b;').buffer as ArrayBuffer);

    const service = createService();
    await service.provisionOrAdoptResources(
      'ws-1',
      'user-1',
      'test-pack',
      'bundle-key',
      'bundle-deployment-1',
      { d1: [{ binding: 'DB', migrations: 'db/' }] },
      files,
    );

    expect(mocks.executeD1Query).toHaveBeenCalledTimes(5);
  });

  it('falls back to inline SQL when ref looks like SQL', async () => {
    mocks.provisionCloudflareResource.mockResolvedValue({
      id: 'res-d1-1',
      cfId: 'cf-d1-1',
    });
    mocks.getPackageFile.mockReturnValue(null);
    mocks.looksLikeSQL.mockReturnValue(true);
    mocks.executeD1Query.mockResolvedValue(undefined);

    const service = createService();
    await service.provisionOrAdoptResources(
      'ws-1',
      'user-1',
      'test-pack',
      'bundle-key',
      'bundle-deployment-1',
      { d1: [{ binding: 'DB', migrations: 'CREATE TABLE inline_test (id INTEGER);' }] },
      new Map(),
    );

    // 1st: CREATE _takos_migrations, 2nd: migration SQL, 3rd: INSERT record
    expect(mocks.executeD1Query).toHaveBeenCalledTimes(3);
    expect(mocks.executeD1Query).toHaveBeenCalledWith('cf-d1-1', 'CREATE TABLE inline_test (id INTEGER);');
  });
});
