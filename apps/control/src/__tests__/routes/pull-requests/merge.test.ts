import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/helpers';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  checkRepoAccess: vi.fn(),
  getDb: vi.fn(),
  // Git store
  getBranch: vi.fn(),
  isAncestor: vi.fn(),
  findMergeBase: vi.fn(),
  getCommit: vi.fn(),
  mergeTrees3Way: vi.fn(),
  createCommit: vi.fn(),
  // Actions
  scheduleActionsAutoTrigger: vi.fn(),
  triggerPushWorkflows: vi.fn(),
  triggerPullRequestWorkflows: vi.fn(),
}));

vi.mock('@/services/source/repos', () => ({
  checkRepoAccess: mocks.checkRepoAccess,
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, getDb: mocks.getDb };
});

vi.mock('@/services/git-smart', () => ({
  getBranch: mocks.getBranch,
  isAncestor: mocks.isAncestor,
  findMergeBase: mocks.findMergeBase,
  getCommit: mocks.getCommit,
  getCommitData: mocks.getCommit,
  mergeTrees3Way: mocks.mergeTrees3Way,
  createCommit: mocks.createCommit,
  isValidGitPath: () => true,
}));

vi.mock('@/services/actions', () => ({
  scheduleActionsAutoTrigger: mocks.scheduleActionsAutoTrigger,
  triggerPushWorkflows: mocks.triggerPushWorkflows,
  triggerPullRequestWorkflows: mocks.triggerPullRequestWorkflows,
}));

import pullRequestsBase from '@/routes/pull-requests/base';

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
  app.route('/', pullRequestsBase);
  return app;
}

// Helper to build a drizzle-compatible mock DB that supports fluent chains:
// db.select().from(table).where(cond).get()
// db.update(table).set(data).where(cond).returning()  (returns array)
// db.update(table).set(data).where(cond).returning().get()  (returns single)
function createDrizzleMockDb(handlers: {
  selectGet?: (...args: unknown[]) => unknown;
  updateReturning?: (...args: unknown[]) => unknown[];
}) {
  const db = {
    select: vi.fn((...selectArgs: unknown[]) => {
      const chain = {
        from: vi.fn((..._fromArgs: unknown[]) => ({
          where: vi.fn((..._whereArgs: unknown[]) => ({
            get: vi.fn(async () => handlers.selectGet?.(...selectArgs)),
            all: vi.fn(async () => []),
          })),
          get: vi.fn(async () => handlers.selectGet?.(...selectArgs)),
          all: vi.fn(async () => []),
        })),
      };
      return chain;
    }),
    update: vi.fn((..._updateArgs: unknown[]) => ({
      set: vi.fn((..._setArgs: unknown[]) => ({
        where: vi.fn((..._whereArgs: unknown[]) => {
          const returningResult = handlers.updateReturning?.() ?? [];
          return {
            returning: vi.fn(() => {
              const arr = returningResult;
              (arr as any).get = vi.fn(async () => returningResult[0] ?? null);
              return arr;
            }),
          };
        }),
      })),
    })),
  };
  return db;
}

const PR_ROW_OPEN = {
  id: 'pr-1',
  repoId: 'repo-1',
  number: 1,
  title: 'Test PR',
  description: null,
  status: 'open',
  headBranch: 'feature',
  baseBranch: 'main',
  authorType: 'user',
  authorId: 'user-1',
  runId: null,
  mergedAt: null,
  updatedAt: '2026-02-15T00:00:00Z',
  createdAt: '2026-02-15T00:00:00Z',
};

const PR_ROW_MERGED = {
  ...PR_ROW_OPEN,
  status: 'merged',
  mergedAt: '2026-02-15T00:00:01Z',
  updatedAt: '2026-02-15T00:00:01Z',
};

