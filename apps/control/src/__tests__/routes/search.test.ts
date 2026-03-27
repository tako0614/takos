import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  searchWorkspace: vi.fn(),
  quickSearchPaths: vi.fn(),
  requireSpaceAccess: vi.fn(),
  computeSHA256: vi.fn(),
}));

vi.mock('@/services/source/search', () => ({
  searchWorkspace: mocks.searchWorkspace,
  quickSearchPaths: mocks.quickSearchPaths,
}));

vi.mock('@/routes/shared/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/routes/shared/helpers')>();
  return {
    ...actual,
    requireSpaceAccess: mocks.requireSpaceAccess,
  };
});

vi.mock('@/shared/utils/hash', () => ({
  computeSHA256: mocks.computeSHA256,
}));

vi.mock('@/middleware/cache', () => ({
  CacheTags: { SEARCH: 'search' },
  CacheTTL: { SEARCH: 60 },
}));

vi.mock('@/shared/utils/logger', () => ({
  logError: vi.fn(),
}));

import searchRoute from '@/routes/search';

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

function createApp(user: User) {
  const app = new Hono<{ Bindings: Env; Variables: { user: User } }>();
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/api', searchRoute);
  return app;
}

describe('search routes', () => {
  const env = createMockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSpaceAccess.mockResolvedValue({ workspace: { id: 'ws-1' } });
    mocks.computeSHA256.mockResolvedValue('fakehash123456789');
  });

  describe('POST /api/spaces/:spaceId/search', () => {
    it('returns search results', async () => {
      mocks.searchWorkspace.mockResolvedValue({
        results: [{ path: 'test.ts', score: 0.9 }],
        total: 1,
        semanticAvailable: true,
      });

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'test query' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('query', 'test query');
      expect(json).toHaveProperty('results');
      expect(json).toHaveProperty('total', 1);
    });

    it('returns 400 for empty query', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });

    it('returns 400 for missing query', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON body', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not json',
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(400);
    });

    it('returns 404 when workspace access denied', async () => {
      mocks.requireSpaceAccess.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Workspace not found' }), { status: 404 }),
      );

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-bad/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'test' }),
        }),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/spaces/:spaceId/search/quick', () => {
    it('returns quick search results', async () => {
      mocks.quickSearchPaths.mockResolvedValue([{ path: 'test.ts' }]);

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/search/quick?q=test'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      const json = await res.json() as Record<string, unknown>;
      expect(json).toHaveProperty('results');
    });

    it('returns empty results for query shorter than 2 chars', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/search/quick?q=t'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ results: [] });
      expect(mocks.quickSearchPaths).not.toHaveBeenCalled();
    });

    it('returns empty results for missing query', async () => {
      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/search/quick'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ results: [] });
    });
  });
});
