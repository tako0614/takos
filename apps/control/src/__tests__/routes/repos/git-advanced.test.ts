import { Hono } from 'hono';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/shared/helpers';
import { createMockEnv } from '../../../../test/integration/setup.ts';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  checkRepoAccess: ((..._args: any[]) => undefined) as any,
  resolveReadableCommitFromRef: ((..._args: any[]) => undefined) as any,
  getCommit: ((..._args: any[]) => undefined) as any,
  flattenTree: ((..._args: any[]) => undefined) as any,
  getBlobWithMeta: ((..._args: any[]) => undefined) as any,
  getEntryAtPath: ((..._args: any[]) => undefined) as any,
  getBlob: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/source/repos'
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart'
import repoGitAdvanced from '@/routes/repos/git-advanced';

interface SearchPayload {
  query: string;
  ref: string;
  resolved_commit_sha: string;
  ref_commit_sha: string;
  matches: Array<{ path: string; line_number: number; column: number }>;
  truncated: boolean;
}

interface LogPayload {
  path: string;
  ref: string;
  resolved_commit_sha: string;
  ref_commit_sha: string;
  commits: Array<{ sha: string; status: string }>;
}

interface BlameLine {
  content: string;
  commit_sha: string;
}

interface BlamePayload {
  lines: BlameLine[];
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
  app.route('/', repoGitAdvanced);
  return app;
}


  Deno.test('repos git advanced - search finds lexical matches (case-insensitive by default)', async () => {
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

    const headCommit = {
      sha: 'c1',
      tree: 't1',
      parents: [],
      author: { name: 'A1', email: 'a1@example.com', timestamp: 1000001, tzOffset: '+0000' },
      committer: { name: 'C1', email: 'c1@example.com', timestamp: 1000001, tzOffset: '+0000' },
      message: 'm1',
    };

    mocks.resolveReadableCommitFromRef = (async () => ({
      ok: true,
      refCommitSha: 'c1',
      resolvedCommitSha: 'c1',
      degraded: false,
      commit: headCommit,
    })) as any;

    mocks.flattenTree = (async () => [
      { path: 'src/a.ts', sha: 'blob-1', mode: '100644' },
    ]) as any;

    mocks.getBlob = (async () => new TextEncoder().encode('hello\nWorld\n'),) as any;

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/search?q=world&ref=main&limit=10'),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    const payload = await response.json() as SearchPayload;
    assertObjectMatch(payload, {
      query: 'world',
      ref: 'main',
      resolved_commit_sha: 'c1',
      ref_commit_sha: 'c1',
      matches: [
        { path: 'src/a.ts', line_number: 2, column: 1 },
      ],
      truncated: false,
    });
})
  Deno.test('repos git advanced - search skips symlink entries by requesting flattenTree with skipSymlinks', async () => {
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

    const headCommit = {
      sha: 'c1',
      tree: 't1',
      parents: [],
      author: { name: 'A1', email: 'a1@example.com', timestamp: 1000001, tzOffset: '+0000' },
      committer: { name: 'C1', email: 'c1@example.com', timestamp: 1000001, tzOffset: '+0000' },
      message: 'm1',
    };

    mocks.resolveReadableCommitFromRef = (async () => ({
      ok: true,
      refCommitSha: 'c1',
      resolvedCommitSha: 'c1',
      degraded: false,
      commit: headCommit,
    })) as any;

    mocks.flattenTree = async (_bucket: unknown, _treeOid: string, _basePath = '', options?: { skipSymlinks?: boolean }) => {
      if (!options?.skipSymlinks) {
        throw new Error('Symlink blob entries are not supported: link');
      }
      return [{ path: 'src/a.ts', sha: 'blob-1', mode: '100644' }];
    } as any;

    mocks.getBlob = (async () => new TextEncoder().encode('hello symlink world\n'),) as any;

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/search?q=symlink&ref=main&limit=10'),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    const payload = await response.json() as SearchPayload;
    assertObjectMatch(payload.matches, [
      { path: 'src/a.ts', line_number: 1, column: 7 },
    ]);
    assertSpyCallArgs(mocks.flattenTree, 0, [expect.anything(), 't1', '', { skipSymlinks: true }]);
})
  Deno.test('repos git advanced - log returns first-parent file history where blob oid changes', async () => {
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
      sha: 'c1',
      tree: 't1',
      parents: [],
      author: { name: 'A1', email: 'a1@example.com', timestamp: 1000001, tzOffset: '+0000' },
      committer: { name: 'C1', email: 'c1@example.com', timestamp: 1000001, tzOffset: '+0000' },
      message: 'm1',
    };
    const commit2 = {
      sha: 'c2',
      tree: 't2',
      parents: ['c1'],
      author: { name: 'A2', email: 'a2@example.com', timestamp: 1000002, tzOffset: '+0000' },
      committer: { name: 'C2', email: 'c2@example.com', timestamp: 1000002, tzOffset: '+0000' },
      message: 'm2',
    };
    const commit3 = {
      sha: 'c3',
      tree: 't3',
      parents: ['c2'],
      author: { name: 'A3', email: 'a3@example.com', timestamp: 1000003, tzOffset: '+0000' },
      committer: { name: 'C3', email: 'c3@example.com', timestamp: 1000003, tzOffset: '+0000' },
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

    const oidByTree = new Map([
      ['t3', 'b3'],
      ['t2', 'b2'],
      ['t1', 'b1'],
    ]);

    mocks.getEntryAtPath = async (_bucket: unknown, treeOid: string, path: string) => {
      if (path !== 'src/file.txt') return null;
      const sha = oidByTree.get(treeOid);
      if (!sha) return null;
      return { mode: '100644', name: 'file.txt', sha, type: 'blob' };
    } as any;

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/log/main/src/file.txt?limit=10'),
      env,
      {} as ExecutionContext
    );

    const body = await response.text();
    if (response.status !== 200) {
      throw new Error(`unexpected status=${response.status} body=${body}`);
    }
    const payload = JSON.parse(body) as LogPayload;
    assertObjectMatch(payload, {
      path: 'src/file.txt',
      ref: 'main',
      resolved_commit_sha: 'c3',
      ref_commit_sha: 'c3',
      commits: [
        { sha: 'c3', status: 'modified' },
        { sha: 'c2', status: 'modified' },
        { sha: 'c1', status: 'added' },
      ],
    });
})
  Deno.test('repos git advanced - blame attributes inserted lines to the commit that introduced them', async () => {
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
      sha: 'c1',
      tree: 't1',
      parents: [],
      author: { name: 'A1', email: 'a1@example.com', timestamp: 1000001, tzOffset: '+0000' },
      committer: { name: 'C1', email: 'c1@example.com', timestamp: 1000001, tzOffset: '+0000' },
      message: 'm1',
    };
    const commit2 = {
      sha: 'c2',
      tree: 't2',
      parents: ['c1'],
      author: { name: 'A2', email: 'a2@example.com', timestamp: 1000002, tzOffset: '+0000' },
      committer: { name: 'C2', email: 'c2@example.com', timestamp: 1000002, tzOffset: '+0000' },
      message: 'm2',
    };
    const commit3 = {
      sha: 'c3',
      tree: 't3',
      parents: ['c2'],
      author: { name: 'A3', email: 'a3@example.com', timestamp: 1000003, tzOffset: '+0000' },
      committer: { name: 'C3', email: 'c3@example.com', timestamp: 1000003, tzOffset: '+0000' },
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

    const oidByTree = new Map([
      ['t3', 'b3'],
      ['t2', 'b2'],
      ['t1', 'b1'],
    ]);

    mocks.getEntryAtPath = async (_bucket: unknown, treeOid: string, path: string) => {
      if (path !== 'src/file.txt') return null;
      const sha = oidByTree.get(treeOid);
      if (!sha) return null;
      return { mode: '100644', name: 'file.txt', sha, type: 'blob' };
    } as any;

    const blobByOid = new Map([
      ['b1', new TextEncoder().encode('a\nb')],
      ['b2', new TextEncoder().encode('a\nc\nb')],
      ['b3', new TextEncoder().encode('a\nc\nd')],
    ]);

    mocks.getBlob = async (_bucket: unknown, oid: string) => blobByOid.get(oid) || null as any;

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/blame/main/src/file.txt'),
      env,
      {} as ExecutionContext
    );

    const body = await response.text();
    if (response.status !== 200) {
      throw new Error(`unexpected status=${response.status} body=${body}`);
    }
    const payload = JSON.parse(body) as BlamePayload;

    assertEquals(payload.lines.length, 3);
    assertEquals(payload.lines.map((l: BlameLine) => ({ content: l.content, commit_sha: l.commit_sha })), [
      { content: 'a', commit_sha: 'c1' },
      { content: 'c', commit_sha: 'c2' },
      { content: 'd', commit_sha: 'c3' },
    ]);
})