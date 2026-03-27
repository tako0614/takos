import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  nanoid: vi.fn().mockReturnValue('nano-id-1'),
  now: vi.fn().mockReturnValue('2026-03-01T00:00:00.000Z'),
  resolveServiceRouteSummaryForWorkspace: vi.fn(),
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
}));

vi.mock('nanoid', () => ({
  nanoid: mocks.nanoid,
}));

vi.mock('@/shared/utils', () => ({
  now: mocks.now,
}));

vi.mock('@/services/platform/workers', () => ({
  resolveServiceRouteSummaryForWorkspace: mocks.resolveServiceRouteSummaryForWorkspace,
}));

import {
  BundleShortcutGroupService,
  buildProvisionedResourceReferenceMaps,
} from '@/services/takopack/groups';
import type { TakopackManifest, ResourceProvisionResult } from '@/services/takopack/types';

function createMockDb() {
  return {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue(null),
        }),
      }),
    }),
  };
}

function createBaseManifest(groupOverrides?: Partial<NonNullable<TakopackManifest['group']>>): TakopackManifest {
  return {
    manifestVersion: 'vnext-infra-v1alpha1',
    meta: {
      name: 'test-pack',
      appId: 'dev.takos.test',
      version: '1.0.0',
      createdAt: '2026-03-01T00:00:00.000Z',
    },
    group: {
      workers: [],
      ui: [],
      resources: {
        d1: [],
        r2: [],
        kv: [],
        queue: [],
        analyticsEngine: [],
        workflow: [],
        vectorize: [],
        durableObject: [],
      },
      links: [],
      ...groupOverrides,
    },
    objects: [],
  };
}

describe('BundleShortcutGroupService', () => {
  let dbMock: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    dbMock = createMockDb();
    mocks.getDb.mockReturnValue(dbMock);
    mocks.resolveServiceRouteSummaryForWorkspace.mockResolvedValue(null);
  });

  it('creates a shortcut group with just metadata', async () => {
    const service = new BundleShortcutGroupService({ DB: {} } as any);
    const manifest = createBaseManifest();

    const groupId = await service.createShortcutGroup('ws-1', 'tp-1', manifest);

    expect(groupId).toBe('nano-id-1');
    expect(dbMock.insert).toHaveBeenCalledTimes(1); // Only shortcutGroups, no items
  });

  it('creates shortcut group items for workers', async () => {
    const service = new BundleShortcutGroupService({ DB: {} } as any);
    const manifest = createBaseManifest({ workers: ['api-worker'] });
    const workerMap = new Map([['api-worker', 'worker-id-1']]);

    await service.createShortcutGroup('ws-1', 'tp-1', manifest, {
      workers: workerMap,
    });

    // shortcutGroups insert + shortcutGroupItems insert
    expect(dbMock.insert).toHaveBeenCalledTimes(2);
  });

  it('creates shortcut group items for UI paths', async () => {
    const service = new BundleShortcutGroupService({ DB: {} } as any);
    const manifest = createBaseManifest({ ui: ['/dashboard'] });

    await service.createShortcutGroup('ws-1', 'tp-1', manifest);

    expect(dbMock.insert).toHaveBeenCalledTimes(2);
  });

  it('creates shortcut group items for resources', async () => {
    const service = new BundleShortcutGroupService({ DB: {} } as any);
    const manifest = createBaseManifest({
      resources: {
        d1: ['my-db'],
        r2: ['my-bucket'],
        kv: [],
        queue: [],
        analyticsEngine: [],
        workflow: [],
        vectorize: [],
        durableObject: [],
      },
    });

    const resourceMaps = {
      d1: new Map([['my-db', 'res-d1-1']]),
      r2: new Map([['my-bucket', 'res-r2-1']]),
      kv: new Map(),
      queue: new Map(),
      analyticsEngine: new Map(),
      workflow: new Map(),
      vectorize: new Map(),
      durableObject: new Map(),
    };

    await service.createShortcutGroup('ws-1', 'tp-1', manifest, {
      resources: resourceMaps,
    });

    expect(dbMock.insert).toHaveBeenCalledTimes(2);
  });

  it('creates shortcut group items for links', async () => {
    const service = new BundleShortcutGroupService({ DB: {} } as any);
    const manifest = createBaseManifest({
      links: [{ label: 'Docs', url: 'https://docs.example.com', icon: 'book' }],
    });

    await service.createShortcutGroup('ws-1', 'tp-1', manifest);

    expect(dbMock.insert).toHaveBeenCalledTimes(2);
  });

  it('resolves worker ID from DB when not in map', async () => {
    mocks.resolveServiceRouteSummaryForWorkspace.mockResolvedValue({ id: 'resolved-worker-id' });

    const service = new BundleShortcutGroupService({ DB: {} } as any);
    const manifest = createBaseManifest({ workers: ['api-worker'] });

    await service.createShortcutGroup('ws-1', 'tp-1', manifest);

    expect(mocks.resolveServiceRouteSummaryForWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      'ws-1',
      'api-worker',
    );
  });
});

