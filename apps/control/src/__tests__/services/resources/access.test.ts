import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getResourceById: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/services/resources/store', () => ({
  getResourceById: mocks.getResourceById,
}));

import { checkResourceAccess, canAccessResource } from '@/services/resources/access';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
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
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}

describe('checkResourceAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when user has direct access', async () => {
    const drizzle = createDrizzleMock();
    // First call: memberships
    drizzle._.all.mockResolvedValueOnce([]);
    // Second call: access check
    drizzle._.get.mockResolvedValueOnce({ permission: 'read' });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await checkResourceAccess({} as D1Database, 'res-1', 'user-1');
    expect(result).toBe(true);
  });

  it('returns false when no access found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    drizzle._.get.mockResolvedValueOnce(null);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await checkResourceAccess({} as D1Database, 'res-1', 'user-1');
    expect(result).toBe(false);
  });

  it('checks required permissions', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    drizzle._.get.mockResolvedValueOnce({ permission: 'read' });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await checkResourceAccess({} as D1Database, 'res-1', 'user-1', ['write']);
    expect(result).toBe(false);
  });

  it('passes when user has required permission', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    drizzle._.get.mockResolvedValueOnce({ permission: 'admin' });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await checkResourceAccess({} as D1Database, 'res-1', 'user-1', ['admin']);
    expect(result).toBe(true);
  });

  it('includes workspace memberships in access check', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([{ accountId: 'team-1' }]);
    drizzle._.get.mockResolvedValueOnce({ permission: 'write' });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await checkResourceAccess({} as D1Database, 'res-1', 'user-1', ['write']);
    expect(result).toBe(true);
  });
});

describe('canAccessResource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns canAccess: false when resource not found', async () => {
    mocks.getResourceById.mockResolvedValue(null);

    const result = await canAccessResource({} as D1Database, 'res-1', 'user-1');
    expect(result.canAccess).toBe(false);
    expect(result.isOwner).toBe(false);
  });

  it('returns isOwner: true for resource owner', async () => {
    mocks.getResourceById.mockResolvedValue({
      id: 'res-1',
      owner_id: 'user-1',
      type: 'd1',
      status: 'active',
    });

    const result = await canAccessResource({} as D1Database, 'res-1', 'user-1');
    expect(result.canAccess).toBe(true);
    expect(result.isOwner).toBe(true);
    expect(result.permission).toBe('admin');
  });

  it('checks access grants for non-owner', async () => {
    mocks.getResourceById.mockResolvedValue({
      id: 'res-1',
      owner_id: 'other-user',
      type: 'd1',
      status: 'active',
    });

    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]); // memberships
    drizzle._.get.mockResolvedValueOnce({ permission: 'write' }); // access
    mocks.getDb.mockReturnValue(drizzle);

    const result = await canAccessResource({} as D1Database, 'res-1', 'user-2');
    expect(result.canAccess).toBe(true);
    expect(result.isOwner).toBe(false);
    expect(result.permission).toBe('write');
  });

  it('checks required permissions for non-owner', async () => {
    mocks.getResourceById.mockResolvedValue({
      id: 'res-1',
      owner_id: 'other-user',
      type: 'd1',
      status: 'active',
    });

    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    drizzle._.get.mockResolvedValueOnce({ permission: 'read' });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await canAccessResource({} as D1Database, 'res-1', 'user-2', ['admin']);
    expect(result.canAccess).toBe(false);
    expect(result.isOwner).toBe(false);
    expect(result.permission).toBe('read');
  });

  it('returns canAccess: false when no access grants exist', async () => {
    mocks.getResourceById.mockResolvedValue({
      id: 'res-1',
      owner_id: 'other-user',
      type: 'd1',
      status: 'active',
    });

    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    drizzle._.get.mockResolvedValueOnce(null);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await canAccessResource({} as D1Database, 'res-1', 'user-2');
    expect(result.canAccess).toBe(false);
    expect(result.isOwner).toBe(false);
  });
});
