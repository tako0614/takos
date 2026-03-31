import { assertEquals } from 'jsr:@std/assert';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  listExploreRepos,
  listTrendingRepos,
  listNewRepos,
  listRecentRepos,
} from '@/services/source/explore';

function createDrizzleMock() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    innerJoin: (function(this: any) { return this; }),
    leftJoin: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    limit: (function(this: any) { return this; }),
    offset: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
  };
  return {
    select: () => chain,
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


  Deno.test('listExploreRepos - returns empty result when no repos', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all
       = (async () => []) as any // repos query
       = (async () => []) as any; // stars
    drizzle._.get = (async () => ({ count: 0 })) as any; // count
    mocks.getDb = (() => drizzle) as any;

    const result = await listExploreRepos({} as any, {
      sort: 'stars',
      order: 'desc',
      limit: 10,
      offset: 0,
      searchQuery: '',
    });

    assertEquals(result.repos.length, 0);
    assertEquals(result.total, 0);
    assertEquals(result.has_more, false);
})
  Deno.test('listExploreRepos - maps repos with starred status', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all
       = (async () => [makeRepoRow('r1', 10)]) as any // repos
       = (async () => [{ repoId: 'r1' }]) as any; // stars for user
    drizzle._.get = (async () => ({ count: 1 })) as any; // total count
    mocks.getDb = (() => drizzle) as any;

    const result = await listExploreRepos({} as any, {
      sort: 'stars',
      order: 'desc',
      limit: 10,
      offset: 0,
      searchQuery: '',
      userId: 'user-1',
    });

    assertEquals(result.repos.length, 1);
    assertEquals(result.repos[0].id, 'r1');
    assertEquals(result.repos[0].is_starred, true);
    assertEquals(result.repos[0].visibility, 'public');
})
  Deno.test('listExploreRepos - computes has_more correctly', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [makeRepoRow('r1')]) as any; // repos
    drizzle._.get = (async () => ({ count: 5 })) as any; // total count
    mocks.getDb = (() => drizzle) as any;

    const result = await listExploreRepos({} as any, {
      sort: 'stars',
      order: 'desc',
      limit: 1,
      offset: 0,
      searchQuery: '',
    });

    assertEquals(result.has_more, true);
    assertEquals(result.total, 5);
})

  Deno.test('listTrendingRepos - returns trending repos ordered by stars', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [makeRepoRow('r1', 50), makeRepoRow('r2', 20)]) as any;
    drizzle._.get = (async () => ({ count: 2 })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await listTrendingRepos({} as any, {
      limit: 10,
      offset: 0,
    });

    assertEquals(result.repos.length, 2);
    assertEquals(result.total, 2);
})

  Deno.test('listNewRepos - returns newly created repos', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [makeRepoRow('r1')]) as any;
    drizzle._.get = (async () => ({ count: 1 })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await listNewRepos({} as any, { limit: 10, offset: 0 });

    assertEquals(result.repos.length, 1);
})

  Deno.test('listRecentRepos - returns recently updated repos', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const drizzle = createDrizzleMock();
    drizzle._.all = (async () => [makeRepoRow('r1')]) as any;
    drizzle._.get = (async () => ({ count: 1 })) as any;
    mocks.getDb = (() => drizzle) as any;

    const result = await listRecentRepos({} as any, { limit: 10, offset: 0 });

    assertEquals(result.repos.length, 1);
    assertEquals(result.repos[0].owner.username, 'owner');
})