describe('buildProvisionedResourceReferenceMaps', () => {
  it('returns empty maps when no resources are provisioned', () => {
    const maps = buildProvisionedResourceReferenceMaps(undefined);
    expect(maps.d1.size).toBe(0);
    expect(maps.r2.size).toBe(0);
    expect(maps.kv.size).toBe(0);
    expect(maps.queue.size).toBe(0);
    expect(maps.analyticsEngine.size).toBe(0);
    expect(maps.workflow.size).toBe(0);
    expect(maps.vectorize.size).toBe(0);
  });

  it('builds reference maps for D1 resources', () => {
    const provisioned: ResourceProvisionResult = {
      d1: [{ binding: 'DB', id: 'cf-d1-1', name: 'db-name', resourceId: 'res-d1-1', wasAdopted: false }],
      r2: [],
      kv: [],
      queue: [],
      analyticsEngine: [],
      workflow: [],
      vectorize: [],
      durableObject: [],
    };

    const maps = buildProvisionedResourceReferenceMaps(provisioned);

    expect(maps.d1.get('DB')).toBe('res-d1-1');
    expect(maps.d1.get('cf-d1-1')).toBe('res-d1-1');
    expect(maps.d1.get('db-name')).toBe('res-d1-1');
    expect(maps.d1.get('res-d1-1')).toBe('res-d1-1');
  });

  it('builds reference maps for R2 resources', () => {
    const provisioned: ResourceProvisionResult = {
      d1: [],
      r2: [{ binding: 'STORAGE', name: 'r2-bucket', resourceId: 'res-r2-1', wasAdopted: false }],
      kv: [],
      queue: [],
      analyticsEngine: [],
      workflow: [],
      vectorize: [],
      durableObject: [],
    };

    const maps = buildProvisionedResourceReferenceMaps(provisioned);

    expect(maps.r2.get('STORAGE')).toBe('res-r2-1');
    expect(maps.r2.get('r2-bucket')).toBe('res-r2-1');
    expect(maps.r2.get('res-r2-1')).toBe('res-r2-1');
  });

  it('builds reference maps for KV resources', () => {
    const provisioned: ResourceProvisionResult = {
      d1: [],
      r2: [],
      kv: [{ binding: 'CACHE', id: 'cf-kv-1', name: 'kv-name', resourceId: 'res-kv-1', wasAdopted: false }],
      queue: [],
      analyticsEngine: [],
      workflow: [],
      vectorize: [],
      durableObject: [],
    };

    const maps = buildProvisionedResourceReferenceMaps(provisioned);

    expect(maps.kv.get('CACHE')).toBe('res-kv-1');
    expect(maps.kv.get('cf-kv-1')).toBe('res-kv-1');
    expect(maps.kv.get('kv-name')).toBe('res-kv-1');
    expect(maps.kv.get('res-kv-1')).toBe('res-kv-1');
  });

  it('skips empty binding/name references', () => {
    const provisioned: ResourceProvisionResult = {
      d1: [{ binding: '', id: '', name: '', resourceId: 'res-d1-1', wasAdopted: false }],
      r2: [],
      kv: [],
      queue: [],
      analyticsEngine: [],
      workflow: [],
      vectorize: [],
      durableObject: [],
    };

    const maps = buildProvisionedResourceReferenceMaps(provisioned);

    // Only the non-empty resourceId should be set
    expect(maps.d1.get('res-d1-1')).toBe('res-d1-1');
    expect(maps.d1.get('')).toBeUndefined();
  });
});
