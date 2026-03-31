import { Hono } from 'hono';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/shared/helpers';
import { createMockEnv } from '../../../../test/integration/setup';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';

const mocks = ({
  checkRepoAccess: ((..._args: any[]) => undefined) as any,
  resolveReadableCommitFromRef: ((..._args: any[]) => undefined) as any,
  getCommit: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/source/repos'
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart'
import repoGit from '@/routes/repos/git';

interface CommitsPayload {
  ref: string;
  resolved_commit_sha: string;
  ref_commit_sha: string;
  commits: Array<{
    sha: string;
    message: string;
    author: { name: string; email: string };
    date: string;
    parents: string[];
  }>;
}

function createEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return createMockEnv(overrides) as unknown as Env;
}

function createApp() {
  const app = new Hono<AuthenticatedRouteEnv>();
  app.use('*', async (c, next) => {
    c.set('user', {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
    } as unknown as User);
    await next();
  });
  app.route('/', repoGit);
  return app;
}


  Deno.test('repos git commits - paginates via first-parent traversal and returns frontend-compatible DTO', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;

    mocks.checkRepoAccess = (async () => ({
      repo: {
        id: 'repo-1',
        name: 'repo',
        description: null,
        visibility: 'private',
        default_branch: 'main',
        forked_from_id: null,
        stars: 0,
        forks: 0,
        git_enabled: true,
        is_official: false,
        featured: false,
        install_count: 0,
        created_at: '2026-02-15T00:00:00Z',
        updated_at: '2026-02-15T00:00:00Z',
        space_id: 'ws-1',
      },
      spaceId: 'ws-1',
      role: 'owner',
    })) as any;
  const env = createEnv();
    const app = createApp();

    const commit1 = {
      type: 'commit',
      oid: 'c1',
      tree: 't1',
      parents: [],
      author: { name: 'A1', email: 'a1@example.com', timestamp: '2026-02-15T00:00:01Z' },
      committer: { name: 'C1', email: 'c1@example.com', timestamp: '2026-02-15T00:00:01Z' },
      message: 'm1',
    };
    const commit2 = {
      type: 'commit',
      oid: 'c2',
      tree: 't2',
      parents: ['c1'],
      author: { name: 'A2', email: 'a2@example.com', timestamp: '2026-02-15T00:00:02Z' },
      committer: { name: 'C2', email: 'c2@example.com', timestamp: '2026-02-15T00:00:02Z' },
      message: 'm2',
    };
    const commit3 = {
      type: 'commit',
      oid: 'c3',
      tree: 't3',
      parents: ['c2'],
      author: { name: 'A3', email: 'a3@example.com', timestamp: '2026-02-15T00:00:03Z' },
      committer: { name: 'C3', email: 'c3@example.com', timestamp: '2026-02-15T00:00:03Z' },
      message: 'm3',
    };

    mocks.resolveReadableCommitFromRef = (async () => ({
      ok: true,
      refCommitSha: 'c3',
      resolvedCommitSha: 'c3',
      degraded: false,
      commit: commit3,
    })) as any;

    mocks.getCommit = async (_db: unknown, _bucket: unknown, _repoId: string, sha: string) => {
      if (sha === 'c2') return commit2;
      if (sha === 'c1') return commit1;
      return null;
    } as any;

    const page1 = await app.fetch(
      new Request('http://localhost/repos/repo-1/commits?limit=2&page=1'),
      env,
      {} as ExecutionContext
    );
    assertEquals(page1.status, 200);
    const payload1 = await page1.json() as CommitsPayload;
    assertObjectMatch(payload1, {
      ref: 'main',
      resolved_commit_sha: 'c3',
      ref_commit_sha: 'c3',
      commits: [
        { sha: 'c3', message: 'm3', author: { name: 'A3', email: 'a3@example.com' }, date: '2026-02-15T00:00:03.000Z', parents: ['c2'] },
        { sha: 'c2', message: 'm2', author: { name: 'A2', email: 'a2@example.com' }, date: '2026-02-15T00:00:02.000Z', parents: ['c1'] },
      ],
    });

    const page2 = await app.fetch(
      new Request('http://localhost/repos/repo-1/commits?limit=2&page=2'),
      env,
      {} as ExecutionContext
    );
    assertEquals(page2.status, 200);
    const payload2 = await page2.json() as CommitsPayload;
    assertObjectMatch(payload2, {
      ref: 'main',
      resolved_commit_sha: 'c3',
      ref_commit_sha: 'c3',
      commits: [
        { sha: 'c1', message: 'm1', author: { name: 'A1', email: 'a1@example.com' }, date: '2026-02-15T00:00:01.000Z', parents: [] },
      ],
    });
})