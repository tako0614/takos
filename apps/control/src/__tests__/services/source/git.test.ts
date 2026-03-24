import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database, R2Bucket } from '@takos/cloudflare-compat';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  generateId: vi.fn().mockReturnValue('commit-new'),
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

import { GitService, createGitService } from '@/services/source/git';

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
    offset: vi.fn().mockReturnThis(),
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

function createBucketMock() {
  return {
    get: vi.fn(),
    put: vi.fn(),
    head: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
  } as unknown as R2Bucket;
}

describe('createGitService', () => {
  it('creates a GitService instance', () => {
    const service = createGitService({} as D1Database, {} as R2Bucket);
    expect(service).toBeInstanceOf(GitService);
  });
});

describe('GitService.log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no commits', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    mocks.getDb.mockReturnValue(drizzle);

    const service = createGitService({} as D1Database, createBucketMock());
    const result = await service.log('ws-1');

    expect(result).toEqual([]);
  });

  it('returns commits in mapped format', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([
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
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const service = createGitService({} as D1Database, createBucketMock());
    const result = await service.log('ws-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'c1',
      space_id: 'ws-1',
      message: 'init',
      author_id: 'user-1',
      parent_id: null,
      files_changed: 1,
    });
  });

  it('filters by path when provided', async () => {
    const drizzle = createDrizzleMock();
    // gitFileChanges query for path match
    drizzle._.all
      .mockResolvedValueOnce([{ commitId: 'c1' }]) // matching changes
      .mockResolvedValueOnce([
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
      ]);
    mocks.getDb.mockReturnValue(drizzle);

    const service = createGitService({} as D1Database, createBucketMock());
    const result = await service.log('ws-1', { path: 'src/main.ts' });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  it('returns empty when path filter has no matching commits', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]); // no matching changes
    mocks.getDb.mockReturnValue(drizzle);

    const service = createGitService({} as D1Database, createBucketMock());
    const result = await service.log('ws-1', { path: 'nonexistent.ts' });

    expect(result).toEqual([]);
  });
});

describe('GitService.getCommit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when commit not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const service = createGitService({} as D1Database, createBucketMock());
    const result = await service.getCommit('nonexistent');

    expect(result).toBeNull();
  });

  it('returns commit when found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({
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
    });
    mocks.getDb.mockReturnValue(drizzle);

    const service = createGitService({} as D1Database, createBucketMock());
    const result = await service.getCommit('c1');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('c1');
  });
});

describe('GitService.getCommitChanges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty when no changes', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    mocks.getDb.mockReturnValue(drizzle);

    const service = createGitService({} as D1Database, createBucketMock());
    const result = await service.getCommitChanges('c1');

    expect(result).toEqual([]);
  });

  it('maps change rows correctly', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([
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
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const service = createGitService({} as D1Database, createBucketMock());
    const result = await service.getCommitChanges('c1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'ch-1',
      commit_id: 'c1',
      path: 'src/main.ts',
      change_type: 'added',
    });
  });
});

describe('GitService.restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns failure when change not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const service = createGitService({} as D1Database, createBucketMock());
    const result = await service.restore('ws-1', 'c1', 'missing.ts');

    expect(result.success).toBe(false);
    expect(result.message).toBe('File not found in commit');
  });

  it('returns failure for deleted files', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({ changeType: 'deleted' });
    mocks.getDb.mockReturnValue(drizzle);

    const service = createGitService({} as D1Database, createBucketMock());
    const result = await service.restore('ws-1', 'c1', 'deleted.ts');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Cannot restore deleted file');
  });

  it('returns failure when snapshot not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({ changeType: 'modified', newHash: 'hash1' });
    mocks.getDb.mockReturnValue(drizzle);

    const bucket = createBucketMock();
    (bucket.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const service = createGitService({} as D1Database, bucket);
    const result = await service.restore('ws-1', 'c1', 'src/main.ts');

    expect(result.success).toBe(false);
    expect(result.message).toBe('Snapshot not found');
  });
});
