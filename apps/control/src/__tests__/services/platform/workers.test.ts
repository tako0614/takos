import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  generateId: vi.fn().mockReturnValue('worker-new'),
  now: vi.fn().mockReturnValue('2026-03-24T00:00:00.000Z'),
  resolveActorPrincipalId: vi.fn(),
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

vi.mock('@/services/identity/principals', () => ({
  resolveActorPrincipalId: mocks.resolveActorPrincipalId,
}));

import {
  slugifyWorkerName,
  countServicesInSpace,
  listServicesForSpace,
  getServiceById,
  createService,
  deleteService,
  listServicesForUser,
  getServiceForUser,
  resolveServiceReferenceRecord,
  WORKSPACE_WORKER_LIMITS,
} from '@/services/platform/workers';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
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

const makeServiceRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'w1',
  accountId: 'ws-1',
  workerType: 'app',
  status: 'deployed',
  config: null,
  hostname: 'my-app.takos.dev',
  routeRef: 'worker-w1',
  slug: 'my-app',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('slugifyWorkerName', () => {
  it('lowercases and replaces invalid chars', () => {
    expect(slugifyWorkerName('My App Name!')).toBe('my-app-name');
  });

  it('removes leading/trailing hyphens', () => {
    expect(slugifyWorkerName('-test-')).toBe('test');
  });

  it('truncates to 32 characters', () => {
    const long = 'a'.repeat(50);
    expect(slugifyWorkerName(long).length).toBeLessThanOrEqual(32);
  });

  it('handles empty string', () => {
    expect(slugifyWorkerName('')).toBe('');
  });
});

describe('WORKSPACE_WORKER_LIMITS', () => {
  it('has a maxWorkers limit', () => {
    expect(WORKSPACE_WORKER_LIMITS.maxWorkers).toBe(100);
  });
});

describe('countServicesInSpace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns count from DB', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({ count: 5 });
    mocks.getDb.mockReturnValue(drizzle);

    const count = await countServicesInSpace({} as D1Database, 'ws-1');
    expect(count).toBe(5);
  });

  it('returns 0 when no workers', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const count = await countServicesInSpace({} as D1Database, 'ws-1');
    expect(count).toBe(0);
  });
});

describe('listServicesForSpace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no workers', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    mocks.getDb.mockReturnValue(drizzle);

    const workers = await listServicesForSpace({} as D1Database, 'ws-1');
    expect(workers).toEqual([]);
  });

  it('returns mapped workers', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([makeServiceRow()]);
    mocks.getDb.mockReturnValue(drizzle);

    const workers = await listServicesForSpace({} as D1Database, 'ws-1');
    expect(workers).toHaveLength(1);
    expect(workers[0].id).toBe('w1');
    expect(workers[0].space_id).toBe('ws-1');
    expect(workers[0].service_type).toBe('app');
    expect(workers[0].status).toBe('deployed');
    expect(workers[0].slug).toBe('my-app');
  });
});

describe('getServiceById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const worker = await getServiceById({} as D1Database, 'nonexistent');
    expect(worker).toBeNull();
  });

  it('returns mapped worker when found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(makeServiceRow());
    mocks.getDb.mockReturnValue(drizzle);

    const worker = await getServiceById({} as D1Database, 'w1');
    expect(worker).not.toBeNull();
    expect(worker!.id).toBe('w1');
    expect(worker!.hostname).toBe('my-app.takos.dev');
    expect(worker!.service_name).toBe('worker-w1');
  });
});

describe('createService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates worker with generated id and hostname', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(makeServiceRow({ id: 'worker-new' }));
    mocks.getDb.mockReturnValue(drizzle);

    const result = await createService({} as D1Database, {
      spaceId: 'ws-1',
      workerType: 'app',
      slug: 'my-app',
      platformDomain: 'takos.dev',
    });

    expect(result.id).toBe('worker-new');
    expect(result.slug).toBe('my-app');
    expect(result.hostname).toBe('my-app.takos.dev');
    expect(drizzle.insert).toHaveBeenCalled();
  });

  it('generates slug from id when not provided', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(makeServiceRow({ id: 'worker-new' }));
    mocks.getDb.mockReturnValue(drizzle);

    const result = await createService({} as D1Database, {
      spaceId: 'ws-1',
      workerType: 'service',
      platformDomain: 'takos.dev',
    });

    expect(result.slug).toBe('worker-new');
  });
});

describe('deleteService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes worker by id', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    await deleteService({} as D1Database, 'w1');
    expect(drizzle.delete).toHaveBeenCalled();
  });
});

describe('listServicesForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when principal not found', async () => {
    mocks.resolveActorPrincipalId.mockResolvedValueOnce(null);

    const result = await listServicesForUser({} as D1Database, 'user-1');
    expect(result).toEqual([]);
  });

  it('returns empty when no memberships', async () => {
    mocks.resolveActorPrincipalId.mockResolvedValueOnce('principal-1');
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]); // memberships
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listServicesForUser({} as D1Database, 'user-1');
    expect(result).toEqual([]);
  });
});

describe('resolveServiceReferenceRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for empty reference', async () => {
    const result = await resolveServiceReferenceRecord({} as D1Database, 'ws-1', '');
    expect(result).toBeNull();
  });

  it('returns null for whitespace-only reference', async () => {
    const result = await resolveServiceReferenceRecord({} as D1Database, 'ws-1', '   ');
    expect(result).toBeNull();
  });

  it('returns worker when found by id/name/slug', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({
      id: 'w1',
      accountId: 'ws-1',
      workerType: 'app',
      status: 'deployed',
      hostname: 'my-app.takos.dev',
      routeRef: 'worker-w1',
      slug: 'my-app',
    });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await resolveServiceReferenceRecord({} as D1Database, 'ws-1', 'my-app');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('w1');
  });
});
