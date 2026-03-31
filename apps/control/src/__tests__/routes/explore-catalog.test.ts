import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  listExploreRepos: ((..._args: any[]) => undefined) as any,
  listTrendingRepos: ((..._args: any[]) => undefined) as any,
  listNewRepos: ((..._args: any[]) => undefined) as any,
  listRecentRepos: ((..._args: any[]) => undefined) as any,
  listCatalogItems: ((..._args: any[]) => undefined) as any,
  cache: {
    match: ((..._args: any[]) => undefined) as any,
    put: ((..._args: any[]) => undefined) as any,
    delete: ((..._args: any[]) => undefined) as any,
  },
});

// [Deno] vi.mock removed - manually stub imports from '@/services/source/explore'
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


  Deno.test('GET /explore/catalog - returns 400 when sort is invalid', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    (globalThis as unknown as { caches: CacheStorage }).caches = {
      default: mocks.cache as unknown as Cache,
    } as CacheStorage;
    mocks.cache.match = (async () => undefined) as any;
    mocks.cache.put = (async () => undefined) as any;
    mocks.cache.delete = (async () => true) as any;
    mocks.listCatalogItems = (async () => ({
      items: [],
      total: 0,
      has_more: false,
    })) as any;
  const app = createApp();
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/catalog?sort=invalid'),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 400);
    await assertObjectMatch(await response.json(), { error: 'Invalid sort' });
    assertSpyCalls(mocks.listCatalogItems, 0);
})
  Deno.test('GET /explore/catalog - returns 401 when space_id is specified without auth', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    (globalThis as unknown as { caches: CacheStorage }).caches = {
      default: mocks.cache as unknown as Cache,
    } as CacheStorage;
    mocks.cache.match = (async () => undefined) as any;
    mocks.cache.put = (async () => undefined) as any;
    mocks.cache.delete = (async () => true) as any;
    mocks.listCatalogItems = (async () => ({
      items: [],
      total: 0,
      has_more: false,
    })) as any;
  const app = createApp();
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/catalog?space_id=me'),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 401);
    await assertObjectMatch(await response.json(), {
      error: 'Authentication required for space_id',
    });
    assertSpyCalls(mocks.listCatalogItems, 0);
})
  Deno.test('GET /explore/catalog - calls listCatalogItems with normalized query options', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    (globalThis as unknown as { caches: CacheStorage }).caches = {
      default: mocks.cache as unknown as Cache,
    } as CacheStorage;
    mocks.cache.match = (async () => undefined) as any;
    mocks.cache.put = (async () => undefined) as any;
    mocks.cache.delete = (async () => true) as any;
    mocks.listCatalogItems = (async () => ({
      items: [],
      total: 0,
      has_more: false,
    })) as any;
  const app = createApp(createUser('user-1', 'alice'));
    const env = createMockEnv() as unknown as Env;

    const response = await app.fetch(
      new Request('https://takos.jp/api/catalog?q=runtime&sort=downloads&type=deployable-app&limit=10&offset=20&category=app&language=typescript&license=mit&since=2026-02-01&tags=cli,tools&certified_only=true'),
      env,
      {} as ExecutionContext,
    );

    assertEquals(response.status, 200);
    assertSpyCalls(mocks.listCatalogItems, 1);
    assertSpyCallArgs(mocks.listCatalogItems, 0, [env.DB, {
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
    }]);

    await assertEquals(await response.json(), {
      items: [],
      total: 0,
      has_more: false,
    });
})