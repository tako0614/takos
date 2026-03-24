import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  generateId: vi.fn().mockReturnValue('snap-id-1'),
  now: vi.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  computeSHA256: vi.fn().mockResolvedValue('sha256-hash'),
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

vi.mock('@/shared/utils/hash', () => ({
  computeSHA256: mocks.computeSHA256,
  verifyBundleHash: vi.fn(async () => true),
  constantTimeEqual: vi.fn((a: string, b: string) => a === b),
}));

import { SnapshotManager } from '@/services/sync/snapshot';
import type { Env } from '@/types';
import type { SnapshotTree } from '@/services/sync/types';
import { MockR2Bucket } from '../../../../test/integration/setup';

function createChainableMock(overrides: Record<string, unknown> = {}) {
  const c: Record<string, unknown> = {};
  c.from = vi.fn().mockReturnValue(c);
  c.where = vi.fn().mockReturnValue(c);
  c.orderBy = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockReturnValue(c);
  c.get = vi.fn().mockResolvedValue(null);
  c.all = vi.fn().mockResolvedValue([]);
  c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
  Object.assign(c, overrides);
  return c;
}

function createDrizzleMock() {
  return {
    select: vi.fn().mockImplementation(() => createChainableMock()),
    selectDistinct: vi.fn().mockImplementation(() => createChainableMock()),
    insert: vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.values = vi.fn().mockReturnValue(c);
      c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
      return c;
    }),
    update: vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.set = vi.fn().mockReturnValue(c);
      c.where = vi.fn().mockReturnValue(c);
      c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
      c.returning = vi.fn().mockReturnValue(c);
      c.get = vi.fn().mockResolvedValue(null);
      return c;
    }),
    delete: vi.fn().mockImplementation(() => {
      const c: Record<string, unknown> = {};
      c.where = vi.fn().mockReturnValue(c);
      c.run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
      return c;
    }),
  };
}

function makeMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as never,
    TENANT_SOURCE: new MockR2Bucket() as never,
    ...overrides,
  } as Env;
}

