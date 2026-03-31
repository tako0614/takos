import { Hono } from 'hono';
import type { Env, User } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { assertEquals, assert } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const mocks = ({
  searchWorkspace: ((..._args: any[]) => undefined) as any,
  quickSearchPaths: ((..._args: any[]) => undefined) as any,
  requireSpaceAccess: ((..._args: any[]) => undefined) as any,
  computeSHA256: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/source/search'
// [Deno] vi.mock removed - manually stub imports from '@/routes/shared/helpers'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/hash'
// [Deno] vi.mock removed - manually stub imports from '@/middleware/cache'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
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


  const env = createMockEnv();
  
    Deno.test('search routes - POST /api/spaces/:spaceId/search - returns search results', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.computeSHA256 = (async () => 'fakehash123456789') as any;
  mocks.searchWorkspace = (async () => ({
        results: [{ path: 'test.ts', score: 0.9 }],
        total: 1,
        semanticAvailable: true,
      })) as any;

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

      assertEquals(res.status, 200);
      const json = await res.json() as Record<string, unknown>;
      assert('query' in json); assertEquals((json as any)['query'], 'test query');
      assert('results' in json);
      assert('total' in json); assertEquals((json as any)['total'], 1);
})
    Deno.test('search routes - POST /api/spaces/:spaceId/search - returns 400 for empty query', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.computeSHA256 = (async () => 'fakehash123456789') as any;
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

      assertEquals(res.status, 400);
})
    Deno.test('search routes - POST /api/spaces/:spaceId/search - returns 400 for missing query', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.computeSHA256 = (async () => 'fakehash123456789') as any;
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

      assertEquals(res.status, 400);
})
    Deno.test('search routes - POST /api/spaces/:spaceId/search - returns 400 for invalid JSON body', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.computeSHA256 = (async () => 'fakehash123456789') as any;
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

      assertEquals(res.status, 400);
})
    Deno.test('search routes - POST /api/spaces/:spaceId/search - returns 404 when workspace access denied', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.computeSHA256 = (async () => 'fakehash123456789') as any;
  mocks.requireSpaceAccess = (async () => new Response(JSON.stringify({ error: 'Workspace not found' }), { status: 404 }),) as any;

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

      assertEquals(res.status, 404);
})  
  
    Deno.test('search routes - GET /api/spaces/:spaceId/search/quick - returns quick search results', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.computeSHA256 = (async () => 'fakehash123456789') as any;
  mocks.quickSearchPaths = (async () => [{ path: 'test.ts' }]) as any;

      const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/search/quick?q=test'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      const json = await res.json() as Record<string, unknown>;
      assert('results' in json);
})
    Deno.test('search routes - GET /api/spaces/:spaceId/search/quick - returns empty results for query shorter than 2 chars', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.computeSHA256 = (async () => 'fakehash123456789') as any;
  const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/search/quick?q=t'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      await assertEquals(await res.json(), { results: [] });
      assertSpyCalls(mocks.quickSearchPaths, 0);
})
    Deno.test('search routes - GET /api/spaces/:spaceId/search/quick - returns empty results for missing query', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.requireSpaceAccess = (async () => ({ workspace: { id: 'ws-1' } })) as any;
    mocks.computeSHA256 = (async () => 'fakehash123456789') as any;
  const app = createApp(createUser());
      const res = await app.fetch(
        new Request('http://localhost/api/spaces/sp-1/search/quick'),
        env as unknown as Env,
        {} as ExecutionContext,
      );

      assertEquals(res.status, 200);
      await assertEquals(await res.json(), { results: [] });
})  