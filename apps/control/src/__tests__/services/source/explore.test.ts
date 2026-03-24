import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

import {
  listExploreRepos,
  listTrendingRepos,
  listNewRepos,
  listRecentRepos,
} from '@/services/source/explore';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
  };
  return {
    select: vi.fn(() => chain),
    _: { get: getMock, all: allMock },
  };
}

const makeRepoRow = (id: string, stars: number = 5) => ({
  id,
  name: `repo-${id}`,
  description: 'A test repo',
  defaultBranch: 'main',
  stars,
  forks: 0,
  officialCategory: null,
  primaryLanguage: null,
  license: null,
  createdAt: '2026-03-20T00:00:00.000Z',
  updatedAt: '2026-03-20T00:00:00.000Z',
  accountId: 'owner-1',
  accountName: 'Owner',
  accountSlug: 'owner',
  accountPicture: null,
});

describe('listExploreRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty result when no repos', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all
      .mockResolvedValueOnce([]) // repos query
      .mockResolvedValueOnce([]); // stars
    drizzle._.get.mockResolvedValueOnce({ count: 0 }); // count
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listExploreRepos({} as any, {
      sort: 'stars',
      order: 'desc',
      limit: 10,
      offset: 0,
      searchQuery: '',
    });

    expect(result.repos).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.has_more).toBe(false);
  });

  it('maps repos with starred status', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all
      .mockResolvedValueOnce([makeRepoRow('r1', 10)]) // repos
      .mockResolvedValueOnce([{ repoId: 'r1' }]); // stars for user
    drizzle._.get.mockResolvedValueOnce({ count: 1 }); // total count
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listExploreRepos({} as any, {
      sort: 'stars',
      order: 'desc',
      limit: 10,
      offset: 0,
      searchQuery: '',
      userId: 'user-1',
    });

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].id).toBe('r1');
    expect(result.repos[0].is_starred).toBe(true);
    expect(result.repos[0].visibility).toBe('public');
  });

  it('computes has_more correctly', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([makeRepoRow('r1')]); // repos
    drizzle._.get.mockResolvedValueOnce({ count: 5 }); // total count
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listExploreRepos({} as any, {
      sort: 'stars',
      order: 'desc',
      limit: 1,
      offset: 0,
      searchQuery: '',
    });

    expect(result.has_more).toBe(true);
    expect(result.total).toBe(5);
  });
});

describe('listTrendingRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns trending repos ordered by stars', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([makeRepoRow('r1', 50), makeRepoRow('r2', 20)]);
    drizzle._.get.mockResolvedValueOnce({ count: 2 });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listTrendingRepos({} as any, {
      limit: 10,
      offset: 0,
    });

    expect(result.repos).toHaveLength(2);
    expect(result.total).toBe(2);
  });
});

describe('listNewRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns newly created repos', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([makeRepoRow('r1')]);
    drizzle._.get.mockResolvedValueOnce({ count: 1 });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listNewRepos({} as any, { limit: 10, offset: 0 });

    expect(result.repos).toHaveLength(1);
  });
});

describe('listRecentRepos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns recently updated repos', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([makeRepoRow('r1')]);
    drizzle._.get.mockResolvedValueOnce({ count: 1 });
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listRecentRepos({} as any, { limit: 10, offset: 0 });

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].owner.username).toBe('owner');
  });
});
