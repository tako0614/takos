import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';

/**
 * Minimal mock for the Drizzle DB object returned by getDb().
 * Supports chained calls: select().from().where().get() and
 * insert().values().returning().get(), update().set().where().
 */
function createMockDrizzleDb() {
  const getMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    get: getMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    _: { get: getMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, getDb: mocks.getDb };
});

import { ensureUserSettings, getUserSettings, updateUserSettings } from '@/services/identity/user-settings';

describe('user-settings service (Drizzle)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('getUserSettings returns null when row is not found', async () => {
    db._.get.mockResolvedValueOnce(null);

    const result = await getUserSettings({} as D1Database, 'user-1');
    expect(result).toBeNull();
  });

  it('getUserSettings returns mapped settings when row exists', async () => {
    db._.get.mockResolvedValueOnce({
      accountId: 'user-1',
      setupCompleted: true,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    });

    const result = await getUserSettings({} as D1Database, 'user-1');
    expect(result).toEqual({
      userId: 'user-1',
      setupCompleted: true,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      aiModel: null,
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    });
  });

  it('ensureUserSettings creates row when not found', async () => {
    // First select returns null (row not found)
    db._.get.mockResolvedValueOnce(null);
    // Insert returns the new row
    db._.get.mockResolvedValueOnce({
      accountId: 'user-1',
      setupCompleted: false,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    });

    const result = await ensureUserSettings({} as D1Database, 'user-1');
    expect(result).toEqual({
      userId: 'user-1',
      setupCompleted: false,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      aiModel: null,
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    });
  });

  it('updateUserSettings updates and returns refreshed settings', async () => {
    // ensureUserSettings: select finds existing row
    db._.get.mockResolvedValueOnce({
      accountId: 'user-1',
      setupCompleted: false,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    });
    // getUserSettings: select returns updated row
    db._.get.mockResolvedValueOnce({
      accountId: 'user-1',
      setupCompleted: true,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    });

    const result = await updateUserSettings({} as D1Database, 'user-1', { setup_completed: true });
    expect(result).toEqual({
      userId: 'user-1',
      setupCompleted: true,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      aiModel: null,
      createdAt: '2026-02-13T00:00:00.000Z',
      updatedAt: '2026-02-13T00:00:00.000Z',
    });
  });
});
