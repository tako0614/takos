import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { ExecutionContext } from '@takos/cloudflare-compat';
import { withCache, CacheTTL } from '@/middleware/cache';
import { SESSION_COOKIE_NAME } from '@/services/identity/session';

type CacheMock = {
  match: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function createCacheMock(): CacheMock {
  return {
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
  };
}

describe('withCache', () => {
  let cache: CacheMock;

  beforeEach(() => {
    cache = createCacheMock();
    (globalThis as typeof globalThis & { caches?: CacheStorage }).caches = {
      default: cache as unknown as Cache,
    } as CacheStorage;
  });

  it('bypasses cache for authenticated session cookies', async () => {
    const app = new Hono();
    app.get('/explore', withCache({ ttl: CacheTTL.PUBLIC_LISTING }), (c) => {
      return c.json({ ok: true, source: 'live' });
    });

    const res = await app.request('https://takos.test/explore', {
      headers: {
        Cookie: `${SESSION_COOKIE_NAME}=session-123`,
      },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, source: 'live' });
    expect(cache.match).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('uses cache for anonymous GET requests', async () => {
    const app = new Hono();
    app.get('/explore', withCache({ ttl: CacheTTL.PUBLIC_LISTING }), (c) => {
      return c.json({ ok: true, source: 'live' });
    });

    const executionCtx: ExecutionContext = {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
      props: {},
    };
    const res = await app.request('https://takos.test/explore', undefined, undefined, executionCtx);
    await Promise.resolve();

    expect(res.status).toBe(200);
    expect(cache.match).toHaveBeenCalledTimes(1);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });
});
