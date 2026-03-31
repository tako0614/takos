import type { D1Database } from '@cloudflare/workers-types';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';

function createMockDrizzleDb() {
  const getMock = ((..._args: any[]) => undefined) as any;
  const allMock = ((..._args: any[]) => undefined) as any;
  const chain = {
    from: (function(this: any) { return this; }),
    where: (function(this: any) { return this; }),
    orderBy: (function(this: any) { return this; }),
    limit: (function(this: any) { return this; }),
    innerJoin: (function(this: any) { return this; }),
    get: getMock,
    all: allMock,
  };
  return {
    select: () => chain,
    _: { get: getMock, all: allMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
import { fetchProfileActivity } from '@/services/identity/profile-activity';


  Deno.test('fetchProfileActivity - returns empty events when all queries return empty', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  // 4 concurrent queries: commits, releases, PRs, deployments
    db._.all
       = (async () => []) as any // commits
       = (async () => []) as any // releases
       = (async () => []) as any // PRs
       = (async () => []) as any; // deployments

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    assertEquals(result.events, []);
    assertEquals(result.has_more, false);
})
  Deno.test('fetchProfileActivity - merges and sorts events by created_at descending', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.all
       = (async () => [
        {
          id: 'c1',
          sha: 'abc123',
          message: 'fix: bug\ndetails',
          commitDate: '2026-01-03T00:00:00.000Z',
          repoName: 'repo-1',
          accountId: 'acc-1',
          accountSlug: 'alice',
        },
      ]) as any
       = (async () => [
        {
          id: 'r1',
          tag: 'v1.0.0',
          name: 'First release',
          publishedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          repoName: 'repo-1',
          accountId: 'acc-1',
          accountSlug: 'alice',
        },
      ]) as any
       = (async () => [
        {
          id: 'pr1',
          number: 42,
          title: 'Add feature',
          status: 'merged',
          createdAt: '2026-01-02T00:00:00.000Z',
          repoName: 'repo-1',
          accountId: 'acc-1',
          accountSlug: 'alice',
        },
      ]) as any
       = (async () => []) as any; // deployments

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    assertEquals(result.events.length, 3);
    // Should be sorted descending by date
    assertEquals(result.events[0]!.id, 'c1');   // Jan 3
    assertEquals(result.events[1]!.id, 'pr1');  // Jan 2
    assertEquals(result.events[2]!.id, 'r1');   // Jan 1
    assertEquals(result.has_more, false);
})
  Deno.test('fetchProfileActivity - correctly maps commit events (first line of message)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.all
       = (async () => [
        {
          id: 'c1',
          sha: 'deadbeef',
          message: 'first line\nsecond line\nthird line',
          commitDate: '2026-01-01T00:00:00.000Z',
          repoName: 'my-repo',
          accountId: 'acc-1',
          accountSlug: 'alice',
        },
      ]) as any
       = (async () => []) as any
       = (async () => []) as any
       = (async () => []) as any;

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    assertObjectMatch(result.events[0], {
      type: 'commit',
      title: 'first line',
      data: { sha: 'deadbeef' },
      repo: { owner_username: 'alice', name: 'my-repo' },
    });
})
  Deno.test('fetchProfileActivity - correctly maps release events', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.all
       = (async () => []) as any
       = (async () => [
        {
          id: 'r1',
          tag: 'v2.0.0',
          name: 'Major Release',
          publishedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          repoName: 'my-repo',
          accountId: 'acc-1',
          accountSlug: 'alice',
        },
      ]) as any
       = (async () => []) as any
       = (async () => []) as any;

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    assertObjectMatch(result.events[0], {
      type: 'release',
      title: 'Released v2.0.0',
      data: { tag: 'v2.0.0', name: 'Major Release' },
    });
})
  Deno.test('fetchProfileActivity - correctly maps pull request events', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.all
       = (async () => []) as any
       = (async () => []) as any
       = (async () => [
        {
          id: 'pr1',
          number: 99,
          title: 'My PR',
          status: 'open',
          createdAt: '2026-01-01T00:00:00.000Z',
          repoName: 'repo',
          accountId: 'acc-1',
          accountSlug: 'bob',
        },
      ]) as any
       = (async () => []) as any;

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    assertObjectMatch(result.events[0], {
      type: 'pull_request',
      title: 'PR #99: My PR',
      data: { number: 99, status: 'open' },
    });
})
  Deno.test('fetchProfileActivity - correctly maps deployment events', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.all
       = (async () => []) as any  // commits
       = (async () => []) as any  // releases
       = (async () => []) as any  // PRs
       = (async () => [    // deployments
        {
          id: 'd1',
          status: 'success',
          version: '1.0.0',
          completedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          serviceId: 'w1',
        },
      ]) as any
       = (async () => [    // listWorkerRouteRecordsByIds
        {
          id: 'w1',
          accountId: 'acc-1',
          workerType: 'standard',
          status: 'active',
          hostname: 'my-worker.example.com',
          routeRef: 'worker-route',
          slug: 'my-worker',
        },
      ]) as any;

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    assertObjectMatch(result.events[0], {
      type: 'deployment',
      title: 'Deployed my-worker.example.com',
      repo: null,
      data: {
        service_hostname: 'my-worker.example.com',
        status: 'success',
        version: '1.0.0',
      },
    });
})
  Deno.test('fetchProfileActivity - sets has_more when events exceed limit', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  const commits = Array.from({ length: 6 }, (_, i) => ({
      id: `c${i}`,
      sha: `sha${i}`,
      message: `Commit ${i}`,
      commitDate: `2026-01-0${i + 1}T00:00:00.000Z`,
      repoName: 'repo',
      accountId: 'acc-1',
      accountSlug: 'alice',
    }));

    db._.all
       = (async () => commits) as any
       = (async () => []) as any
       = (async () => []) as any
       = (async () => []) as any;

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 5,
      before: null,
    });

    assertEquals(result.events.length, 5);
    assertEquals(result.has_more, true);
})
  Deno.test('fetchProfileActivity - uses account id as owner_username when slug is null', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.getDb = (() => db) as any;
  db._.all
       = (async () => [
        {
          id: 'c1',
          sha: 'abc',
          message: 'Commit',
          commitDate: '2026-01-01T00:00:00.000Z',
          repoName: 'repo',
          accountId: 'acc-1',
          accountSlug: null,
        },
      ]) as any
       = (async () => []) as any
       = (async () => []) as any
       = (async () => []) as any;

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    assertEquals(result.events[0]!.repo?.owner_username, 'acc-1');
})