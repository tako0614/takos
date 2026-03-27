/**
 * Tests for runtime-host container lifecycle, proxy token management,
 * and forward request handling.
 *
 * Basic fetch/forward tests live in test/runtime-host.test.ts.
 * This file focuses on TakosRuntimeContainer class methods (token lifecycle,
 * buildRuntimeForwardRequest edge cases) and additional error paths.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  TakosRuntimeContainer,
  buildRuntimeContainerEnv,
  buildRuntimeForwardRequest,
  RUNTIME_PROXY_TOKEN_HEADER,
} from '@/container-hosts/runtime-host';
import runtimeHost from '@/container-hosts/runtime-host';

// ---------------------------------------------------------------------------
// buildRuntimeContainerEnv
// ---------------------------------------------------------------------------

describe('buildRuntimeContainerEnv', () => {
  it('includes TAKOS_API_URL from ADMIN_DOMAIN', () => {
    const result = buildRuntimeContainerEnv({
      ADMIN_DOMAIN: 'example.takos.jp',
      PROXY_BASE_URL: '',
    });
    expect(result.TAKOS_API_URL).toBe('https://example.takos.jp');
  });

  it('includes PROXY_BASE_URL when provided', () => {
    const result = buildRuntimeContainerEnv({
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: 'https://proxy.workers.dev',
    });
    expect(result.PROXY_BASE_URL).toBe('https://proxy.workers.dev');
  });

  it('omits PROXY_BASE_URL when empty string', () => {
    const result = buildRuntimeContainerEnv({
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: '',
    });
    expect(result).not.toHaveProperty('PROXY_BASE_URL');
  });

  it('includes JWT_PUBLIC_KEY when provided', () => {
    const result = buildRuntimeContainerEnv({
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: '',
      JWT_PUBLIC_KEY: 'my-public-key',
    });
    expect(result.JWT_PUBLIC_KEY).toBe('my-public-key');
  });

  it('omits JWT_PUBLIC_KEY when undefined', () => {
    const result = buildRuntimeContainerEnv({
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: '',
    });
    expect(result).not.toHaveProperty('JWT_PUBLIC_KEY');
  });
});

// ---------------------------------------------------------------------------
// TakosRuntimeContainer token lifecycle
// ---------------------------------------------------------------------------

describe('TakosRuntimeContainer proxy token lifecycle', () => {
  let container: TakosRuntimeContainer;
  let mockStorage: Map<string, unknown>;

  beforeEach(() => {
    mockStorage = new Map();
    const mockCtx = {
      storage: {
        get: vi.fn(async (key: string) => mockStorage.get(key) ?? undefined),
        put: vi.fn(async (key: string, value: unknown) => { mockStorage.set(key, value); }),
      },
    };
    const mockEnv = {
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: 'https://proxy.workers.dev',
    };

    container = new TakosRuntimeContainer(mockCtx as any, mockEnv as any);
  });

  it('generates and verifies a proxy token', async () => {
    const token = await container.generateSessionProxyToken('session-1', 'space-1');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);

    const info = await container.verifyProxyToken(token);
    expect(info).toEqual({ sessionId: 'session-1', spaceId: 'space-1' });
  });

  it('returns null for unknown tokens', async () => {
    const info = await container.verifyProxyToken('unknown-token-abc');
    expect(info).toBeNull();
  });

  it('supports multiple tokens concurrently', async () => {
    const token1 = await container.generateSessionProxyToken('session-1', 'space-1');
    const token2 = await container.generateSessionProxyToken('session-2', 'space-2');

    expect(token1).not.toBe(token2);

    const info1 = await container.verifyProxyToken(token1);
    expect(info1).toEqual({ sessionId: 'session-1', spaceId: 'space-1' });

    const info2 = await container.verifyProxyToken(token2);
    expect(info2).toEqual({ sessionId: 'session-2', spaceId: 'space-2' });
  });

  it('persists tokens to storage', async () => {
    await container.generateSessionProxyToken('s1', 'sp1');

    const stored = mockStorage.get('proxyTokens') as Record<string, unknown>;
    expect(stored).toBeDefined();
    expect(Object.keys(stored)).toHaveLength(1);
  });

  it('loads tokens from storage on first verify when cache is empty', async () => {
    // Simulate previously stored token
    mockStorage.set('proxyTokens', { 'pre-existing-token': { sessionId: 's-old', spaceId: 'sp-old' } });

    // Create a fresh container (cache is null)
    const freshCtx = {
      storage: {
        get: vi.fn(async (key: string) => mockStorage.get(key) ?? undefined),
        put: vi.fn(async (key: string, value: unknown) => { mockStorage.set(key, value); }),
      },
    };
    const freshContainer = new TakosRuntimeContainer(freshCtx as any, {
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: '',
    } as any);

    const info = await freshContainer.verifyProxyToken('pre-existing-token');
    expect(info).toEqual({ sessionId: 's-old', spaceId: 'sp-old' });
  });

  it('returns null when storage is empty and token is unknown', async () => {
    // Storage has no proxyTokens key
    const freshCtx = {
      storage: {
        get: vi.fn(async () => undefined),
        put: vi.fn(),
      },
    };
    const freshContainer = new TakosRuntimeContainer(freshCtx as any, {
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: '',
    } as any);

    const info = await freshContainer.verifyProxyToken('nonexistent');
    expect(info).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildRuntimeForwardRequest
// ---------------------------------------------------------------------------

describe('buildRuntimeForwardRequest', () => {
  function makeStub(overrides: Partial<Record<string, any>> = {}): any {
    return {
      generateSessionProxyToken: vi.fn().mockResolvedValue('generated-token'),
      ...overrides,
    };
  }

  function makeEnv(): any {
    return {
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: 'https://proxy.workers.dev',
    };
  }

  it('strips existing proxy token headers from forwarded request', async () => {
    const stub = makeStub();
    const request = new Request('https://runtime-host/health', {
      headers: {
        [RUNTIME_PROXY_TOKEN_HEADER]: 'should-be-removed',
        'X-Other': 'keep',
      },
    });

    const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
    expect(forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER)).toBeNull();
    expect(forwarded.headers.get('X-Other')).toBe('keep');
  });

  it('injects proxy token for POST /sessions with session_id and space_id', async () => {
    const stub = makeStub();
    const request = new Request('https://runtime-host/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'sess-1', space_id: 'sp-1' }),
    });

    const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
    expect(forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER)).toBe('generated-token');
    expect(stub.generateSessionProxyToken).toHaveBeenCalledWith('sess-1', 'sp-1');
  });

  it('does not inject token for GET /sessions', async () => {
    const stub = makeStub();
    const request = new Request('https://runtime-host/sessions', { method: 'GET' });

    const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
    expect(forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER)).toBeNull();
    expect(stub.generateSessionProxyToken).not.toHaveBeenCalled();
  });

  it('does not inject token for POST /sessions without session_id', async () => {
    const stub = makeStub();
    const request = new Request('https://runtime-host/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ space_id: 'sp-1' }),
    });

    const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
    expect(forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER)).toBeNull();
  });

  it('does not inject token for POST /sessions without space_id', async () => {
    const stub = makeStub();
    const request = new Request('https://runtime-host/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'sess-1' }),
    });

    const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
    expect(forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER)).toBeNull();
  });

  it('handles non-JSON body gracefully for POST /sessions', async () => {
    const stub = makeStub();
    const request = new Request('https://runtime-host/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    // Should not throw, just log warning
    const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
    expect(forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER)).toBeNull();
    expect(stub.generateSessionProxyToken).not.toHaveBeenCalled();
  });

  it('does not inject token for POST to other paths', async () => {
    const stub = makeStub();
    const request = new Request('https://runtime-host/repos/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'sess-1', space_id: 'sp-1' }),
    });

    const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
    expect(forwarded.headers.get(RUNTIME_PROXY_TOKEN_HEADER)).toBeNull();
    expect(stub.generateSessionProxyToken).not.toHaveBeenCalled();
  });

  it('preserves original URL and method', async () => {
    const stub = makeStub();
    const request = new Request('https://runtime-host/health?check=1', { method: 'GET' });

    const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
    expect(forwarded.url).toBe('https://runtime-host/health?check=1');
    expect(forwarded.method).toBe('GET');
  });

  it('passes body through for non-GET/HEAD methods', async () => {
    const stub = makeStub();
    const request = new Request('https://runtime-host/repos/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'initial commit' }),
    });

    const forwarded = await buildRuntimeForwardRequest(request, makeEnv(), stub);
    const body = await forwarded.json();
    expect(body).toEqual({ message: 'initial commit' });
  });
});

// ---------------------------------------------------------------------------
// Worker fetch handler — error paths
// ---------------------------------------------------------------------------

describe('runtime-host worker fetch error paths', () => {
  it('returns 401 when /forward/ request has no Authorization header', async () => {
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({
          verifyProxyToken: vi.fn(),
        }),
      },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: '',
    } as unknown as any;

    const res = await runtimeHost.fetch(
      new Request('https://runtime-host/forward/cli-proxy/api/test'),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when /forward/ request has invalid token', async () => {
    const verifyProxyToken = vi.fn().mockResolvedValue(null);
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({ verifyProxyToken }),
      },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: '',
    } as unknown as any;

    const res = await runtimeHost.fetch(
      new Request('https://runtime-host/forward/cli-proxy/api/test', {
        headers: { Authorization: 'Bearer bad-token' },
      }),
      env,
    );
    expect(res.status).toBe(401);
    expect(verifyProxyToken).toHaveBeenCalledWith('bad-token');
  });

  it('returns 500 when TAKOS_WEB is not configured for /forward/ requests', async () => {
    const verifyProxyToken = vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      spaceId: 'sp-1',
    });
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({ verifyProxyToken }),
      },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: '',
      // No TAKOS_WEB
    } as unknown as any;

    const res = await runtimeHost.fetch(
      new Request('https://runtime-host/forward/cli-proxy/api/test', {
        headers: {
          Authorization: 'Bearer valid-token',
          'X-Takos-Session-Id': 'sess-1',
        },
      }),
      env,
    );
    expect(res.status).toBe(500);
    const data = await res.json() as any;
    expect(data.error).toBe('Internal configuration error');
  });

  it('returns 404 for unknown /forward/ sub-paths', async () => {
    const verifyProxyToken = vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      spaceId: 'sp-1',
    });
    const takosWebFetch = vi.fn();
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({ verifyProxyToken }),
      },
      TAKOS_WEB: { fetch: takosWebFetch },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: '',
    } as unknown as any;

    const res = await runtimeHost.fetch(
      new Request('https://runtime-host/forward/unknown-path', {
        headers: { Authorization: 'Bearer valid-token' },
      }),
      env,
    );
    expect(res.status).toBe(404);
    expect(takosWebFetch).not.toHaveBeenCalled();
  });

  it('returns 401 when /forward/cli-proxy lacks X-Takos-Session-Id header', async () => {
    const verifyProxyToken = vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      spaceId: 'sp-1',
    });
    const takosWebFetch = vi.fn();
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({ verifyProxyToken }),
      },
      TAKOS_WEB: { fetch: takosWebFetch },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: '',
    } as unknown as any;

    const res = await runtimeHost.fetch(
      new Request('https://runtime-host/forward/cli-proxy/api/repos/r1/status', {
        headers: { Authorization: 'Bearer valid-token' },
        // Missing X-Takos-Session-Id
      }),
      env,
    );
    expect(res.status).toBe(401);
    expect(takosWebFetch).not.toHaveBeenCalled();
  });

  it('correctly strips /forward/cli-proxy from the path when proxying', async () => {
    const takosWebFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const verifyProxyToken = vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      spaceId: 'sp-1',
    });
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({ verifyProxyToken }),
      },
      TAKOS_WEB: { fetch: takosWebFetch },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: '',
    } as unknown as any;

    await runtimeHost.fetch(
      new Request('https://runtime-host/forward/cli-proxy/api/repos/r1/tree?ref=main', {
        headers: {
          Authorization: 'Bearer valid-token',
          'X-Takos-Session-Id': 'sess-1',
        },
      }),
      env,
    );

    const proxiedRequest = takosWebFetch.mock.calls[0]?.[0] as Request;
    expect(proxiedRequest.url).toBe('https://takos-web/api/repos/r1/tree?ref=main');
  });

  it('proxies heartbeat with correct URL format', async () => {
    const takosWebFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const verifyProxyToken = vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      spaceId: 'sp-1',
    });
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({ verifyProxyToken }),
      },
      TAKOS_WEB: { fetch: takosWebFetch },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: '',
    } as unknown as any;

    await runtimeHost.fetch(
      new Request('https://runtime-host/forward/heartbeat/my-session-id', {
        method: 'POST',
        headers: { Authorization: 'Bearer valid-token' },
      }),
      env,
    );

    const proxiedRequest = takosWebFetch.mock.calls[0]?.[0] as Request;
    expect(proxiedRequest.url).toBe('https://takos-web/api/sessions/my-session-id/heartbeat');
    expect(proxiedRequest.method).toBe('POST');
    expect(proxiedRequest.headers.get('X-Takos-Internal')).toBe('1');
    expect(proxiedRequest.headers.get('X-Takos-Session-Id')).toBe('my-session-id');
    expect(proxiedRequest.headers.get('X-Takos-Space-Id')).toBe('sp-1');
  });

  it('returns 500 when container fetch throws', async () => {
    const stubFetch = vi.fn().mockRejectedValue(new Error('container crashed'));
    const env = {
      RUNTIME_CONTAINER: {
        getByName: vi.fn().mockReturnValue({
          fetch: stubFetch,
          generateSessionProxyToken: vi.fn(),
          verifyProxyToken: vi.fn(),
        }),
      },
      ADMIN_DOMAIN: 'test.takos.jp',
      PROXY_BASE_URL: '',
    } as unknown as any;

    const res = await runtimeHost.fetch(
      new Request('https://runtime-host/api/runtime/ping'),
      env,
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('container crashed');
  });
});
