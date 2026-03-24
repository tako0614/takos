import { describe, expect, it, vi } from 'vitest';
import { serveSpaFallback } from '@/utils/spa-fallback';

function createMockEnv(opts: { assetsAvailable?: boolean; indexHtmlOk?: boolean } = {}) {
  const { assetsAvailable = true, indexHtmlOk = true } = opts;

  if (!assetsAvailable) {
    return { ASSETS: undefined } as any;
  }

  return {
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(
        indexHtmlOk
          ? new Response('<html></html>', { status: 200 })
          : new Response('Not Found', { status: 404 })
      ),
    },
  } as any;
}

describe('serveSpaFallback', () => {
  it('returns HTML response when ASSETS is available and index.html exists', async () => {
    const env = createMockEnv({ assetsAvailable: true, indexHtmlOk: true });
    const res = await serveSpaFallback(env, 'https://example.com/app/page');

    expect(res).not.toBeNull();
    expect(res!.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(res!.headers.get('Cache-Control')).toBe('no-cache');
    const body = await res!.text();
    expect(body).toContain('<html>');
  });

  it('returns null when ASSETS is not available', async () => {
    const env = createMockEnv({ assetsAvailable: false });
    const res = await serveSpaFallback(env, 'https://example.com/app');
    expect(res).toBeNull();
  });

  it('returns null when index.html returns non-OK status', async () => {
    const env = createMockEnv({ assetsAvailable: true, indexHtmlOk: false });
    const res = await serveSpaFallback(env, 'https://example.com/app');
    expect(res).toBeNull();
  });

  it('returns null when ASSETS.fetch throws', async () => {
    const env = {
      ASSETS: {
        fetch: vi.fn().mockRejectedValue(new Error('ASSETS unavailable')),
      },
    } as any;

    const res = await serveSpaFallback(env, 'https://example.com/app');
    expect(res).toBeNull();
  });

  it('fetches /index.html based on the provided request URL', async () => {
    const env = createMockEnv();
    await serveSpaFallback(env, 'https://mysite.com/some/path');

    expect(env.ASSETS.fetch).toHaveBeenCalledOnce();
    const fetchedRequest = env.ASSETS.fetch.mock.calls[0][0] as Request;
    expect(new URL(fetchedRequest.url).pathname).toBe('/index.html');
  });
});
