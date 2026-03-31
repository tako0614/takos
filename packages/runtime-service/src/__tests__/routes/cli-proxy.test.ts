import { createTestApp, testRequest } from '../setup.ts';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls } from 'jsr:@std/testing/mock';

const hoisted = {
  Deno.env.set('TAKOS_API_URL', 'https://takos.example.test');
  Deno.env.set('PROXY_BASE_URL', 'https://runtime-host.example.test');
  return {
    getSession: ((..._args: any[]) => undefined) as any,
    fetch: ((..._args: any[]) => undefined) as any,
  };
};

// [Deno] vi.mock removed - manually stub imports from '../../routes/sessions/storage.ts'
import cliProxyRoutes from '../../routes/cli/proxy.ts';


  Deno.test('cli-proxy route - forwards query parameters via PROXY_BASE_URL while validating the path only', async () => {
  hoisted.getSession;
    hoisted.fetch;
    (globalThis as any).fetch = hoisted.fetch;
  try {
  const app = createTestApp();
    app.route('/', cliProxyRoutes);

    hoisted.getSession = (() => ({
      id: 'a12345678901234b',
      spaceId: 'space-a',
      proxyToken: 'random-proxy-token-abc',
      lastAccessedAt: 0,
    })) as any;
    hoisted.fetch = (async () => ({
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    })) as any;

    const response = await testRequest(app, {
      method: 'GET',
      path: '/cli-proxy/api/repos/repo-1/status',
      query: {
        ref: 'refs/heads/main',
        verbose: '1',
      },
      headers: {
        'X-Takos-Session-Id': 'a12345678901234b',
        'X-Takos-Space-Id': 'space-a',
      },
    });

    assertEquals(response.status, 200);
    assertEquals(response.body, { ok: true });

    assertSpyCalls(hoisted.fetch, 1);
    const forwardedUrl = hoisted.fetch.calls[0]?.[0] as string;
    const forwardedOptions = hoisted.fetch.calls[0]?.[1] as { headers: Record<string, string>; method: string };

    assertEquals(forwardedUrl, 'https://runtime-host.example.test/forward/cli-proxy/api/repos/repo-1/status?ref=refs%2Fheads%2Fmain&verbose=1');
    assertEquals(forwardedOptions.method, 'GET');
    assertEquals(forwardedOptions.headers['X-Takos-Session-Id'], 'a12345678901234b');
    assertEquals(forwardedOptions.headers.Authorization, 'Bearer random-proxy-token-abc');
  } finally {
  /* TODO: restore stubbed globals manually */ void 0;
  }
})