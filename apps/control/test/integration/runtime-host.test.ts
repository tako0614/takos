import runtimeHost, {
  buildRuntimeContainerEnv,
  RUNTIME_PROXY_TOKEN_HEADER,
} from '@/runtime/container-hosts/runtime-host';


import { assertEquals, assert } from 'jsr:@std/assert';
import { stub, assertSpyCallArgs } from 'jsr:@std/testing/mock';

  Deno.test('runtime-host - builds the runtime container env from the host worker env', () => {
  assertEquals(buildRuntimeContainerEnv({
      ADMIN_DOMAIN: 'test.takos.jp',
      JWT_PUBLIC_KEY: 'public-key',
      PROXY_BASE_URL: 'https://takos-runtime-host-staging.takos.workers.dev',
    }), {
      TAKOS_API_URL: 'https://test.takos.jp',
      JWT_PUBLIC_KEY: 'public-key',
      PROXY_BASE_URL: 'https://takos-runtime-host-staging.takos.workers.dev',
    });
})
  Deno.test('runtime-host - forwards requests through the runtime container DO fetch path', async () => {
  const stubFetch = (async () => new Response('ok', { status: 200 }));
    const generateSessionProxyToken = ((..._args: any[]) => undefined) as any;
    const verifyProxyToken = ((..._args: any[]) => undefined) as any;
    const env = {
      RUNTIME_CONTAINER: {
        getByName: (() => ({
          fetch: stubFetch,
          generateSessionProxyToken,
          verifyProxyToken,
        })),
      },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: 'https://takos-runtime-host-staging.takos.workers.dev',
    } as unknown as Parameters<typeof runtimeHost.fetch>[1];
    const request = new Request('https://runtime-host/api/runtime/ping');

    const response = await runtimeHost.fetch(request, env);

    assertSpyCallArgs(env.RUNTIME_CONTAINER.getByName, 0, ['singleton']);
    const forwardedRequest = stubFetch.calls[0]?.[0] as Request;
    assert(forwardedRequest instanceof Request);
    assertEquals(forwardedRequest.url, request.url);
    assertEquals(forwardedRequest.method, request.method);
    assertEquals(response.status, 200);
    await assertEquals(await response.text(), 'ok');
})
  Deno.test('runtime-host - injects a proxy token on runtime session creation', async () => {
  const stubFetch = (async () => new Response('ok', { status: 200 }));
    const generateSessionProxyToken = (async () => 'random-proxy-token-123');
    const verifyProxyToken = ((..._args: any[]) => undefined) as any;
    const env = {
      RUNTIME_CONTAINER: {
        getByName: (() => ({
          fetch: stubFetch,
          generateSessionProxyToken,
          verifyProxyToken,
        })),
      },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: 'https://takos-runtime-host-staging.takos.workers.dev',
    } as unknown as Parameters<typeof runtimeHost.fetch>[1];

    await runtimeHost.fetch(new Request('https://runtime-host/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session_id: 'session-id-1234567890',
        space_id: 'space-a',
      }),
    }), env);

    assertSpyCallArgs(generateSessionProxyToken, 0, ['session-id-1234567890', 'space-a']);

    const forwardedRequest = stubFetch.calls[0]?.[0] as Request;
    const token = forwardedRequest.headers.get(RUNTIME_PROXY_TOKEN_HEADER);
    assertEquals(token, 'random-proxy-token-123');
    await assertEquals(await forwardedRequest.json(), {
      session_id: 'session-id-1234567890',
      space_id: 'space-a',
    });
})
  Deno.test('runtime-host - proxies /forward/cli-proxy requests to takos-web via service binding', async () => {
  const takosWebFetch = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const verifyProxyToken = (async () => ({
      sessionId: 'session-id-1234567890',
      spaceId: 'space-a',
    }));
    const env = {
      RUNTIME_CONTAINER: {
        getByName: (() => ({ verifyProxyToken })),
      },
      TAKOS_WEB: { fetch: takosWebFetch },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: 'https://takos-runtime-host-staging.takos.workers.dev',
    } as unknown as Parameters<typeof runtimeHost.fetch>[1];

    const response = await runtimeHost.fetch(new Request('https://runtime-host/forward/cli-proxy/api/repos/repo-1/status', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer valid-proxy-token',
        'X-Takos-Session-Id': 'session-id-1234567890',
      },
    }), env);

    assertSpyCallArgs(verifyProxyToken, 0, ['valid-proxy-token']);
    assert(takosWebFetch.calls.length > 0);
    const proxiedRequest = takosWebFetch.calls[0]?.[0] as Request;
    assertEquals(proxiedRequest.url, 'https://takos-web/api/repos/repo-1/status');
    assertEquals(proxiedRequest.headers.get('X-Takos-Internal'), '1');
    assertEquals(proxiedRequest.headers.get('X-Takos-Session-Id'), 'session-id-1234567890');
    assertEquals(proxiedRequest.headers.get('X-Takos-Space-Id'), 'space-a');
    assertEquals(response.status, 200);
})
  Deno.test('runtime-host - proxies /forward/heartbeat requests to takos-web via service binding', async () => {
  const takosWebFetch = (async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    const verifyProxyToken = (async () => ({
      sessionId: 'session-id-1234567890',
      spaceId: 'space-a',
    }));
    const env = {
      RUNTIME_CONTAINER: {
        getByName: (() => ({ verifyProxyToken })),
      },
      TAKOS_WEB: { fetch: takosWebFetch },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: 'https://takos-runtime-host-staging.takos.workers.dev',
    } as unknown as Parameters<typeof runtimeHost.fetch>[1];

    const response = await runtimeHost.fetch(new Request('https://runtime-host/forward/heartbeat/session-id-1234567890', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer valid-proxy-token',
      },
    }), env);

    assertSpyCallArgs(verifyProxyToken, 0, ['valid-proxy-token']);
    assert(takosWebFetch.calls.length > 0);
    const proxiedRequest = takosWebFetch.calls[0]?.[0] as Request;
    assertEquals(proxiedRequest.url, 'https://takos-web/api/sessions/session-id-1234567890/heartbeat');
    assertEquals(proxiedRequest.headers.get('X-Takos-Internal'), '1');
    assertEquals(proxiedRequest.headers.get('X-Takos-Session-Id'), 'session-id-1234567890');
    assertEquals(proxiedRequest.headers.get('X-Takos-Space-Id'), 'space-a');
    assertEquals(response.status, 200);
})
  Deno.test('runtime-host - rejects /forward/* requests without a valid proxy token', async () => {
  const verifyProxyToken = (async () => null);
    const env = {
      RUNTIME_CONTAINER: {
        getByName: (() => ({ verifyProxyToken })),
      },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: 'https://takos-runtime-host-staging.takos.workers.dev',
    } as unknown as Parameters<typeof runtimeHost.fetch>[1];

    const response = await runtimeHost.fetch(new Request('https://runtime-host/forward/cli-proxy/api/repos/repo-1/status', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer invalid-token',
        'X-Takos-Session-Id': 'session-id-1234567890',
      },
    }), env);

    assertEquals(response.status, 401);
})
  Deno.test('runtime-host - surfaces startup failures from the runtime container DO fetch path', async () => {
  const consoleError = stub(console, 'error') = () => {} as any;
    const stubFetch = (async () => { throw new Error('The container is not running, consider calling start()'); });
    const generateSessionProxyToken = ((..._args: any[]) => undefined) as any;
    const verifyProxyToken = ((..._args: any[]) => undefined) as any;
    const env = {
      RUNTIME_CONTAINER: {
        getByName: (() => ({
          fetch: stubFetch,
          generateSessionProxyToken,
          verifyProxyToken,
        })),
      },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: 'https://takos-runtime-host-staging.takos.workers.dev',
    } as unknown as Parameters<typeof runtimeHost.fetch>[1];

    const response = await runtimeHost.fetch(new Request('https://runtime-host/api/runtime/ping'), env);

    assertEquals(response.status, 500);
    await assertEquals(await response.text(), 'Failed to start container: The container is not running, consider calling start()');
    consoleError.restore();
})