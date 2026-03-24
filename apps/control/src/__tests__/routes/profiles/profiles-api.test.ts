import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  findRepoByUsernameAndName: vi.fn(),
  getUserByUsername: vi.fn(),
  getUserStats: vi.fn(),
  isFollowing: vi.fn(),
  batchStarCheck: vi.fn(),
  getUserPrivacySettings: vi.fn(),
  isMutedBy: vi.fn(),
  getDb: vi.fn(),
  listBranches: vi.fn(),
  getDefaultBranch: vi.fn(),
  resolveReadableCommitFromRef: vi.fn(),
  listDirectory: vi.fn(),
  getBlobAtPath: vi.fn(),
  getCommitsFromRef: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
}));

vi.mock('@/routes/profiles/shared', () => ({
  findRepoByUsernameAndName: mocks.findRepoByUsernameAndName,
  getUserByUsername: mocks.getUserByUsername,
  getUserStats: mocks.getUserStats,
  isFollowing: mocks.isFollowing,
  batchStarCheck: mocks.batchStarCheck,
  getUserPrivacySettings: mocks.getUserPrivacySettings,
  isMutedBy: mocks.isMutedBy,
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
}));

vi.mock('@/db/schema', () => ({
  repositories: { id: 'id', accountId: 'accountId', name: 'name', description: 'description', visibility: 'visibility', defaultBranch: 'defaultBranch', stars: 'stars', forks: 'forks', updatedAt: 'updatedAt' },
  repoStars: { accountId: 'accountId', repoId: 'repoId', createdAt: 'createdAt' },
  accounts: { id: 'id', slug: 'slug' },
  branches: { repoId: 'repoId' },
  repoForks: { forkRepoId: 'forkRepoId' },
  repoRemotes: { repoId: 'repoId' },
  workflowSecrets: { repoId: 'repoId' },
}));

vi.mock('@/services/git-smart', () => ({
  listBranches: mocks.listBranches,
  getDefaultBranch: mocks.getDefaultBranch,
  resolveReadableCommitFromRef: mocks.resolveReadableCommitFromRef,
  listDirectory: mocks.listDirectory,
  getBlobAtPath: mocks.getBlobAtPath,
  getCommitsFromRef: mocks.getCommitsFromRef,
  FILE_MODES: { DIRECTORY: '40000' },
}));

vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils')>();
  return {
    ...actual,
    checkWorkspaceAccess: mocks.checkWorkspaceAccess,
  };
});

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return { ...actual };
});

import profilesRepo from '@/routes/profiles/repo';

type OptionalUserVars = { user?: User };
type TestEnv = { Bindings: Env; Variables: OptionalUserVars };

function createUser(): User {
  return {
    id: 'user-1',
    email: 'user1@example.com',
    name: 'User One',
    username: 'user1',
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  };
}

function createApp(user?: User) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user);
    await next();
  });
  app.route('/', profilesRepo);
  return app;
}

function mockDbChain(results: unknown[] = []) {
  const chain: any = {
    select: vi.fn(() => chain),
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    offset: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    all: vi.fn().mockResolvedValue(results),
    get: vi.fn().mockResolvedValue(results[0] ?? null),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  };
  mocks.getDb.mockReturnValue(chain);
  return chain;
}