describe('pull request merge', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.checkRepoAccess.mockResolvedValue({
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
    });

    mocks.triggerPullRequestWorkflows.mockResolvedValue(undefined);
    mocks.triggerPushWorkflows.mockResolvedValue(undefined);
    mocks.scheduleActionsAutoTrigger.mockImplementation((_ctx: unknown, fn: () => void) => {
      void fn();
    });

    // Default: select returns open PR, update returns merged PR, branch update returns 1 row
    const mockDb = createDrizzleMockDb({
      selectGet: () => PR_ROW_OPEN,
      updateReturning: () => [PR_ROW_MERGED],
    });
    mocks.getDb.mockReturnValue(mockDb);

    mocks.getBranch.mockImplementation(async (_db: unknown, _repoId: string, name: string) => {
      if (name === 'main') {
        return { name: 'main', commit_sha: 'base-sha' };
      }
      if (name === 'feature') {
        return { name: 'feature', commit_sha: 'head-sha' };
      }
      return null;
    });
  });

  it('returns 409 conflict when mergeTrees3Way reports conflicts', async () => {
    const env = createEnv();
    const app = createApp();

    // headIsAncestorOfBase=false, canFastForward=false
    mocks.isAncestor.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    mocks.findMergeBase.mockResolvedValue('merge-base-sha');
    mocks.getCommit.mockResolvedValue({ tree: 'tree-1' });
    mocks.mergeTrees3Way.mockResolvedValue({
      tree_sha: null,
      conflicts: [{ path: 'src/main.ts', type: 'content' }],
    });

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/pulls/1/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ merge_method: 'merge' }),
      }),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      status: 'conflict',
      conflicts: [{ path: 'src/main.ts', type: 'content' }],
      merge_base: 'merge-base-sha',
    });
    expect(mocks.createCommit).not.toHaveBeenCalled();
  });

  it('creates a merge commit when branches diverged and mergeTrees3Way succeeds', async () => {
    const env = createEnv();
    const app = createApp();

    // headIsAncestorOfBase=false, canFastForward=false
    mocks.isAncestor.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    mocks.findMergeBase.mockResolvedValue('merge-base-sha');
    mocks.getCommit.mockResolvedValue({ tree: 'tree-1' });
    mocks.mergeTrees3Way.mockResolvedValue({
      tree_sha: 'merged-tree',
      conflicts: [],
    });
    mocks.createCommit.mockResolvedValue({ sha: 'merge-commit-sha' });

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/pulls/1/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ merge_method: 'merge', commit_message: 'Merge PR' }),
      }),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      merge_commit: 'merge-commit-sha',
      pull_request: {
        id: 'pr-1',
        status: 'merged',
      },
    });

    expect(mocks.createCommit).toHaveBeenCalledTimes(1);
    expect(mocks.createCommit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'repo-1',
      expect.objectContaining({
        tree: 'merged-tree',
        parents: ['base-sha', 'head-sha'],
        message: 'Merge PR',
      })
    );

    expect(mocks.scheduleActionsAutoTrigger).toHaveBeenCalledTimes(1);
  });

  it('creates a squash commit even when fast-forward is possible', async () => {
    const env = createEnv();
    const app = createApp();

    // headIsAncestorOfBase=false, canFastForward=true
    mocks.isAncestor.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mocks.getCommit.mockResolvedValue({ tree: 'head-tree' });
    mocks.createCommit.mockResolvedValue({ sha: 'squash-commit-sha' });

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/pulls/1/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ merge_method: 'squash', commit_message: 'Squash PR' }),
      }),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      merge_commit: 'squash-commit-sha',
    });

    expect(mocks.createCommit).toHaveBeenCalledTimes(1);
    expect(mocks.createCommit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'repo-1',
      expect.objectContaining({
        tree: 'head-tree',
        parents: ['base-sha'],
        message: 'Squash PR',
      })
    );
  });

  it('returns REF_CONFLICT when branch head changed before atomic merge finalize', async () => {
    const env = createEnv();
    const app = createApp();

    // Override db mock: update returning empty (no rows updated), select returns current branch sha
    const mockDb = createDrizzleMockDb({
      selectGet: (...selectArgs: unknown[]) => {
        // First call is for findPullRequest, subsequent for branch lookup
        if ((selectGet_callCount++) === 0) return PR_ROW_OPEN;
        return { commitSha: 'other-sha', commit_sha: 'other-sha' };
      },
      updateReturning: () => [],  // branch update fails (0 rows)
    });
    let selectGet_callCount = 0;
    mocks.getDb.mockReturnValue(mockDb);

    mocks.isAncestor.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/pulls/1/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ merge_method: 'merge' }),
      }),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'REF_CONFLICT',
      current: 'other-sha',
    });
    expect(mocks.scheduleActionsAutoTrigger).not.toHaveBeenCalled();
  });

  it('rebases commits when branches diverged and merge_method=rebase', async () => {
    const env = createEnv();
    const app = createApp();

    // headIsAncestorOfBase=false, canFastForward=false
    mocks.isAncestor.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    mocks.findMergeBase.mockResolvedValue('merge-base-sha');

    // Commit graph: merge-base -> c1 -> c2(head)
    const commits = new Map<string, any>([
      ['base-sha', { sha: 'base-sha', tree: 'base-tree', parents: ['base-parent'], message: 'base', author: { name: 'A', email: 'a@a', timestamp: 't0' } }],
      ['merge-base-sha', { sha: 'merge-base-sha', tree: 'mb-tree', parents: ['mb-parent'], message: 'mb', author: { name: 'A', email: 'a@a', timestamp: 't0' } }],
      ['c1-sha', { sha: 'c1-sha', tree: 'c1-tree', parents: ['merge-base-sha'], message: 'c1', author: { name: 'A', email: 'a@a', timestamp: 't1' } }],
      ['head-sha', { sha: 'head-sha', tree: 'c2-tree', parents: ['c1-sha'], message: 'c2', author: { name: 'A', email: 'a@a', timestamp: 't2' } }],
    ]);

    mocks.getCommit.mockImplementation(async (_bucket: unknown, sha: string) => commits.get(sha) || null);

    // First cherry-pick: base=mb-tree local=base-tree upstream=c1-tree
    // Second cherry-pick: base=c1-tree local=rb1-tree upstream=c2-tree
    mocks.mergeTrees3Way
      .mockResolvedValueOnce({ tree_sha: 'rb1-tree', conflicts: [] })
      .mockResolvedValueOnce({ tree_sha: 'rb2-tree', conflicts: [] });

    mocks.createCommit
      .mockResolvedValueOnce({ sha: 'rb1-sha' })
      .mockResolvedValueOnce({ sha: 'rb2-sha' });

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/pulls/1/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ merge_method: 'rebase' }),
      }),
      env,
      {} as ExecutionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      merge_commit: 'rb2-sha',
      pull_request: {
        id: 'pr-1',
        status: 'merged',
      },
    });

    expect(mocks.mergeTrees3Way).toHaveBeenCalledTimes(2);
    expect(mocks.mergeTrees3Way).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'mb-tree',
      'base-tree',
      'c1-tree'
    );
    expect(mocks.mergeTrees3Way).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'c1-tree',
      'rb1-tree',
      'c2-tree'
    );

    expect(mocks.createCommit).toHaveBeenCalledTimes(2);
    expect(mocks.createCommit).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.anything(),
      'repo-1',
      expect.objectContaining({
        tree: 'rb1-tree',
        parents: ['base-sha'],
        message: 'c1',
      })
    );
    expect(mocks.createCommit).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.anything(),
      'repo-1',
      expect.objectContaining({
        tree: 'rb2-tree',
        parents: ['rb1-sha'],
        message: 'c2',
      })
    );
  });
});
