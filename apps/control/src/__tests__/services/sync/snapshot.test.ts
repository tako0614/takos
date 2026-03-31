import { assertEquals, assertNotEquals, assert, assertRejects } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: (() => 'snap-id-1'),
  now: (() => '2025-01-01T00:00:00.000Z'),
  computeSHA256: (async () => 'sha256-hash'),
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/hash'
import { SnapshotManager } from '@/services/sync/snapshot';
import type { Env } from '@/types';
import type { SnapshotTree } from '@/services/sync/types';
import { MockR2Bucket } from '../../../../test/integration/setup';

function createChainableMock(overrides: Record<string, unknown> = {}) {
  const c: Record<string, unknown> = {};
  c.from = (() => c);
  c.where = (() => c);
  c.orderBy = (() => c);
  c.limit = (() => c);
  c.get = (async () => null);
  c.all = (async () => []);
  c.run = (async () => ({ meta: { changes: 1 } }));
  Object.assign(c, overrides);
  return c;
}

function createDrizzleMock() {
  return {
    select: () => createChainableMock(),
    selectDistinct: () => createChainableMock(),
    insert: () => {
      const c: Record<string, unknown> = {};
      c.values = (() => c);
      c.run = (async () => ({ meta: { changes: 1 } }));
      return c;
    },
    update: () => {
      const c: Record<string, unknown> = {};
      c.set = (() => c);
      c.where = (() => c);
      c.run = (async () => ({ meta: { changes: 1 } }));
      c.returning = (() => c);
      c.get = (async () => null);
      return c;
    },
    delete: () => {
      const c: Record<string, unknown> = {};
      c.where = (() => c);
      c.run = (async () => ({ meta: { changes: 1 } }));
      return c;
    },
  };
}

function makeMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as never,
    TENANT_SOURCE: new MockR2Bucket() as never,
    ...overrides,
  } as Env;
}


  const spaceId = 'ws-1';
  
    Deno.test('SnapshotManager - createSnapshot - stores compressed tree in R2, inserts snapshot row, and increases blob refcount', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
      mocks.getDb = (() => drizzle) as any;
      const env = makeMockEnv();

      const mgr = new SnapshotManager(env, spaceId);
      const tree: SnapshotTree = {
        'src/index.ts': { hash: 'abc123', mode: 0o644, type: 'file', size: 100 },
      };

      const snapshot = await mgr.createSnapshot(tree, ['parent-1'], 'test snapshot', 'user');

      assertEquals(snapshot.id, 'snap-id-1');
      assertEquals(snapshot.space_id, spaceId);
      assertEquals(snapshot.parent_ids, ['parent-1']);
      assertEquals(snapshot.status, 'pending');
      assertEquals(snapshot.author, 'user');

      // Verify R2 put was called
      const stored = await (env.TENANT_SOURCE as unknown as MockR2Bucket).get(snapshot.tree_key);
      assertNotEquals(stored, null);

      // Verify DB insert
      assert(drizzle.insert.calls.length > 0);

      // Verify refcount increase (update for blob)
      assert(drizzle.update.calls.length > 0);
})
    Deno.test('SnapshotManager - createSnapshot - throws when TENANT_SOURCE is not configured', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
      mocks.getDb = (() => drizzle) as any;
      const env = makeMockEnv({ TENANT_SOURCE: undefined } as never);

      const mgr = new SnapshotManager(env, spaceId);
      await await assertRejects(async () => { await mgr.createSnapshot({}, []); }, 'Storage not configured');
})
    Deno.test('SnapshotManager - createSnapshot - does not call increaseBlobRefcount for empty tree', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
      mocks.getDb = (() => drizzle) as any;
      const env = makeMockEnv();

      const mgr = new SnapshotManager(env, spaceId);
      await mgr.createSnapshot({}, [], 'empty');

      // insert is called for the snapshot row only, update is not called (no blob refcount)
      assertSpyCalls(drizzle.insert, 1);
      assertSpyCalls(drizzle.update, 0);
})  
  
    Deno.test('SnapshotManager - completeSnapshot - updates snapshot status from pending to complete', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
      mocks.getDb = (() => drizzle) as any;
      const env = makeMockEnv();

      const mgr = new SnapshotManager(env, spaceId);
      await mgr.completeSnapshot('snap-1');

      assert(drizzle.update.calls.length > 0);
})  
  
    Deno.test('SnapshotManager - getSnapshot - returns null when snapshot not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
      mocks.getDb = (() => drizzle) as any;
      const env = makeMockEnv();

      const mgr = new SnapshotManager(env, spaceId);
      const result = await mgr.getSnapshot('nonexistent');
      assertEquals(result, null);
})
    Deno.test('SnapshotManager - getSnapshot - returns parsed snapshot with parent_ids array', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
      const selectChain = createChainableMock({ get: (async () => row) });
      const drizzle = createDrizzleMock();
      drizzle.select = (() => selectChain);
      mocks.getDb = (() => drizzle) as any;

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      const snapshot = await mgr.getSnapshot('snap-1');

      assertNotEquals(snapshot, null);
      assertEquals(snapshot!.id, 'snap-1');
      assertEquals(snapshot!.parent_ids, ['parent-1', 'parent-2']);
      assertEquals(snapshot!.status, 'complete');
})
    Deno.test('SnapshotManager - getSnapshot - handles null parentIds gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
      const selectChain = createChainableMock({ get: (async () => row) });
      const drizzle = createDrizzleMock();
      drizzle.select = (() => selectChain);
      mocks.getDb = (() => drizzle) as any;

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      const snapshot = await mgr.getSnapshot('snap-2');

      assertEquals(snapshot!.parent_ids, []);
})  
  
    Deno.test('SnapshotManager - getTree - throws when snapshot not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
      mocks.getDb = (() => drizzle) as any;
      const env = makeMockEnv();

      const mgr = new SnapshotManager(env, spaceId);
      await await assertRejects(async () => { await mgr.getTree('nonexistent'); }, 'Snapshot not found');
})
    Deno.test('SnapshotManager - getTree - throws when TENANT_SOURCE is not configured', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const row = {
        id: 'snap-1', accountId: spaceId, parentIds: '[]',
        treeKey: 'trees/ws-1/snap-1.json', message: null, author: null,
        status: 'complete', createdAt: '2025-01-01T00:00:00Z',
      };
      const selectChain = createChainableMock({ get: (async () => row) });
      const drizzle = createDrizzleMock();
      drizzle.select = (() => selectChain);
      mocks.getDb = (() => drizzle) as any;

      const env = makeMockEnv({ TENANT_SOURCE: undefined } as never);
      const mgr = new SnapshotManager(env, spaceId);
      await await assertRejects(async () => { await mgr.getTree('snap-1'); }, 'Storage not configured');
})  
  
    Deno.test('SnapshotManager - createTreeFromWorkspace - builds a tree from file rows', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const files = [
        { path: 'src/index.ts', sha256: 'abc', size: 100 },
        { path: 'README.md', sha256: 'def', size: 50 },
      ];
      const selectChain = createChainableMock({ all: (async () => files) });
      const drizzle = createDrizzleMock();
      drizzle.select = (() => selectChain);
      mocks.getDb = (() => drizzle) as any;

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      const tree = await mgr.createTreeFromWorkspace();

      assert(tree['src/index.ts'] !== undefined);
      assertEquals(tree['src/index.ts'].hash, 'abc');
      assertEquals(tree['src/index.ts'].type, 'file');
      assertEquals(tree['README.md'].size, 50);
})  
  
    Deno.test('SnapshotManager - writeBlob - writes blob to R2 and inserts DB row', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
      // head returns null (blob doesn't exist yet)
      const selectChain = createChainableMock({ get: (async () => null) });
      drizzle.select = (() => selectChain);
      mocks.getDb = (() => drizzle) as any;

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      const result = await mgr.writeBlob('hello world');

      assertEquals(result.hash, 'sha256-hash');
      assert(result.size > 0);
      assert(drizzle.insert.calls.length > 0);
})  
  
    Deno.test('SnapshotManager - increaseBlobRefcount - does nothing for empty hash array', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
      mocks.getDb = (() => drizzle) as any;

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      await mgr.increaseBlobRefcount([]);
      assertSpyCalls(drizzle.update, 0);
})
    Deno.test('SnapshotManager - increaseBlobRefcount - calls update for each hash', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
      mocks.getDb = (() => drizzle) as any;

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      await mgr.increaseBlobRefcount(['hash1', 'hash2']);
      assertSpyCalls(drizzle.update, 2);
})  
  
    Deno.test('SnapshotManager - decreaseBlobRefcount - does nothing for empty hash array', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
      mocks.getDb = (() => drizzle) as any;

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      await mgr.decreaseBlobRefcount([]);
      assertSpyCalls(drizzle.update, 0);
})  
  
    Deno.test('SnapshotManager - cleanupPendingSnapshots - returns 0 when no old pending snapshots exist', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const selectChain = createChainableMock({ all: (async () => []) });
      const drizzle = createDrizzleMock();
      drizzle.select = (() => selectChain);
      mocks.getDb = (() => drizzle) as any;

      const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      const count = await mgr.cleanupPendingSnapshots();
      assertEquals(count, 0);
})  
  
    Deno.test('SnapshotManager - createBlobFetcher - returns null when TENANT_SOURCE is not configured', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = makeMockEnv({ TENANT_SOURCE: undefined } as never);
      const mgr = new SnapshotManager(env, spaceId);
      const fetcher = mgr.createBlobFetcher();
      const result = await fetcher('any-hash');
      assertEquals(result, null);
})
    Deno.test('SnapshotManager - createBlobFetcher - returns null when blob is not found in R2', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const env = makeMockEnv();
      const mgr = new SnapshotManager(env, spaceId);
      const fetcher = mgr.createBlobFetcher();
      const result = await fetcher('missing-hash');
      assertEquals(result, null);
})
    Deno.test('SnapshotManager - createBlobFetcher - returns content when blob exists and hash matches', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const tenant = new MockR2Bucket();
      await tenant.put(`blobs/${spaceId}/sha256-hash`, 'blob content');
      mocks.computeSHA256 = (async () => 'sha256-hash') as any;

      const env = makeMockEnv({ TENANT_SOURCE: tenant } as never);
      const mgr = new SnapshotManager(env, spaceId);
      const fetcher = mgr.createBlobFetcher();
      const result = await fetcher('sha256-hash');
      assertEquals(result, 'blob content');
})
    Deno.test('SnapshotManager - createBlobFetcher - returns null when hash does not match (integrity check)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const tenant = new MockR2Bucket();
      await tenant.put(`blobs/${spaceId}/claimed-hash`, 'blob content');
      mocks.computeSHA256 = (async () => 'different-hash') as any;

      const env = makeMockEnv({ TENANT_SOURCE: tenant } as never);
      const mgr = new SnapshotManager(env, spaceId);
      const fetcher = mgr.createBlobFetcher();
      const result = await fetcher('claimed-hash');
      assertEquals(result, null);
})  