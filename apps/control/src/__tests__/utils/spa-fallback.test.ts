import { serveSpaFallback } from '@/utils/spa-fallback';

import { assertEquals, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

function createMockEnv(opts: { assetsAvailable?: boolean; indexHtmlOk?: boolean } = {}) {
  const { assetsAvailable = true, indexHtmlOk = true } = opts;

  if (!assetsAvailable) {
    return { ASSETS: undefined } as any;
  }

  return {
    ASSETS: {
      fetch: (async () => indexHtmlOk
          ? new Response('<html></html>', { status: 200 })
          : new Response('Not Found', { status: 404 })),
    },
  } as any;
}


  Deno.test('serveSpaFallback - returns HTML response when ASSETS is available and index.html exists', async () => {
  const env = createMockEnv({ assetsAvailable: true, indexHtmlOk: true });
    const res = await serveSpaFallback(env, 'https://example.com/app/page');

    assertNotEquals(res, null);
    assertEquals(res!.headers.get('Content-Type'), 'text/html; charset=utf-8');
    assertEquals(res!.headers.get('Cache-Control'), 'no-cache');
    const body = await res!.text();
    assertStringIncludes(body, '<html>');
})
  Deno.test('serveSpaFallback - returns null when ASSETS is not available', async () => {
  const env = createMockEnv({ assetsAvailable: false });
    const res = await serveSpaFallback(env, 'https://example.com/app');
    assertEquals(res, null);
})
  Deno.test('serveSpaFallback - returns null when index.html returns non-OK status', async () => {
  const env = createMockEnv({ assetsAvailable: true, indexHtmlOk: false });
    const res = await serveSpaFallback(env, 'https://example.com/app');
    assertEquals(res, null);
})
  Deno.test('serveSpaFallback - returns null when ASSETS.fetch throws', async () => {
  const env = {
      ASSETS: {
        fetch: (async () => { throw new Error('ASSETS unavailable'); }),
      },
    } as any;

    const res = await serveSpaFallback(env, 'https://example.com/app');
    assertEquals(res, null);
})
  Deno.test('serveSpaFallback - fetches /index.html based on the provided request URL', async () => {
  const env = createMockEnv();
    await serveSpaFallback(env, 'https://mysite.com/some/path');

    assertSpyCalls(env.ASSETS.fetch, 1);
    const fetchedRequest = env.ASSETS.fetch.calls[0][0] as Request;
    assertEquals(new URL(fetchedRequest.url).pathname, '/index.html');
})