import { Hono } from 'hono';
import type { Env, User } from '@/types';
import type { AuthenticatedRouteEnv } from '@/routes/shared/helpers';
import { createMockEnv } from '../../../../test/integration/setup';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  checkRepoAccess: ((..._args: any[]) => undefined) as any,
  getDb: ((..._args: any[]) => undefined) as any,
  // Git store
  getBranch: ((..._args: any[]) => undefined) as any,
  isAncestor: ((..._args: any[]) => undefined) as any,
  findMergeBase: ((..._args: any[]) => undefined) as any,
  getCommit: ((..._args: any[]) => undefined) as any,
  mergeTrees3Way: ((..._args: any[]) => undefined) as any,
  createCommit: ((..._args: any[]) => undefined) as any,
  // Actions
  scheduleActionsAutoTrigger: ((..._args: any[]) => undefined) as any,
  triggerPushWorkflows: ((..._args: any[]) => undefined) as any,
  triggerPullRequestWorkflows: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/source/repos'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart'
// [Deno] vi.mock removed - manually stub imports from '@/services/actions'
import pullRequestsBase from '@/routes/pull-requests/routes';

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
    select: (...selectArgs: unknown[]) => {
      const chain = {
        from: (..._fromArgs: unknown[]) => ({
          where: (..._whereArgs: unknown[]) => ({
            get: async () => handlers.selectGet?.(...selectArgs),
            all: async () => [],
          }),
          get: async () => handlers.selectGet?.(...selectArgs),
          all: async () => [],
        }),
      };
      return chain;
    },
    update: (..._updateArgs: unknown[]) => ({
      set: (..._setArgs: unknown[]) => ({
        where: (..._whereArgs: unknown[]) => {
          const returningResult = handlers.updateReturning?.() ?? [];
          return {
            returning: () => {
              const arr = returningResult;
              (arr as any).get = async () => returningResult[0] ?? null;
              return arr;
            },
          };
        },
      }),
    }),
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


  Deno.test('pull request merge - returns 409 conflict when mergeTrees3Way reports conflicts', async () => {
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

    mocks.triggerPullRequestWorkflows = (async () => undefined) as any;
    mocks.triggerPushWorkflows = (async () => undefined) as any;
    mocks.scheduleActionsAutoTrigger = (_ctx: unknown, fn: () => void) => {
      void fn();
    } as any;

    // Default: select returns open PR, update returns merged PR, branch update returns 1 row
    const mockDb = createDrizzleMockDb({
      selectGet: () => PR_ROW_OPEN,
      updateReturning: () => [PR_ROW_MERGED],
    });
    mocks.getDb = (() => mockDb) as any;

    mocks.getBranch = async (_db: unknown, _repoId: string, name: string) => {
      if (name === 'main') {
        return { name: 'main', commit_sha: 'base-sha' };
      }
      if (name === 'feature') {
        return { name: 'feature', commit_sha: 'head-sha' };
      }
      return null;
    } as any;
  const env = createEnv();
    const app = createApp();

    // headIsAncestorOfBase=false, canFastForward=false
    mocks.isAncestor = (async () => false) as any = (async () => false) as any;
    mocks.findMergeBase = (async () => 'merge-base-sha') as any;
    mocks.getCommit = (async () => ({ tree: 'tree-1' })) as any;
    mocks.mergeTrees3Way = (async () => ({
      tree_sha: null,
      conflicts: [{ path: 'src/main.ts', type: 'content' }],
    })) as any;

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/pulls/1/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ merge_method: 'merge' }),
      }),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 409);
    await assertEquals(await response.json(), {
      status: 'conflict',
      conflicts: [{ path: 'src/main.ts', type: 'content' }],
      merge_base: 'merge-base-sha',
    });
    assertSpyCalls(mocks.createCommit, 0);
})
  Deno.test('pull request merge - creates a merge commit when branches diverged and mergeTrees3Way succeeds', async () => {
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

    mocks.triggerPullRequestWorkflows = (async () => undefined) as any;
    mocks.triggerPushWorkflows = (async () => undefined) as any;
    mocks.scheduleActionsAutoTrigger = (_ctx: unknown, fn: () => void) => {
      void fn();
    } as any;

    // Default: select returns open PR, update returns merged PR, branch update returns 1 row
    const mockDb = createDrizzleMockDb({
      selectGet: () => PR_ROW_OPEN,
      updateReturning: () => [PR_ROW_MERGED],
    });
    mocks.getDb = (() => mockDb) as any;

    mocks.getBranch = async (_db: unknown, _repoId: string, name: string) => {
      if (name === 'main') {
        return { name: 'main', commit_sha: 'base-sha' };
      }
      if (name === 'feature') {
        return { name: 'feature', commit_sha: 'head-sha' };
      }
      return null;
    } as any;
  const env = createEnv();
    const app = createApp();

    // headIsAncestorOfBase=false, canFastForward=false
    mocks.isAncestor = (async () => false) as any = (async () => false) as any;
    mocks.findMergeBase = (async () => 'merge-base-sha') as any;
    mocks.getCommit = (async () => ({ tree: 'tree-1' })) as any;
    mocks.mergeTrees3Way = (async () => ({
      tree_sha: 'merged-tree',
      conflicts: [],
    })) as any;
    mocks.createCommit = (async () => ({ sha: 'merge-commit-sha' })) as any;

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/pulls/1/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ merge_method: 'merge', commit_message: 'Merge PR' }),
      }),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertObjectMatch(await response.json(), {
      merge_commit: 'merge-commit-sha',
      pull_request: {
        id: 'pr-1',
        status: 'merged',
      },
    });

    assertSpyCalls(mocks.createCommit, 1);
    assertSpyCallArgs(mocks.createCommit, 0, [
      expect.anything(),
      expect.anything(),
      'repo-1',
      ({
        tree: 'merged-tree',
        parents: ['base-sha', 'head-sha'],
        message: 'Merge PR',
      })
    ]);

    assertSpyCalls(mocks.scheduleActionsAutoTrigger, 1);
})
  Deno.test('pull request merge - creates a squash commit even when fast-forward is possible', async () => {
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

    mocks.triggerPullRequestWorkflows = (async () => undefined) as any;
    mocks.triggerPushWorkflows = (async () => undefined) as any;
    mocks.scheduleActionsAutoTrigger = (_ctx: unknown, fn: () => void) => {
      void fn();
    } as any;

    // Default: select returns open PR, update returns merged PR, branch update returns 1 row
    const mockDb = createDrizzleMockDb({
      selectGet: () => PR_ROW_OPEN,
      updateReturning: () => [PR_ROW_MERGED],
    });
    mocks.getDb = (() => mockDb) as any;

    mocks.getBranch = async (_db: unknown, _repoId: string, name: string) => {
      if (name === 'main') {
        return { name: 'main', commit_sha: 'base-sha' };
      }
      if (name === 'feature') {
        return { name: 'feature', commit_sha: 'head-sha' };
      }
      return null;
    } as any;
  const env = createEnv();
    const app = createApp();

    // headIsAncestorOfBase=false, canFastForward=true
    mocks.isAncestor = (async () => false) as any = (async () => true) as any;
    mocks.getCommit = (async () => ({ tree: 'head-tree' })) as any;
    mocks.createCommit = (async () => ({ sha: 'squash-commit-sha' })) as any;

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/pulls/1/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ merge_method: 'squash', commit_message: 'Squash PR' }),
      }),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertObjectMatch(await response.json(), {
      merge_commit: 'squash-commit-sha',
    });

    assertSpyCalls(mocks.createCommit, 1);
    assertSpyCallArgs(mocks.createCommit, 0, [
      expect.anything(),
      expect.anything(),
      'repo-1',
      ({
        tree: 'head-tree',
        parents: ['base-sha'],
        message: 'Squash PR',
      })
    ]);
})
  Deno.test('pull request merge - returns REF_CONFLICT when branch head changed before atomic merge finalize', async () => {
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

    mocks.triggerPullRequestWorkflows = (async () => undefined) as any;
    mocks.triggerPushWorkflows = (async () => undefined) as any;
    mocks.scheduleActionsAutoTrigger = (_ctx: unknown, fn: () => void) => {
      void fn();
    } as any;

    // Default: select returns open PR, update returns merged PR, branch update returns 1 row
    const mockDb = createDrizzleMockDb({
      selectGet: () => PR_ROW_OPEN,
      updateReturning: () => [PR_ROW_MERGED],
    });
    mocks.getDb = (() => mockDb) as any;

    mocks.getBranch = async (_db: unknown, _repoId: string, name: string) => {
      if (name === 'main') {
        return { name: 'main', commit_sha: 'base-sha' };
      }
      if (name === 'feature') {
        return { name: 'feature', commit_sha: 'head-sha' };
      }
      return null;
    } as any;
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
    mocks.getDb = (() => mockDb) as any;

    mocks.isAncestor = (async () => false) as any = (async () => true) as any;

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/pulls/1/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ merge_method: 'merge' }),
      }),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 409);
    await assertObjectMatch(await response.json(), {
      error: 'REF_CONFLICT',
      current: 'other-sha',
    });
    assertSpyCalls(mocks.scheduleActionsAutoTrigger, 0);
})
  Deno.test('pull request merge - rebases commits when branches diverged and merge_method=rebase', async () => {
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

    mocks.triggerPullRequestWorkflows = (async () => undefined) as any;
    mocks.triggerPushWorkflows = (async () => undefined) as any;
    mocks.scheduleActionsAutoTrigger = (_ctx: unknown, fn: () => void) => {
      void fn();
    } as any;

    // Default: select returns open PR, update returns merged PR, branch update returns 1 row
    const mockDb = createDrizzleMockDb({
      selectGet: () => PR_ROW_OPEN,
      updateReturning: () => [PR_ROW_MERGED],
    });
    mocks.getDb = (() => mockDb) as any;

    mocks.getBranch = async (_db: unknown, _repoId: string, name: string) => {
      if (name === 'main') {
        return { name: 'main', commit_sha: 'base-sha' };
      }
      if (name === 'feature') {
        return { name: 'feature', commit_sha: 'head-sha' };
      }
      return null;
    } as any;
  const env = createEnv();
    const app = createApp();

    // headIsAncestorOfBase=false, canFastForward=false
    mocks.isAncestor = (async () => false) as any = (async () => false) as any;
    mocks.findMergeBase = (async () => 'merge-base-sha') as any;

    // Commit graph: merge-base -> c1 -> c2(head)
    const commits = new Map<string, any>([
      ['base-sha', { sha: 'base-sha', tree: 'base-tree', parents: ['base-parent'], message: 'base', author: { name: 'A', email: 'a@a', timestamp: 't0' } }],
      ['merge-base-sha', { sha: 'merge-base-sha', tree: 'mb-tree', parents: ['mb-parent'], message: 'mb', author: { name: 'A', email: 'a@a', timestamp: 't0' } }],
      ['c1-sha', { sha: 'c1-sha', tree: 'c1-tree', parents: ['merge-base-sha'], message: 'c1', author: { name: 'A', email: 'a@a', timestamp: 't1' } }],
      ['head-sha', { sha: 'head-sha', tree: 'c2-tree', parents: ['c1-sha'], message: 'c2', author: { name: 'A', email: 'a@a', timestamp: 't2' } }],
    ]);

    mocks.getCommit = async (_bucket: unknown, sha: string) => commits.get(sha) || null as any;

    // First cherry-pick: base=mb-tree local=base-tree upstream=c1-tree
    // Second cherry-pick: base=c1-tree local=rb1-tree upstream=c2-tree
    mocks.mergeTrees3Way
       = (async () => ({ tree_sha: 'rb1-tree', conflicts: [] })) as any
       = (async () => ({ tree_sha: 'rb2-tree', conflicts: [] })) as any;

    mocks.createCommit
       = (async () => ({ sha: 'rb1-sha' })) as any
       = (async () => ({ sha: 'rb2-sha' })) as any;

    const response = await app.fetch(
      new Request('http://localhost/repos/repo-1/pulls/1/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ merge_method: 'rebase' }),
      }),
      env,
      {} as ExecutionContext
    );

    assertEquals(response.status, 200);
    await assertObjectMatch(await response.json(), {
      merge_commit: 'rb2-sha',
      pull_request: {
        id: 'pr-1',
        status: 'merged',
      },
    });

    assertSpyCalls(mocks.mergeTrees3Way, 2);
    assertSpyCallArgs(mocks.mergeTrees3Way, 0, [expect.anything(), 'mb-tree', 'base-tree', 'c1-tree']);
    assertSpyCallArgs(mocks.mergeTrees3Way, 1, [expect.anything(), 'c1-tree', 'rb1-tree', 'c2-tree']);

    assertSpyCalls(mocks.createCommit, 2);
    assertSpyCallArgs(mocks.createCommit, 0, [expect.anything(), expect.anything(), 'repo-1', ({
        tree: 'rb1-tree',
        parents: ['base-sha'],
        message: 'c1',
      })]);
    assertSpyCallArgs(mocks.createCommit, 1, [expect.anything(), expect.anything(), 'repo-1', ({
        tree: 'rb2-tree',
        parents: ['rb1-sha'],
        message: 'c2',
      })]);
})