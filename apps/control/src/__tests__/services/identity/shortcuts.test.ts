import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';

import {
  generateShortcutId,
  isShortcutResourceType,
  ALLOWED_SHORTCUT_RESOURCE_TYPES,
} from '@/services/identity/shortcuts';

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('generateShortcutId', () => {
  it('produces a non-empty string', () => {
    const id = generateShortcutId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('produces unique values', () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateShortcutId()));
    expect(ids.size).toBe(50);
  });
});

describe('isShortcutResourceType', () => {
  it('returns true for all allowed types', () => {
    for (const type of ALLOWED_SHORTCUT_RESOURCE_TYPES) {
      expect(isShortcutResourceType(type)).toBe(true);
    }
  });

  it('returns false for unknown types', () => {
    expect(isShortcutResourceType('unknown')).toBe(false);
    expect(isShortcutResourceType('')).toBe(false);
    expect(isShortcutResourceType('Worker')).toBe(false);
  });
});

describe('ALLOWED_SHORTCUT_RESOURCE_TYPES', () => {
  it('contains service, resource, and link', () => {
    expect(ALLOWED_SHORTCUT_RESOURCE_TYPES).toEqual(['service', 'resource', 'link']);
  });
});

// ---------------------------------------------------------------------------
// DB-dependent tests with mocked Drizzle
// ---------------------------------------------------------------------------

function createMockDrizzleDb() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
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

const db = createMockDrizzleDb();

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, getDb: mocks.getDb };
});

import { listShortcuts, createShortcut, updateShortcut, deleteShortcut } from '@/services/identity/shortcuts';

describe('shortcuts service (Drizzle)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  describe('listShortcuts', () => {
    it('returns empty array when no shortcuts exist', async () => {
      db._.all.mockResolvedValueOnce([]); // shortcuts
      const result = await listShortcuts({} as D1Database, 'user-1', 'space-1');
      expect(result).toEqual([]);
    });

    it('maps rows to API format with service join data', async () => {
      db._.all
        .mockResolvedValueOnce([
          {
            id: 'sc-1',
            userAccountId: 'user-1',
            accountId: 'space-1',
            resourceType: 'worker',
            resourceId: 'w-1',
            name: 'My Worker',
            icon: null,
            position: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ])
        .mockResolvedValueOnce([
          { id: 'w-1', hostname: 'my-worker.example.com', status: 'running' },
        ]); // workers batch

      const result = await listShortcuts({} as D1Database, 'user-1', 'space-1');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'sc-1',
        user_id: 'user-1',
        space_id: 'space-1',
        resource_type: 'service',
        resource_id: 'w-1',
        name: 'My Worker',
        service_hostname: 'my-worker.example.com',
        service_status: 'running',
      });
    });
  });

  describe('createShortcut', () => {
    it('creates a shortcut and returns the API response', async () => {
      db._.get.mockResolvedValueOnce({
        id: 'sc-new',
        userAccountId: 'user-1',
        accountId: 'space-1',
        resourceType: 'service',
        resourceId: 'w-1',
        name: 'Created',
        icon: null,
        position: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });

      const result = await createShortcut({} as D1Database, 'user-1', 'space-1', {
        name: 'Created',
        resourceType: 'service',
        resourceId: 'w-1',
      });

      expect(result.name).toBe('Created');
      expect(result.resource_type).toBe('service');
    });

    it('throws for invalid resource type', async () => {
      await expect(
        createShortcut({} as D1Database, 'user-1', 'space-1', {
          name: 'Bad',
          resourceType: 'invalid' as never,
          resourceId: 'x',
        }),
      ).rejects.toThrow('Invalid shortcut resource type');
    });
  });

  describe('updateShortcut', () => {
    it('returns false when no updates are provided', async () => {
      const result = await updateShortcut({} as D1Database, 'user-1', 'space-1', 'sc-1', {});
      expect(result).toBe(false);
    });

    it('returns true when name is updated', async () => {
      const result = await updateShortcut({} as D1Database, 'user-1', 'space-1', 'sc-1', {
        name: 'New Name',
      });
      expect(result).toBe(true);
    });

    it('returns true when position is updated', async () => {
      const result = await updateShortcut({} as D1Database, 'user-1', 'space-1', 'sc-1', {
        position: 5,
      });
      expect(result).toBe(true);
    });
  });

  describe('deleteShortcut', () => {
    it('calls drizzle delete with the correct conditions', async () => {
      await deleteShortcut({} as D1Database, 'user-1', 'space-1', 'sc-1');
      expect(db.delete).toHaveBeenCalled();
    });
  });
});
