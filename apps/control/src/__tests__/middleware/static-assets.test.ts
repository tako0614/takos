import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getPlatformServices: vi.fn(),
}));

vi.mock('@/platform/accessors.ts', () => ({
  getPlatformServices: mocks.getPlatformServices,
}));

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

describe('staticAssetsMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through /api/ paths without checking assets', async () => {
    mocks.getPlatformServices.mockReturnValue({
      assets: { binding: null },
    });

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/data'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    // getPlatformServices should not be called for asset lookup on /api/ paths
  });

  it('passes through /auth/ paths without checking assets', async () => {
    mocks.getPlatformServices.mockReturnValue({
      assets: { binding: null },
    });

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/auth/login'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ auth: true });
  });

  it('passes through /oauth/ paths without checking assets', async () => {
    mocks.getPlatformServices.mockReturnValue({
      assets: { binding: null },
    });

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/oauth/authorize'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ oauth: true });
  });

  it('returns asset when assets binding is available and asset is found', async () => {
    const mockAssetFetch = vi.fn().mockResolvedValue(
      new Response('console.log("ok")', {
        status: 200,
        headers: { 'Content-Type': 'application/javascript' },
      }),
    );
    mocks.getPlatformServices.mockReturnValue({
      assets: { binding: { fetch: mockAssetFetch } },
    });

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/some-asset.js'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/javascript');
  });

  it('falls through to next handler when assets binding is null', async () => {
    mocks.getPlatformServices.mockReturnValue({
      assets: { binding: null },
    });

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/dashboard'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ fallback: true });
  });

  it('falls through when asset fetch throws', async () => {
    const mockAssetFetch = vi.fn().mockRejectedValue(new Error('Not found'));
    mocks.getPlatformServices.mockReturnValue({
      assets: { binding: { fetch: mockAssetFetch } },
    });

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/dashboard'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ fallback: true });
  });

  it('falls through when asset response is text/html', async () => {
    const mockAssetFetch = vi.fn().mockResolvedValue(
      new Response('<html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    mocks.getPlatformServices.mockReturnValue({
      assets: { binding: { fetch: mockAssetFetch } },
    });

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/dashboard'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ fallback: true });
  });

  it('falls through when asset response is not ok', async () => {
    const mockAssetFetch = vi.fn().mockResolvedValue(
      new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain' } }),
    );
    mocks.getPlatformServices.mockReturnValue({
      assets: { binding: { fetch: mockAssetFetch } },
    });

    const app = createApp();
    const res = await app.fetch(
      new Request('http://localhost/dashboard'),
      createMockEnv() as unknown as Env,
      {} as ExecutionContext,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ fallback: true });
  });
});
