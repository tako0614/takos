import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database, R2Bucket } from '@takos/cloudflare-compat';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  generateId: vi.fn().mockReturnValue('fork-id'),
  now: vi.fn().mockReturnValue('2026-03-24T00:00:00.000Z'),
  forkRepository: vi.fn(),
  checkSyncStatus: vi.fn(),
  getBranch: vi.fn(),
  updateBranch: vi.fn(),
  getDefaultBranch: vi.fn(),
  getCommitData: vi.fn(),
  listDirectory: vi.fn(),
  sanitizeRepoName: vi.fn((name: string) => name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')),
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

vi.mock('@/shared/utils/slug', () => ({
  sanitizeRepoName: mocks.sanitizeRepoName,
  slugifyName: vi.fn((name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'space'),
}));

vi.mock('@/services/git-smart', () => ({
  forkRepository: mocks.forkRepository,
  checkSyncStatus: mocks.checkSyncStatus,
  getBranch: mocks.getBranch,
  updateBranch: mocks.updateBranch,
  getDefaultBranch: mocks.getDefaultBranch,
  getCommitData: mocks.getCommitData,
  listDirectory: mocks.listDirectory,
}));

import { forkWithWorkflows, getSyncStatus, syncWithUpstream } from '@/services/source/fork';

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

const sourceRepo = {
  id: 'source-1',
  accountId: 'ws-source',
  name: 'original-repo',
  description: 'desc',
  visibility: 'public',
  defaultBranch: 'main',
  forkedFromId: null,
  stars: 10,
  forks: 3,
  gitEnabled: true,
  isOfficial: false,
  officialCategory: null,
  officialMaintainer: null,
  featured: false,
  installCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('forkWithWorkflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when source repo not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    await expect(
      forkWithWorkflows({} as D1Database, undefined, 'nonexistent', 'ws-target'),
    ).rejects.toThrow('Source repository not found');
  });

  it('throws when name already exists in target workspace', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get
      .mockResolvedValueOnce(sourceRepo) // source repo found
      .mockResolvedValueOnce({ id: 'existing' }); // name conflict
    mocks.getDb.mockReturnValue(drizzle);

    await expect(
      forkWithWorkflows({} as D1Database, undefined, 'source-1', 'ws-target'),
    ).rejects.toThrow('Repository with this name already exists');
  });

  it('forks repo successfully', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get
      .mockResolvedValueOnce(sourceRepo) // source repo
      .mockResolvedValueOnce(undefined) // no name conflict
      .mockResolvedValueOnce({ ...sourceRepo, id: 'fork-id', accountId: 'ws-target', forkedFromId: 'source-1' }); // forked repo
    mocks.getDb.mockReturnValue(drizzle);
    mocks.forkRepository.mockResolvedValue(undefined);

    const result = await forkWithWorkflows({} as D1Database, undefined, 'source-1', 'ws-target');

    expect(result.repository.id).toBe('fork-id');
    expect(result.forked_from.id).toBe('source-1');
    expect(mocks.forkRepository).toHaveBeenCalled();
    expect(drizzle.update).toHaveBeenCalled(); // forks counter
  });

  it('respects custom fork name', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get
      .mockResolvedValueOnce(sourceRepo)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...sourceRepo, id: 'fork-id', name: 'my-fork' });
    mocks.getDb.mockReturnValue(drizzle);
    mocks.forkRepository.mockResolvedValue(undefined);

    const result = await forkWithWorkflows({} as D1Database, undefined, 'source-1', 'ws-target', { name: 'My Fork' });

    expect(result.repository).toBeDefined();
    expect(mocks.sanitizeRepoName).toHaveBeenCalledWith('My Fork');
  });
});

describe('getSyncStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no-sync when repo not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    await expect(
      getSyncStatus({} as D1Database, undefined, 'repo-1'),
    ).rejects.toThrow('Repository not found');
  });

  it('returns no-sync when repo is not a fork', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({ ...sourceRepo, forkedFromId: null });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getSyncStatus({} as D1Database, undefined, 'repo-1');
    expect(result.can_sync).toBe(false);
    expect(result.upstream).toBeNull();
  });

  it('returns sync status for forked repo', async () => {
    const drizzle = createDrizzleMock();
    const fork = { ...sourceRepo, id: 'fork-1', forkedFromId: 'source-1' };
    drizzle._.get
      .mockResolvedValueOnce(fork) // fork repo
      .mockResolvedValueOnce(sourceRepo) // upstream repo
      .mockResolvedValueOnce({ createdAt: '2026-01-01T00:00:00.000Z' }); // fork created time
    drizzle._.all.mockResolvedValueOnce([]); // releases
    mocks.getDb.mockReturnValue(drizzle);
    mocks.checkSyncStatus.mockResolvedValue({
      can_sync: true,
      can_fast_forward: true,
      commits_behind: 3,
      commits_ahead: 0,
      has_conflict: false,
    });

    const result = await getSyncStatus({} as D1Database, {} as R2Bucket, 'fork-1');
    expect(result.can_sync).toBe(true);
    expect(result.commits_behind).toBe(3);
    expect(result.upstream).not.toBeNull();
    expect(result.upstream!.id).toBe('source-1');
  });
});

describe('syncWithUpstream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when repo is not a fork', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce({ ...sourceRepo, forkedFromId: null });
    mocks.getDb.mockReturnValue(drizzle);

    await expect(
      syncWithUpstream({} as D1Database, {} as R2Bucket, 'repo-1'),
    ).rejects.toThrow('Repository is not a fork');
  });

  it('throws when git storage not configured', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get
      .mockResolvedValueOnce({ ...sourceRepo, id: 'fork-1', forkedFromId: 'source-1' })
      .mockResolvedValueOnce(sourceRepo);
    mocks.getDb.mockReturnValue(drizzle);

    await expect(
      syncWithUpstream({} as D1Database, undefined, 'fork-1'),
    ).rejects.toThrow('Git storage not configured');
  });

  it('returns conflict status when diverged', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get
      .mockResolvedValueOnce({ ...sourceRepo, id: 'fork-1', forkedFromId: 'source-1' })
      .mockResolvedValueOnce(sourceRepo);
    mocks.getDb.mockReturnValue(drizzle);
    mocks.checkSyncStatus.mockResolvedValue({
      can_sync: true,
      can_fast_forward: false,
      commits_behind: 2,
      commits_ahead: 1,
      has_conflict: true,
    });

    const result = await syncWithUpstream({} as D1Database, {} as R2Bucket, 'fork-1');
    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
  });

  it('returns already up to date when nothing to sync', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get
      .mockResolvedValueOnce({ ...sourceRepo, id: 'fork-1', forkedFromId: 'source-1' })
      .mockResolvedValueOnce(sourceRepo);
    mocks.getDb.mockReturnValue(drizzle);
    mocks.checkSyncStatus.mockResolvedValue({
      can_sync: false,
      can_fast_forward: false,
      commits_behind: 0,
      commits_ahead: 0,
      has_conflict: false,
    });

    const result = await syncWithUpstream({} as D1Database, {} as R2Bucket, 'fork-1');
    expect(result.success).toBe(true);
    expect(result.commits_synced).toBe(0);
    expect(result.message).toBe('Already up to date');
  });
});
