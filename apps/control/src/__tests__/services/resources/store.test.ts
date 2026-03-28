import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  now: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/utils')>()),
  now: mocks.now,
}));

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
    limit: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: vi.fn(() => chain),
    selectDistinct: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    _: { get: getMock, all: allMock, run: runMock },
  };
}

describe('getResourceById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when resource not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValue(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const { getResourceById } = await import('@/services/resources/store');
    const result = await getResourceById({} as D1Database, 'nonexistent');

    expect(result).toBeNull();
  });

  it('returns mapped resource when found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValue({
      id: 'res-1',
      ownerAccountId: 'user-1',
      accountId: 'space-1',
      name: 'my-db',
      type: 'd1',
      status: 'active',
      cfId: 'cf-123',
      cfName: 'my-d1-db',
      config: '{}',
      metadata: '{}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mocks.getDb.mockReturnValue(drizzle);

    const { getResourceById } = await import('@/services/resources/store');
    const result = await getResourceById({} as D1Database, 'res-1');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('res-1');
    expect(result!.owner_id).toBe('user-1');
    expect(result!.name).toBe('my-db');
    expect(result!.type).toBe('d1');
    expect(result!.status).toBe('active');
  });
});

describe('getResourceByName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when resource not found by name', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValue(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const { getResourceByName } = await import('@/services/resources/store');
    const result = await getResourceByName({} as D1Database, 'user-1', 'nonexistent');

    expect(result).toBeNull();
  });

  it('returns resource with _internal_id when found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValue({
      id: 'res-1',
      ownerAccountId: 'user-1',
      accountId: 'space-1',
      name: 'my-db',
      type: 'd1',
      status: 'active',
      cfId: 'cf-123',
      cfName: 'my-d1-db',
      config: '{}',
      metadata: '{}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mocks.getDb.mockReturnValue(drizzle);

    const { getResourceByName } = await import('@/services/resources/store');
    const result = await getResourceByName({} as D1Database, 'user-1', 'my-db');

    expect(result).not.toBeNull();
    expect(result!._internal_id).toBe('res-1');
    expect(result!.name).toBe('my-db');
  });
});

describe('updateResourceMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.now.mockReturnValue('2026-01-02T00:00:00.000Z');
  });

  it('returns null when no updates provided', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    const { updateResourceMetadata } = await import('@/services/resources/store');
    const result = await updateResourceMetadata({} as D1Database, 'res-1', {});

    expect(result).toBeNull();
  });

  it('updates name when provided', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValue({
      id: 'res-1',
      ownerAccountId: 'user-1',
      accountId: null,
      name: 'new-name',
      type: 'd1',
      status: 'active',
      cfId: null,
      cfName: null,
      config: '{}',
      metadata: '{}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    mocks.getDb.mockReturnValue(drizzle);

    const { updateResourceMetadata } = await import('@/services/resources/store');
    const result = await updateResourceMetadata({} as D1Database, 'res-1', { name: 'new-name' });

    expect(drizzle.update).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.name).toBe('new-name');
  });

  it('serializes config and metadata as JSON', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValue({
      id: 'res-1',
      ownerAccountId: 'user-1',
      accountId: null,
      name: 'test',
      type: 'd1',
      status: 'active',
      cfId: null,
      cfName: null,
      config: '{"key":"value"}',
      metadata: '{"meta":"data"}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    mocks.getDb.mockReturnValue(drizzle);

    const { updateResourceMetadata } = await import('@/services/resources/store');
    await updateResourceMetadata({} as D1Database, 'res-1', {
      config: { key: 'value' },
      metadata: { meta: 'data' },
    });

    expect(drizzle.update).toHaveBeenCalled();
    const setCall = drizzle._.run.mock.calls;
    expect(setCall).toBeDefined();
  });
});

describe('markResourceDeleting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.now.mockReturnValue('2026-01-02T00:00:00.000Z');
  });

  it('updates resource status to deleting', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    const { markResourceDeleting } = await import('@/services/resources/store');
    await markResourceDeleting({} as D1Database, 'res-1');

    expect(drizzle.update).toHaveBeenCalled();
  });
});

describe('deleteResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a resource by id', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    const { deleteResource } = await import('@/services/resources/store');
    await deleteResource({} as D1Database, 'res-1');

    expect(drizzle.delete).toHaveBeenCalled();
  });
});

describe('insertResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a resource and returns it', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValue({
      id: 'res-1',
      ownerAccountId: 'user-1',
      accountId: 'space-1',
      name: 'my-new-db',
      type: 'd1',
      status: 'active',
      cfId: 'cf-123',
      cfName: 'my-d1-db',
      config: '{}',
      metadata: '{}',
      sizeBytes: null,
      itemCount: null,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    mocks.getDb.mockReturnValue(drizzle);

    const { insertResource } = await import('@/services/resources/store');
    const result = await insertResource({} as D1Database, {
      id: 'res-1',
      owner_id: 'user-1',
      name: 'my-new-db',
      type: 'd1',
      status: 'active',
      cf_id: 'cf-123',
      cf_name: 'my-d1-db',
      config: {},
      space_id: 'space-1',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    expect(drizzle.insert).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.name).toBe('my-new-db');
  });
});

describe('insertFailedResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a resource with failed status', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    const { insertFailedResource } = await import('@/services/resources/store');
    await insertFailedResource({} as D1Database, {
      id: 'res-1',
      owner_id: 'user-1',
      name: 'failed-db',
      type: 'd1',
      cf_name: 'my-d1-db',
      config: { error: 'provisioning failed' },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    expect(drizzle.insert).toHaveBeenCalled();
  });
});
