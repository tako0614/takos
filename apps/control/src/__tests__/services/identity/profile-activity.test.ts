import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

function createMockDrizzleDb() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
  };
  return {
    select: vi.fn(() => chain),
    _: { get: getMock, all: allMock, chain },
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

import { fetchProfileActivity } from '@/services/identity/profile-activity';

describe('fetchProfileActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns empty events when all queries return empty', async () => {
    // 4 concurrent queries: commits, releases, PRs, deployments
    db._.all
      .mockResolvedValueOnce([]) // commits
      .mockResolvedValueOnce([]) // releases
      .mockResolvedValueOnce([]) // PRs
      .mockResolvedValueOnce([]); // deployments

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    expect(result.events).toEqual([]);
    expect(result.has_more).toBe(false);
  });

  it('merges and sorts events by created_at descending', async () => {
    db._.all
      .mockResolvedValueOnce([
        {
          id: 'c1',
          sha: 'abc123',
          message: 'fix: bug\ndetails',
          commitDate: '2026-01-03T00:00:00.000Z',
          repoName: 'repo-1',
          accountId: 'acc-1',
          accountSlug: 'alice',
        },
      ])
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([]); // deployments

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    expect(result.events).toHaveLength(3);
    // Should be sorted descending by date
    expect(result.events[0]!.id).toBe('c1');   // Jan 3
    expect(result.events[1]!.id).toBe('pr1');  // Jan 2
    expect(result.events[2]!.id).toBe('r1');   // Jan 1
    expect(result.has_more).toBe(false);
  });

  it('correctly maps commit events (first line of message)', async () => {
    db._.all
      .mockResolvedValueOnce([
        {
          id: 'c1',
          sha: 'deadbeef',
          message: 'first line\nsecond line\nthird line',
          commitDate: '2026-01-01T00:00:00.000Z',
          repoName: 'my-repo',
          accountId: 'acc-1',
          accountSlug: 'alice',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    expect(result.events[0]).toMatchObject({
      type: 'commit',
      title: 'first line',
      data: { sha: 'deadbeef' },
      repo: { owner_username: 'alice', name: 'my-repo' },
    });
  });

  it('correctly maps release events', async () => {
    db._.all
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    expect(result.events[0]).toMatchObject({
      type: 'release',
      title: 'Released v2.0.0',
      data: { tag: 'v2.0.0', name: 'Major Release' },
    });
  });

  it('correctly maps pull request events', async () => {
    db._.all
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
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
      ])
      .mockResolvedValueOnce([]);

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    expect(result.events[0]).toMatchObject({
      type: 'pull_request',
      title: 'PR #99: My PR',
      data: { number: 99, status: 'open' },
    });
  });

  it('correctly maps deployment events', async () => {
    db._.all
      .mockResolvedValueOnce([])  // commits
      .mockResolvedValueOnce([])  // releases
      .mockResolvedValueOnce([])  // PRs
      .mockResolvedValueOnce([    // deployments
        {
          id: 'd1',
          status: 'success',
          version: '1.0.0',
          completedAt: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          serviceId: 'w1',
        },
      ])
      .mockResolvedValueOnce([    // listWorkerRouteRecordsByIds
        {
          id: 'w1',
          accountId: 'acc-1',
          workerType: 'standard',
          status: 'active',
          hostname: 'my-worker.example.com',
          routeRef: 'worker-route',
          slug: 'my-worker',
        },
      ]);

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    expect(result.events[0]).toMatchObject({
      type: 'deployment',
      title: 'Deployed my-worker.example.com',
      repo: null,
      data: {
        service_hostname: 'my-worker.example.com',
        status: 'success',
        version: '1.0.0',
      },
    });
  });

  it('sets has_more when events exceed limit', async () => {
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
      .mockResolvedValueOnce(commits)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 5,
      before: null,
    });

    expect(result.events).toHaveLength(5);
    expect(result.has_more).toBe(true);
  });

  it('uses account id as owner_username when slug is null', async () => {
    db._.all
      .mockResolvedValueOnce([
        {
          id: 'c1',
          sha: 'abc',
          message: 'Commit',
          commitDate: '2026-01-01T00:00:00.000Z',
          repoName: 'repo',
          accountId: 'acc-1',
          accountSlug: null,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await fetchProfileActivity({} as D1Database, {
      profileUserId: 'user-1',
      profileUserEmail: 'user@example.com',
      limit: 10,
      before: null,
    });

    expect(result.events[0]!.repo?.owner_username).toBe('acc-1');
  });
});
