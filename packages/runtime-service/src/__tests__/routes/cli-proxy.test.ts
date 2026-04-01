import { createTestApp, testRequest } from '../setup.ts';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCalls, stub } from 'jsr:@std/testing/mock';

type CliProxyModule = typeof import('../../routes/cli/proxy.ts');

async function freshImport<T>(relativePath: string): Promise<T> {
  const url = new URL(relativePath, import.meta.url);
  url.searchParams.set('test', crypto.randomUUID());
  return await import(url.href) as T;
}

Deno.test('cli-proxy route - forwards query parameters via PROXY_BASE_URL while validating the path only', async () => {
  const originalTakosApiUrl = Deno.env.get('TAKOS_API_URL');
  const originalProxyBaseUrl = Deno.env.get('PROXY_BASE_URL');
  Deno.env.set('TAKOS_API_URL', 'https://takos.example.test');
  Deno.env.set('PROXY_BASE_URL', 'https://runtime-host.example.test');

  const heartbeatFetchStub = stub(
    globalThis,
    'fetch',
    (async () =>
      new Response('', {
        status: 204,
      })) as typeof globalThis.fetch,
  );
  const { sessionStore } = await import('../../routes/sessions/storage.ts');

  const sessionId = 'a12345678901234b';
  await sessionStore.getSessionDir(
    sessionId,
    'space-a',
    undefined,
    'random-proxy-token-abc',
  );

  heartbeatFetchStub.restore();

  const fetchSpy = stub(
    globalThis,
    'fetch',
    (async (..._args: Parameters<typeof globalThis.fetch>) => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof globalThis.fetch,
  );

  try {
    const { default: cliProxyRoutes } = await freshImport<CliProxyModule>(
      '../../routes/cli/proxy.ts',
    );
    const app = createTestApp();
    app.route('/', cliProxyRoutes);

    const response = await testRequest(app, {
      method: 'GET',
      path: '/cli-proxy/api/repos/repo-1/status',
      query: {
        ref: 'refs/heads/main',
        verbose: '1',
      },
      headers: {
        'X-Takos-Session-Id': sessionId,
        'X-Takos-Space-Id': 'space-a',
      },
    });

    assertEquals(response.status, 200);
    assertEquals(response.body, { ok: true });

    assertSpyCalls(fetchSpy, 1);
    const [forwardedUrl, forwardedOptions] = fetchSpy.calls[0]!.args as [
      string,
      { headers: Record<string, string>; method: string },
    ];

    assertEquals(
      forwardedUrl,
      'https://runtime-host.example.test/forward/cli-proxy/api/repos/repo-1/status?ref=refs%2Fheads%2Fmain&verbose=1',
    );
    assertEquals(forwardedOptions.method, 'GET');
    assertEquals(forwardedOptions.headers['X-Takos-Session-Id'], sessionId);
    assertEquals(
      forwardedOptions.headers.Authorization,
      'Bearer random-proxy-token-abc',
    );
  } finally {
    fetchSpy.restore();
    await sessionStore.destroySession(sessionId, 'space-a');

    if (originalTakosApiUrl === undefined) {
      Deno.env.delete('TAKOS_API_URL');
    } else {
      Deno.env.set('TAKOS_API_URL', originalTakosApiUrl);
    }
    if (originalProxyBaseUrl === undefined) {
      Deno.env.delete('PROXY_BASE_URL');
    } else {
      Deno.env.set('PROXY_BASE_URL', originalProxyBaseUrl);
    }
  }
});
