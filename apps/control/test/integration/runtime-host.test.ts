import { describe, expect, it, vi } from 'vitest';
vi.mock('@takos/control-hosts/container-runtime', () => ({
  Container: class {},
  HostContainerRuntime: class {},
}));

import runtimeHost, {
  buildRuntimeContainerEnv,
  RUNTIME_PROXY_TOKEN_HEADER,
} from '@/runtime/container-hosts/runtime-host';

describe('runtime-host', () => {
  it('builds the runtime container env from the host worker env', () => {
    expect(buildRuntimeContainerEnv({
      ADMIN_DOMAIN: 'test.takos.jp',
      JWT_PUBLIC_KEY: 'public-key',
      PROXY_BASE_URL: 'https://takos-runtime-host-staging.takos.workers.dev',
    })).toEqual({
      TAKOS_API_URL: 'https://test.takos.jp',
      JWT_PUBLIC_KEY: 'public-key',
      PROXY_BASE_URL: 'https://takos-runtime-host-staging.takos.workers.dev',
    });
  });

  it('forwards requests through the runtime container DO fetch path', async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const generateSessionProxyToken = vi.fn();
    const verifyProxyToken = vi.fn();
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({
          fetch: stubFetch,
          generateSessionProxyToken,
          verifyProxyToken,
        }),
      },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: 'https://takos-runtime-host-staging.takos.workers.dev',
    } as unknown as Parameters<typeof runtimeHost.fetch>[1];
    const request = new Request('https://runtime-host/api/runtime/ping');

    const response = await runtimeHost.fetch(request, env);

    expect(env.RUNTIME_CONTAINER.getByName).toHaveBeenCalledWith('singleton');
    const forwardedRequest = stubFetch.mock.calls[0]?.[0] as Request;
    expect(forwardedRequest).toBeInstanceOf(Request);
    expect(forwardedRequest.url).toBe(request.url);
    expect(forwardedRequest.method).toBe(request.method);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('ok');
  });

  it('injects a proxy token on runtime session creation', async () => {
    const stubFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const generateSessionProxyToken = vi.fn().mockResolvedValue('random-proxy-token-123');
    const verifyProxyToken = vi.fn();
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({
          fetch: stubFetch,
          generateSessionProxyToken,
          verifyProxyToken,
        }),
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

    expect(generateSessionProxyToken).toHaveBeenCalledWith('session-id-1234567890', 'space-a');

    const forwardedRequest = stubFetch.mock.calls[0]?.[0] as Request;
    const token = forwardedRequest.headers.get(RUNTIME_PROXY_TOKEN_HEADER);
    expect(token).toBe('random-proxy-token-123');
    await expect(forwardedRequest.json()).resolves.toEqual({
      session_id: 'session-id-1234567890',
      space_id: 'space-a',
    });
  });

  it('proxies /forward/cli-proxy requests to takos-web via service binding', async () => {
    const takosWebFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    const verifyProxyToken = vi.fn().mockResolvedValue({
      sessionId: 'session-id-1234567890',
      spaceId: 'space-a',
    });
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({ verifyProxyToken }),
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

    expect(verifyProxyToken).toHaveBeenCalledWith('valid-proxy-token');
    expect(takosWebFetch).toHaveBeenCalled();
    const proxiedRequest = takosWebFetch.mock.calls[0]?.[0] as Request;
    expect(proxiedRequest.url).toBe('https://takos-web/api/repos/repo-1/status');
    expect(proxiedRequest.headers.get('X-Takos-Internal')).toBe('1');
    expect(proxiedRequest.headers.get('X-Takos-Session-Id')).toBe('session-id-1234567890');
    expect(proxiedRequest.headers.get('X-Takos-Space-Id')).toBe('space-a');
    expect(response.status).toBe(200);
  });

  it('proxies /forward/heartbeat requests to takos-web via service binding', async () => {
    const takosWebFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    const verifyProxyToken = vi.fn().mockResolvedValue({
      sessionId: 'session-id-1234567890',
      spaceId: 'space-a',
    });
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({ verifyProxyToken }),
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

    expect(verifyProxyToken).toHaveBeenCalledWith('valid-proxy-token');
    expect(takosWebFetch).toHaveBeenCalled();
    const proxiedRequest = takosWebFetch.mock.calls[0]?.[0] as Request;
    expect(proxiedRequest.url).toBe('https://takos-web/api/sessions/session-id-1234567890/heartbeat');
    expect(proxiedRequest.headers.get('X-Takos-Internal')).toBe('1');
    expect(proxiedRequest.headers.get('X-Takos-Session-Id')).toBe('session-id-1234567890');
    expect(proxiedRequest.headers.get('X-Takos-Space-Id')).toBe('space-a');
    expect(response.status).toBe(200);
  });

  it('rejects /forward/* requests without a valid proxy token', async () => {
    const verifyProxyToken = vi.fn().mockResolvedValue(null);
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({ verifyProxyToken }),
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

    expect(response.status).toBe(401);
  });

  it('surfaces startup failures from the runtime container DO fetch path', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stubFetch = vi.fn().mockRejectedValue(new Error('The container is not running, consider calling start()'));
    const generateSessionProxyToken = vi.fn();
    const verifyProxyToken = vi.fn();
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({
          fetch: stubFetch,
          generateSessionProxyToken,
          verifyProxyToken,
        }),
      },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: 'https://takos-runtime-host-staging.takos.workers.dev',
    } as unknown as Parameters<typeof runtimeHost.fetch>[1];

    const response = await runtimeHost.fetch(new Request('https://runtime-host/api/runtime/ping'), env);

    expect(response.status).toBe(500);
    await expect(response.text()).resolves.toBe('Failed to start container: The container is not running, consider calling start()');
    consoleError.mockRestore();
  });
});
