import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getUserByUsername: vi.fn(),
  getUserStats: vi.fn(),
  isFollowing: vi.fn(),
  batchStarCheck: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock('@/routes/profiles/shared', () => ({
  getUserByUsername: mocks.getUserByUsername,
  getUserStats: mocks.getUserStats,
  isFollowing: mocks.isFollowing,
  batchStarCheck: mocks.batchStarCheck,
  getUserPrivacySettings: vi.fn(),
  isMutedBy: vi.fn(),
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
}));

vi.mock('@/db/schema', () => ({
  repositories: {
    id: 'id', accountId: 'accountId', name: 'name',
    description: 'description', visibility: 'visibility',
    defaultBranch: 'defaultBranch', stars: 'stars', forks: 'forks',
    updatedAt: 'updatedAt',
  },
  repoStars: { repoId: 'repoId', userId: 'userId' },
  accounts: { id: 'id', slug: 'slug' },
}));

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return { ...actual };
});

import profiles from '@/routes/profiles/index';

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
  const app = new Hono<{ Bindings: Env; Variables: { user?: User } }>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user);
    await next();
  });
  app.route('/', profiles);
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
    all: vi.fn().mockResolvedValue(results),
    get: vi.fn().mockResolvedValue(results[0] ?? null),
  };
  mocks.getDb.mockReturnValue(chain);
  return chain;
}

describe('profiles view routes', () => {
  const env = createMockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /:username', () => {
    it('returns profile with repos for existing user', async () => {
      mocks.getUserByUsername.mockResolvedValue({
        id: 'u-target',
        username: 'targetuser',
        name: 'Target User',
        bio: 'A bio',
        picture: null,
        created_at: '2026-01-01T00:00:00.000Z',
      });
      mocks.getUserStats.mockResolvedValue({
        public_repo_count: 3,
        followers_count: 10,
        following_count: 5,
      });
      mocks.isFollowing.mockResolvedValue(false);
      mocks.batchStarCheck.mockResolvedValue(new Set());
      mockDbChain([]);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/targetuser'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { profile: { username: string; is_self: boolean }; recent_repos: unknown[] };
      expect(json.profile.username).toBe('targetuser');
      expect(json.profile.is_self).toBe(false);
    });

    it('returns 404 for non-existent user', async () => {
      mocks.getUserByUsername.mockResolvedValue(null);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/nonexistent'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('correctly identifies self view', async () => {
      mocks.getUserByUsername.mockResolvedValue({
        id: 'user-1', // same as createUser
        username: 'user1',
        name: 'User One',
        bio: null,
        picture: null,
        created_at: '2026-03-01T00:00:00.000Z',
      });
      mocks.getUserStats.mockResolvedValue({
        public_repo_count: 0,
        followers_count: 0,
        following_count: 0,
      });
      mocks.isFollowing.mockResolvedValue(false);
      mocks.batchStarCheck.mockResolvedValue(new Set());
      mockDbChain([]);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/user1'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { profile: { is_self: boolean } };
      expect(json.profile.is_self).toBe(true);
    });

    it('works for anonymous users', async () => {
      mocks.getUserByUsername.mockResolvedValue({
        id: 'u-target',
        username: 'targetuser',
        name: 'Target',
        bio: null,
        picture: null,
        created_at: '2026-01-01T00:00:00.000Z',
      });
      mocks.getUserStats.mockResolvedValue({
        public_repo_count: 0,
        followers_count: 0,
        following_count: 0,
      });
      mocks.isFollowing.mockResolvedValue(false);
      mocks.batchStarCheck.mockResolvedValue(new Set());
      mockDbChain([]);

      const app = createApp(); // no user
      const res = await app.fetch(
        new Request('http://localhost/targetuser'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { profile: { is_self: boolean } };
      expect(json.profile.is_self).toBe(false);
    });
  });

  describe('GET /:username/repos', () => {
    it('returns 404 for non-existent user', async () => {
      mocks.getUserByUsername.mockResolvedValue(null);

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/nonexistent/repos'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });

    it('returns repos with pagination metadata', async () => {
      mocks.getUserByUsername.mockResolvedValue({
        id: 'u-target',
        username: 'targetuser',
        name: 'Target',
        bio: null,
        picture: null,
        created_at: '2026-01-01T00:00:00.000Z',
      });
      mocks.batchStarCheck.mockResolvedValue(new Set());

      const chain = mockDbChain([]);
      chain.get.mockResolvedValue({ count: 0 });

      const app = createApp();
      const res = await app.fetch(
        new Request('http://localhost/targetuser/repos'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as { repos: unknown[]; total: number; has_more: boolean };
      expect(json).toHaveProperty('repos');
      expect(json).toHaveProperty('total');
      expect(json).toHaveProperty('has_more');
    });
  });
});
