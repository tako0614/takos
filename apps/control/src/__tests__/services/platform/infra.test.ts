import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  generateId: vi.fn().mockReturnValue('infra-new'),
  now: vi.fn().mockReturnValue('2026-03-24T00:00:00.000Z'),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/utils')>()),
  generateId: mocks.generateId,
  now: mocks.now,
}));

import { InfraService } from '@/services/platform/infra';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    _: { get: getMock, all: allMock, run: runMock },
  };
}

function makeEnv(): Env {
  return { DB: {} } as unknown as Env;
}

describe('InfraService.upsertWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new infra worker when none exists', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined); // no existing
    mocks.getDb.mockReturnValue(drizzle);

    const service = new InfraService(makeEnv());
    const id = await service.upsertWorker({
      spaceId: 'ws-1',
      bundleDeploymentId: 'bd-1',
      name: 'api-worker',
      runtime: 'cloudflare.worker',
      cloudflareServiceRef: 'cf-api',
    });

    expect(id).toBe('infra-new');
    expect(drizzle.insert).toHaveBeenCalled();
  });

  it('updates existing infra worker', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({ id: 'existing-id' }); // existing found
    mocks.getDb.mockReturnValue(drizzle);

    const service = new InfraService(makeEnv());
    const id = await service.upsertWorker({
      spaceId: 'ws-1',
      bundleDeploymentId: 'bd-1',
      name: 'api-worker',
      runtime: 'cloudflare.worker',
    });

    expect(id).toBe('existing-id');
    expect(drizzle.update).toHaveBeenCalled();
  });
});

describe('InfraService.upsertEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new endpoint with routes', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined); // no existing
    mocks.getDb.mockReturnValue(drizzle);

    const service = new InfraService(makeEnv());
    const id = await service.upsertEndpoint({
      spaceId: 'ws-1',
      bundleDeploymentId: 'bd-1',
      name: 'api',
      protocol: 'http',
      targetServiceRef: 'api-worker',
      routes: [{ pathPrefix: '/api' }],
    });

    expect(id).toBe('infra-new');
    expect(drizzle.insert).toHaveBeenCalledTimes(2); // endpoint + route
  });

  it('replaces routes when updating existing endpoint', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({ id: 'ep-1' }); // existing found
    mocks.getDb.mockReturnValue(drizzle);

    const service = new InfraService(makeEnv());
    const id = await service.upsertEndpoint({
      spaceId: 'ws-1',
      bundleDeploymentId: 'bd-1',
      name: 'api',
      protocol: 'http',
      targetServiceRef: 'api-worker',
      routes: [{ pathPrefix: '/v2' }, { pathPrefix: '/health', methods: ['GET'] }],
    });

    expect(id).toBe('ep-1');
    expect(drizzle.delete).toHaveBeenCalled(); // delete old routes
    expect(drizzle.update).toHaveBeenCalled();
  });
});

describe('InfraService.buildRoutingTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no endpoints exist', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]); // no endpoints
    mocks.getDb.mockReturnValue(drizzle);

    const service = new InfraService(makeEnv());
    const target = await service.buildRoutingTarget('ws-1', 'bd-1');
    expect(target).toBeNull();
  });

  it('builds routing target from endpoints and workers', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all
      .mockResolvedValueOnce([
        { id: 'ep-1', accountId: 'ws-1', name: 'api', protocol: 'http', targetServiceRef: 'api-worker', timeoutMs: 30000, bundleDeploymentId: 'bd-1' },
      ]) // endpoints
      .mockResolvedValueOnce([
        { endpointId: 'ep-1', position: 0, pathPrefix: '/api', methodsJson: null },
      ]) // routes
      .mockResolvedValueOnce([
        { name: 'api-worker', cloudflareServiceRef: 'cf-api', runtime: 'cloudflare.worker' },
      ]); // workers
    mocks.getDb.mockReturnValue(drizzle);

    const service = new InfraService(makeEnv());
    const target = await service.buildRoutingTarget('ws-1', 'bd-1');

    expect(target).not.toBeNull();
    expect(target!.type).toBe('http-endpoint-set');
    if (target?.type !== 'http-endpoint-set') {
      throw new Error('expected http-endpoint-set target');
    }
    expect(target.endpoints).toHaveLength(1);
    if (target.endpoints[0].target.kind !== 'service-ref') {
      throw new Error('expected service-ref target');
    }
    expect(target.endpoints[0].target.ref).toBe('cf-api');
  });

  it('skips non-cloudflare.worker endpoints', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all
      .mockResolvedValueOnce([
        { id: 'ep-1', accountId: 'ws-1', name: 'api', protocol: 'http', targetServiceRef: 'ext-worker', timeoutMs: null, bundleDeploymentId: 'bd-1' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { name: 'ext-worker', cloudflareServiceRef: null, runtime: 'docker' },
      ]);
    mocks.getDb.mockReturnValue(drizzle);

    const service = new InfraService(makeEnv());
    const target = await service.buildRoutingTarget('ws-1', 'bd-1');
    expect(target).toBeNull();
  });
});

describe('InfraService.deleteByBundleDeployment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes endpoints, routes, and workers', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([{ id: 'ep-1' }, { id: 'ep-2' }]); // endpoints to delete
    mocks.getDb.mockReturnValue(drizzle);

    const service = new InfraService(makeEnv());
    await service.deleteByBundleDeployment('ws-1', 'bd-1');

    // routes for ep-1, routes for ep-2, endpoints, workers
    expect(drizzle.delete).toHaveBeenCalledTimes(4);
  });
});
