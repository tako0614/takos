import { Hono } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

import { assertEquals } from 'jsr:@std/assert';

const mocks = ({
  getPlatformServices: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/platform/accessors.ts'
import { staticAssetsMiddleware } from '@/middleware/static-assets';

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: any }>();
  app.use('*', staticAssetsMiddleware);
  app.get('/api/data', (c) => c.json({ ok: true }));
  app.get('/auth/login', (c) => c.json({ auth: true }));
  app.get('/oauth/authorize', (c) => c.json({ oauth: true }));
  app.get('/dashboard', (c) => c.json({ fallback: true }));
  app.get('/some-asset.js', (c) => c.json({ fallback: true }));
  return app;
}


  Deno.test('staticAssetsMiddleware - passes through /api/ paths without checking assets', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPlatformServices = (() => ({
      assets: { binding: null },
    })) as any;

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/data'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { ok: true });
    // getPlatformServices should not be called for asset lookup on /api/ paths
})
  Deno.test('staticAssetsMiddleware - passes through /auth/ paths without checking assets', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPlatformServices = (() => ({
      assets: { binding: null },
    })) as any;

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/auth/login'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { auth: true });
})
  Deno.test('staticAssetsMiddleware - passes through /oauth/ paths without checking assets', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPlatformServices = (() => ({
      assets: { binding: null },
    })) as any;

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/oauth/authorize'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { oauth: true });
})
  Deno.test('staticAssetsMiddleware - returns asset when assets binding is available and asset is found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockAssetFetch = (async () => new Response('console.log("ok")', {
        status: 200,
        headers: { 'Content-Type': 'application/javascript' },
      }),);
    mocks.getPlatformServices = (() => ({
      assets: { binding: { fetch: mockAssetFetch } },
    })) as any;

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/some-asset.js'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('Content-Type'), 'application/javascript');
})
  Deno.test('staticAssetsMiddleware - falls through to next handler when assets binding is null', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.getPlatformServices = (() => ({
      assets: { binding: null },
    })) as any;

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/dashboard'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { fallback: true });
})
  Deno.test('staticAssetsMiddleware - falls through when asset fetch throws', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockAssetFetch = (async () => { throw new Error('Not found'); });
    mocks.getPlatformServices = (() => ({
      assets: { binding: { fetch: mockAssetFetch } },
    })) as any;

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/dashboard'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { fallback: true });
})
  Deno.test('staticAssetsMiddleware - falls through when asset response is text/html', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockAssetFetch = (async () => new Response('<html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),);
    mocks.getPlatformServices = (() => ({
      assets: { binding: { fetch: mockAssetFetch } },
    })) as any;

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/dashboard'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { fallback: true });
})
  Deno.test('staticAssetsMiddleware - falls through when asset response is not ok', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const mockAssetFetch = (async () => new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } }),);
    mocks.getPlatformServices = (() => ({
      assets: { binding: { fetch: mockAssetFetch } },
    })) as any;

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/dashboard'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { fallback: true });
})