describe('profiles repo routes', () => {
  const env = createMockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /:username/:repoName', () => {
    it('returns 404 when repo not found', async () => {
      mocks.findRepoByUsernameAndName.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/user1/nonexistent'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('skips reserved paths (repos, stars, followers, following)', async () => {
      for (const reserved of ['repos', 'stars', 'followers', 'following']) {
        const app = createApp(createUser());
        const res = await app.fetch(
          new Request(`http://localhost/user1/${reserved}`),
          env as unknown as Env,
          {} as ExecutionContext,
        );

        expect(res.status).toBe(404);
        expect(mocks.findRepoByUsernameAndName).not.toHaveBeenCalled();
        mocks.findRepoByUsernameAndName.mockClear();
      }
    });

    it('returns repository data when found', async () => {
      mocks.findRepoByUsernameAndName.mockResolvedValue({
        repo: {
          id: 'repo-1',
          name: 'my-repo',
          description: 'A test repo',
          visibility: 'public',
          default_branch: 'main',
          stars: 5,
          forks: 2,
          forked_from_id: null,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-02-01T00:00:00.000Z',
        },
        workspace: { name: 'Personal', id: 'ws-1' },
        owner: {
          name: 'User One',
          username: 'user1',
          picture: null,
        },
      });
      mocks.listBranches.mockResolvedValue([{ name: 'main', is_default: true }]);
      const chain = mockDbChain([]);
      chain.get.mockResolvedValue(null); // no star

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/user1/my-repo'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as {
        repository: { name: string; stars: number };
        branch_count: number;
        starred: boolean;
      };
      expect(json.repository.name).toBe('my-repo');
      expect(json.repository.stars).toBe(5);
      expect(json.branch_count).toBe(1);
      expect(json.starred).toBe(false);
    });

    it('works for anonymous users (no starred check)', async () => {
      mocks.findRepoByUsernameAndName.mockResolvedValue({
        repo: {
          id: 'repo-1', name: 'public-repo', description: null,
          visibility: 'public', default_branch: 'main', stars: 0, forks: 0,
          forked_from_id: null, created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
        workspace: { name: 'Test', id: 'ws-1' },
        owner: { name: 'Owner', username: 'owner1', picture: null },
      });
      mocks.listBranches.mockResolvedValue([]);
      mockDbChain([]);

      const app = createApp(); // no user
      const res = await app.fetch(
        new Request('http://localhost/owner1/public-repo'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { starred: boolean };
      expect(json.starred).toBe(false);
    });
  });

  describe('GET /:username/:repoName/branches', () => {
    it('returns 404 when repo not found', async () => {
      mocks.findRepoByUsernameAndName.mockResolvedValue(null);

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/user1/missing/branches'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns branches list and default branch', async () => {
      mocks.findRepoByUsernameAndName.mockResolvedValue({
        repo: { id: 'repo-1', default_branch: 'main' },
        workspace: { name: 'W' },
        owner: { username: 'user1' },
      });
      mocks.listBranches.mockResolvedValue([
        { name: 'main', is_default: true, commit_sha: 'abc123' },
        { name: 'feature', is_default: false, commit_sha: 'def456' },
      ]);
      mocks.getDefaultBranch.mockResolvedValue({ name: 'main' });

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/user1/repo/branches'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { branches: Array<{ name: string }>; default_branch: string };
      expect(json.branches).toHaveLength(2);
      expect(json.default_branch).toBe('main');
    });
  });

  describe('GET /:username/:repoName/commits', () => {
    it('returns 404 when repo not found', async () => {
      mocks.findRepoByUsernameAndName.mockResolvedValue(null);

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/user1/missing/commits'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns commits from the default branch', async () => {
      mocks.findRepoByUsernameAndName.mockResolvedValue({
        repo: { id: 'repo-1', default_branch: 'main' },
        workspace: { name: 'W' },
        owner: { username: 'user1' },
      });
      mocks.getCommitsFromRef.mockResolvedValue([
        {
          sha: 'abc123456789',
          author: { name: 'Author', email: 'a@b.com', timestamp: '2026-01-01T00:00:00Z' },
          message: 'Initial commit',
        },
      ]);

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/user1/repo/commits'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { commits: Array<{ hash: string; short_hash: string; message: string }> };
      expect(json.commits).toHaveLength(1);
      expect(json.commits[0].hash).toBe('abc123456789');
      expect(json.commits[0].short_hash).toBe('abc1234');
      expect(json.commits[0].message).toBe('Initial commit');
    });
  });

  describe('DELETE /:username/:repoName', () => {
    it('returns 401 for anonymous users', async () => {
      const app = createApp(); // no user
      const res = await app.fetch(
        new Request('http://localhost/user1/repo', { method: 'DELETE' }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(401);
    });

    it('returns 404 when repo not found', async () => {
      mocks.findRepoByUsernameAndName.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/user1/missing', { method: 'DELETE' }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns 403 when user lacks owner/admin role', async () => {
      mocks.findRepoByUsernameAndName.mockResolvedValue({
        repo: { id: 'repo-1', forked_from_id: null },
        workspace: { id: 'ws-1' },
        owner: { username: 'user1' },
      });
      mocks.checkWorkspaceAccess.mockResolvedValue({
        member: { role: 'viewer' },
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/user1/repo', { method: 'DELETE' }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(403);
    });

    it('deletes repo when user has owner role', async () => {
      mocks.findRepoByUsernameAndName.mockResolvedValue({
        repo: { id: 'repo-1', forked_from_id: null },
        workspace: { id: 'ws-1' },
        owner: { username: 'user1' },
      });
      mocks.checkWorkspaceAccess.mockResolvedValue({
        member: { role: 'owner' },
      });
      const chain = mockDbChain([]);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/user1/repo', { method: 'DELETE' }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { success: boolean };
      expect(json.success).toBe(true);
      // Verify cascading deletes were called
      expect(chain.delete).toHaveBeenCalled();
    });
  });
});