describe('SnapshotManager', () => {
  const spaceId = 'ws-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSnapshot', () => {
    it('stores compressed tree in R2, inserts snapshot row, and increases blob refcount', async () => {
      const drizzle = createDrizzleMock();
      mocks.getDb.mockReturnValue(drizzle);
      const env = makeMockEnv();

      const mgr = new SnapshotManager(env, spaceId);
      const tree: SnapshotTree = {
        'src/index.ts': { hash: 'abc123', mode: 0o644, type: 'file', size: 100 },
      };

      const snapshot = await mgr.createSnapshot(tree, ['parent-1'], 'test snapshot', 'user');

      expect(snapshot.id).toBe('snap-id-1');
      expect(snapshot.space_id).toBe(spaceId);
      expect(snapshot.parent_ids).toEqual(['parent-1']);
      expect(snapshot.status).toBe('pending');
      expect(snapshot.author).toBe('user');

      // Verify R2 put was called
      const stored = await (env.TENANT_SOURCE as unknown as MockR2Bucket).get(snapshot.tree_key);
      expect(stored).not.toBeNull();

      // Verify DB insert
      expect(drizzle.insert).toHaveBeenCalled();

      // Verify refcount increase (update for blob)
      expect(drizzle.update).toHaveBeenCalled();
    });

    it('throws when TENANT_SOURCE is not configured', async () => {
      const drizzle = createDrizzleMock();
      mocks.getDb.mockReturnValue(drizzle);
      const env = makeMockEnv({ TENANT_SOURCE: undefined } as never);

      const mgr = new SnapshotManager(env, spaceId);
      await expect(mgr.createSnapshot({}, [])).rejects.toThrow('Storage not configured');
    });

    it('does not call increaseBlobRefcount for empty tree', async () => {
      const drizzle = createDrizzleMock();
      mocks.getDb.mockReturnValue(drizzle);
      const env = makeMockEnv();

      const mgr = new SnapshotManager(env, spaceId);
      await mgr.createSnapshot({}, [], 'empty');

      // insert is called for the snapshot row only, update is not called (no blob refcount)
      expect(drizzle.insert).toHaveBeenCalledTimes(1);
      expect(drizzle.update).not.toHaveBeenCalled();
    });
  });

  describe('completeSnapshot', () => {
    it('updates snapshot status from pending to complete', async () => {
      const drizzle = createDrizzleMock();
      mocks.getDb.mockReturnValue(drizzle);
      const env = makeMockEnv();

      const mgr = new SnapshotManager(env, spaceId);
      await mgr.completeSnapshot('snap-1');

      expect(drizzle.update).toHaveBeenCalled();
    });
  });

  describe('getSnapshot', () => {
    it('returns null when snapshot not found', async () => {
      const drizzle = createDrizzleMock();
      mocks.getDb.mockReturnValue(drizzle);
      const env = makeMockEnv();

      const mgr = new SnapshotManager(env, spaceId);
      const result = await mgr.getSnapshot('nonexistent');
      expect(result).toBeNull();
    });

    it('returns parsed snapshot with parent_ids array', async () => {
      const row = {
        id: 'snap-1',
        accountId: spaceId,
        parentIds: '["parent-1","parent-2"]',
        treeKey: 'trees/ws-1/snap-1.json.gz',
        message: 'test',
        author: 'ai',
        status: 'complete',
        createdAt: '2025-01-01T00:00:00Z',
      };
      const selectChain = createChainableMock({ get: vi.fn().mockResolvedValue(row) });
      const drizzle = createDrizzleMock();
      drizzle.select = vi.fn().mockReturnValue(selectChain);
      mocks.getDb.mockReturnValue(drizzle);

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      const snapshot = await mgr.getSnapshot('snap-1');

      expect(snapshot).not.toBeNull();
      expect(snapshot!.id).toBe('snap-1');
      expect(snapshot!.parent_ids).toEqual(['parent-1', 'parent-2']);
      expect(snapshot!.status).toBe('complete');
    });

    it('handles null parentIds gracefully', async () => {
      const row = {
        id: 'snap-2',
        accountId: spaceId,
        parentIds: null,
        treeKey: 'trees/ws-1/snap-2.json',
        message: null,
        author: null,
        status: 'pending',
        createdAt: '2025-01-01T00:00:00Z',
      };
      const selectChain = createChainableMock({ get: vi.fn().mockResolvedValue(row) });
      const drizzle = createDrizzleMock();
      drizzle.select = vi.fn().mockReturnValue(selectChain);
      mocks.getDb.mockReturnValue(drizzle);

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      const snapshot = await mgr.getSnapshot('snap-2');

      expect(snapshot!.parent_ids).toEqual([]);
    });
  });

  describe('getTree', () => {
    it('throws when snapshot not found', async () => {
      const drizzle = createDrizzleMock();
      mocks.getDb.mockReturnValue(drizzle);
      const env = makeMockEnv();

      const mgr = new SnapshotManager(env, spaceId);
      await expect(mgr.getTree('nonexistent')).rejects.toThrow('Snapshot not found');
    });

    it('throws when TENANT_SOURCE is not configured', async () => {
      const row = {
        id: 'snap-1', accountId: spaceId, parentIds: '[]',
        treeKey: 'trees/ws-1/snap-1.json', message: null, author: null,
        status: 'complete', createdAt: '2025-01-01T00:00:00Z',
      };
      const selectChain = createChainableMock({ get: vi.fn().mockResolvedValue(row) });
      const drizzle = createDrizzleMock();
      drizzle.select = vi.fn().mockReturnValue(selectChain);
      mocks.getDb.mockReturnValue(drizzle);

      const env = makeMockEnv({ TENANT_SOURCE: undefined } as never);
      const mgr = new SnapshotManager(env, spaceId);
      await expect(mgr.getTree('snap-1')).rejects.toThrow('Storage not configured');
    });
  });

  describe('createTreeFromWorkspace', () => {
    it('builds a tree from file rows', async () => {
      const files = [
        { path: 'src/index.ts', sha256: 'abc', size: 100 },
        { path: 'README.md', sha256: 'def', size: 50 },
      ];
      const selectChain = createChainableMock({ all: vi.fn().mockResolvedValue(files) });
      const drizzle = createDrizzleMock();
      drizzle.select = vi.fn().mockReturnValue(selectChain);
      mocks.getDb.mockReturnValue(drizzle);

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      const tree = await mgr.createTreeFromWorkspace();

      expect(tree['src/index.ts']).toBeDefined();
      expect(tree['src/index.ts'].hash).toBe('abc');
      expect(tree['src/index.ts'].type).toBe('file');
      expect(tree['README.md'].size).toBe(50);
    });
  });

  describe('writeBlob', () => {
    it('writes blob to R2 and inserts DB row', async () => {
      const drizzle = createDrizzleMock();
      // head returns null (blob doesn't exist yet)
      const selectChain = createChainableMock({ get: vi.fn().mockResolvedValue(null) });
      drizzle.select = vi.fn().mockReturnValue(selectChain);
      mocks.getDb.mockReturnValue(drizzle);

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      const result = await mgr.writeBlob('hello world');

      expect(result.hash).toBe('sha256-hash');
      expect(result.size).toBeGreaterThan(0);
      expect(drizzle.insert).toHaveBeenCalled();
    });
  });

  describe('increaseBlobRefcount', () => {
    it('does nothing for empty hash array', async () => {
      const drizzle = createDrizzleMock();
      mocks.getDb.mockReturnValue(drizzle);

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      await mgr.increaseBlobRefcount([]);
      expect(drizzle.update).not.toHaveBeenCalled();
    });

    it('calls update for each hash', async () => {
      const drizzle = createDrizzleMock();
      mocks.getDb.mockReturnValue(drizzle);

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      await mgr.increaseBlobRefcount(['hash1', 'hash2']);
      expect(drizzle.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('decreaseBlobRefcount', () => {
    it('does nothing for empty hash array', async () => {
      const drizzle = createDrizzleMock();
      mocks.getDb.mockReturnValue(drizzle);

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      await mgr.decreaseBlobRefcount([]);
      expect(drizzle.update).not.toHaveBeenCalled();
    });
  });

  describe('cleanupPendingSnapshots', () => {
    it('returns 0 when no old pending snapshots exist', async () => {
      const selectChain = createChainableMock({ all: vi.fn().mockResolvedValue([]) });
      const drizzle = createDrizzleMock();
      drizzle.select = vi.fn().mockReturnValue(selectChain);
      mocks.getDb.mockReturnValue(drizzle);

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      const count = await mgr.cleanupPendingSnapshots();
      expect(count).toBe(0);
    });
  });

  describe('createBlobFetcher', () => {
    it('returns null when TENANT_SOURCE is not configured', async () => {
      const env = makeMockEnv({ TENANT_SOURCE: undefined } as never);
      const mgr = new SnapshotManager(env, spaceId);
      const fetcher = mgr.createBlobFetcher();
      const result = await fetcher('any-hash');
      expect(result).toBeNull();
    });

    it('returns null when blob is not found in R2', async () => {
      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      const fetcher = mgr.createBlobFetcher();
      const result = await fetcher('missing-hash');
      expect(result).toBeNull();
    });

    it('returns content when blob exists and hash matches', async () => {
      const tenant = new MockR2Bucket();
      await tenant.put(`blobs/${spaceId}/sha256-hash`, 'blob content');
      mocks.computeSHA256.mockResolvedValue('sha256-hash');

      const env = makeMockEnv({ TENANT_SOURCE: tenant } as never);
      const mgr = new SnapshotManager(env, spaceId);
      const fetcher = mgr.createBlobFetcher();
      const result = await fetcher('sha256-hash');
      expect(result).toBe('blob content');
    });

    it('returns null when hash does not match (integrity check)', async () => {
      const tenant = new MockR2Bucket();
      await tenant.put(`blobs/${spaceId}/claimed-hash`, 'blob content');
      mocks.computeSHA256.mockResolvedValue('different-hash');

      const env = makeMockEnv({ TENANT_SOURCE: tenant } as never);
      const mgr = new SnapshotManager(env, spaceId);
      const fetcher = mgr.createBlobFetcher();
      const result = await fetcher('claimed-hash');
      expect(result).toBeNull();
    });
  });
});
