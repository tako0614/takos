import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  listExploreRepos: vi.fn(),
  listTrendingRepos: vi.fn(),
  listNewRepos: vi.fn(),
  listRecentRepos: vi.fn(),
  listCatalogItems: vi.fn(),
  cache: {
    match: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/services/source/explore', () => ({
  listExploreRepos: mocks.listExploreRepos,
  listTrendingRepos: mocks.listTrendingRepos,
  listNewRepos: mocks.listNewRepos,
  listRecentRepos: mocks.listRecentRepos,
  listCatalogItems: mocks.listCatalogItems,
}));

import explore from '@/routes/explore';

type Vars = { user?: User };
type HonoEnv = { Bindings: Env; Variables: Vars };

function createUser(id: string, username: string): User {
  return {
    id,
    email: `${username}@example.com`,
    name: username,
    username,
    bio: null,
    picture: null,
    trust_tier: 'normal',
    setup_completed: true,
    created_at: '2026-02-22T00:00:00.000Z',
    updated_at: '2026-02-22T00:00:00.000Z',
  };
}

function createApp(user?: User) {
  const app = new Hono<HonoEnv>();
  app.use('*', async (c, next) => {
    if (user) c.set('user', user);
    await next();
  });
  app.route('/api', explore);
  return app;
}

describe('GET /explore/catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { caches: CacheStorage }).caches = {
      default: mocks.cache as unknown as Cache,
    } as CacheStorage;
    mocks.cache.match.mockResolvedValue(undefined);
    mocks.cache.put.mockResolvedValue(undefined);
    mocks.cache.delete.mockResolvedValue(true);
    mocks.listCatalogItems.mockResolvedValue({
      items: [],
      total: 0,
      has_more: false,
    });
  });

  it('returns 400 when sort is invalid', async () => {
    const app = createApp();
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/catalog?sort=invalid'),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'Invalid sort' });
    expect(mocks.listCatalogItems).not.toHaveBeenCalled();
  });

  it('returns 401 when space_id is specified without auth', async () => {
    const app = createApp();
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/catalog?space_id=me'),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Authentication required for space_id',
    });
    expect(mocks.listCatalogItems).not.toHaveBeenCalled();
  });

  it('calls listCatalogItems with normalized query options', async () => {
    const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/catalog?q=runtime&sort=downloads&type=deployable-app&limit=10&offset=20&category=app&language=typescript&license=mit&since=2026-02-01&tags=cli,tools&certified_only=true'),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(mocks.listCatalogItems).toHaveBeenCalledTimes(1);
    expect(mocks.listCatalogItems).toHaveBeenCalledWith(env.DB, {
      sort: 'downloads',
      type: 'deployable-app',
      limit: 10,
      offset: 20,
      searchQuery: 'runtime',
      category: 'app',
      language: 'typescript',
      license: 'mit',
      since: '2026-02-01T00:00:00.000Z',
      tagsRaw: 'cli,tools',
      certifiedOnly: true,
      spaceId: undefined,
      userId: 'user-1',
    });

    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 0,
      has_more: false,
    });
  });
});
