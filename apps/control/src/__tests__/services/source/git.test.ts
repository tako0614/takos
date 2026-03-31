import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

import { assertEquals, assertNotEquals, assert, assertStringIncludes, assertObjectMatch } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  generateId: (() => 'commit-new'),
  now: (() => '2026-03-24T00:00:00.000Z'),
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils'
import { GitService } from '@/services/source/git';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const runMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    set: (function(this: any) { return this; }),
    values: (function(this: any) { return this; }),
    returning: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    limit: (function(this: any) { return this; }),
    offset: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}

function createBucketMock() {
  return {
    get: ((..._args: any[]) => undefined) as any,
    put: ((..._args: any[]) => undefined) as any,
    head: ((..._args: any[]) => undefined) as any,
    list: ((..._args: any[]) => undefined) as any,
    delete: ((..._args: any[]) => undefined) as any,
  } as unknown as R2Bucket;
}


  Deno.test('GitService construction - creates a GitService instance', () => {
  const service = new GitService({} as D1Database, {} as R2Bucket);
    assert(service instanceof GitService);
})

  Deno.test('GitService.log - returns empty array when no commits', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any;
    mocks.getDb = (() => drizzle) as any;

    const service = new GitService({} as D1Database, createBucketMock());
    const result = await service.log('ws-1');

    assertEquals(result, []);
})
  Deno.test('GitService.log - returns commits in mapped format', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [
      {
        id: 'c1',
        accountId: 'ws-1',
        message: 'init',
        authorAccountId: 'user-1',
        authorName: 'User',
        parentId: null,
        filesChanged: 1,
        insertions: 10,
        deletions: 0,
        treeHash: 'abc123',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const service = new GitService({} as D1Database, createBucketMock());
    const result = await service.log('ws-1');

    assertEquals(result.length, 1);
    assertObjectMatch(result[0], {
      id: 'c1',
      space_id: 'ws-1',
      message: 'init',
      author_id: 'user-1',
      parent_id: null,
      files_changed: 1,
    });
})
  Deno.test('GitService.log - filters by path when provided', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    // gitFileChanges query for path match
    drizzle._.all
       = (async () => [{ commitId: 'c1' }]) as any // matching changes
       = (async () => [
        {
          id: 'c1',
          accountId: 'ws-1',
          message: 'edit file',
          authorAccountId: 'user-1',
          authorName: 'User',
          parentId: null,
          filesChanged: 1,
          insertions: 1,
          deletions: 0,
          treeHash: 'abc',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const service = new GitService({} as D1Database, createBucketMock());
    const result = await service.log('ws-1', { path: 'src/main.ts' });

    assertEquals(result.length, 1);
    assertEquals(result[0].id, 'c1');
})
  Deno.test('GitService.log - returns empty when path filter has no matching commits', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any; // no matching changes
    mocks.getDb = (() => drizzle) as any;

    const service = new GitService({} as D1Database, createBucketMock());
    const result = await service.log('ws-1', { path: 'nonexistent.ts' });

    assertEquals(result, []);
})

  Deno.test('GitService.getCommit - returns null when commit not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const service = new GitService({} as D1Database, createBucketMock());
    const result = await service.getCommit('nonexistent');

    assertEquals(result, null);
})
  Deno.test('GitService.getCommit - returns commit when found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({
      id: 'c1',
      accountId: 'ws-1',
      message: 'init',
      authorAccountId: 'user-1',
      authorName: 'User',
      parentId: null,
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      treeHash: 'abc',
      createdAt: '2026-01-01T00:00:00.000Z',
    })) as any;
    mocks.getDb = (() => drizzle) as any;

    const service = new GitService({} as D1Database, createBucketMock());
    const result = await service.getCommit('c1');

    assertNotEquals(result, null);
    assertEquals(result!.id, 'c1');
})

  Deno.test('GitService.getCommitChanges - returns empty when no changes', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => []) as any;
    mocks.getDb = (() => drizzle) as any;

    const service = new GitService({} as D1Database, createBucketMock());
    const result = await service.getCommitChanges('c1');

    assertEquals(result, []);
})
  Deno.test('GitService.getCommitChanges - maps change rows correctly', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [
      {
        id: 'ch-1',
        commitId: 'c1',
        fileId: 'f1',
        path: 'src/main.ts',
        changeType: 'added',
        oldPath: null,
        oldHash: null,
        newHash: 'hash1',
        insertions: 10,
        deletions: 0,
      },
    ]) as any;
    mocks.getDb = (() => drizzle) as any;

    const service = new GitService({} as D1Database, createBucketMock());
    const result = await service.getCommitChanges('c1');

    assertEquals(result.length, 1);
    assertObjectMatch(result[0], {
      id: 'ch-1',
      commit_id: 'c1',
      path: 'src/main.ts',
      change_type: 'added',
    });
})

  Deno.test('GitService.restore - returns failure when change not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => undefined) as any;
    mocks.getDb = (() => drizzle) as any;

    const service = new GitService({} as D1Database, createBucketMock());
    const result = await service.restore('ws-1', 'c1', 'missing.ts');

    assertEquals(result.success, false);
    assertEquals(result.message, 'File not found in commit');
})
  Deno.test('GitService.restore - returns failure for deleted files', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({ changeType: 'deleted' })) as any;
    mocks.getDb = (() => drizzle) as any;

    const service = new GitService({} as D1Database, createBucketMock());
    const result = await service.restore('ws-1', 'c1', 'deleted.ts');

    assertEquals(result.success, false);
    assertStringIncludes(result.message, 'Cannot restore deleted file');
})
  Deno.test('GitService.restore - returns failure when snapshot not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.get = (async () => ({ changeType: 'modified', newHash: 'hash1' })) as any;
    mocks.getDb = (() => drizzle) as any;

    const bucket = createBucketMock();
    (bucket.get as ReturnType<typeof vi.fn>) = (async () => null) as any;

    const service = new GitService({} as D1Database, bucket);
    const result = await service.restore('ws-1', 'c1', 'src/main.ts');

    assertEquals(result.success, false);
    assertEquals(result.message, 'Snapshot not found');
})