/**
 * Tests for browser-session-host: Worker fetch handler routes and
 * BrowserSessionContainer class methods.
 *
 * The Worker is a Hono app that delegates to a BrowserSessionContainer
 * Durable Object. We test the routing layer (via app.fetch) and the
 * DO class methods independently.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@takos/control-hosts/container-runtime', () => {
  const MockContainer = class {
    ctx: any;
    env: any;
    defaultPort = 8080;
    sleepAfter = '15m';
    pingEndpoint = 'internal/healthz';
    constructor(ctx: any, env: any) {
      this.ctx = ctx;
      this.env = env;
    }
    async startAndWaitForPorts(_ports: number[]): Promise<void> {}
    async destroy(): Promise<void> {}
    renewActivityTimeout(): void {}
  };
  return {
    Container: MockContainer,
    HostContainerRuntime: MockContainer,
  };
});

vi.mock('@/container-hosts/executor-proxy-config', () => ({
  generateProxyToken: vi.fn(() => 'mock-proxy-token-abc123'),
}));

vi.mock('@/utils/hash', () => ({
  constantTimeEqual: vi.fn((a: string, b: string) => a === b),
}));

import browserSessionHost, { BrowserSessionContainer } from '@/container-hosts/browser-session-host';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockStorage(): any {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    _store: store,
  };
}

function makeMockCtx(): any {
  return {
    storage: makeMockStorage(),
    id: { toString: () => 'do-id-abc' },
  };
}

function makeMockTcpPortFetcher(): any {
  return {
    fetch: vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })),
  };
}

function createContainerInstance(): {
  container: BrowserSessionContainer;
  ctx: any;
  tcpPortFetcher: any;
} {
  const ctx = makeMockCtx();
  const env = { BROWSER_CONTAINER: {} } as any;
  const container = new BrowserSessionContainer(ctx, env);

  // Wire up the internal container TCP port mock
  const tcpPortFetcher = makeMockTcpPortFetcher();
  (container as any).container = {
    getTcpPort: vi.fn().mockReturnValue(tcpPortFetcher),
  };

  return { container, ctx, tcpPortFetcher };
}

function makeMockDOStub(overrides: Partial<Record<string, any>> = {}): any {
  return {
    createSession: vi.fn().mockResolvedValue({ ok: true, proxyToken: 'tok-123' }),
    getSessionState: vi.fn().mockResolvedValue({
      sessionId: 'sess-1',
      spaceId: 'space-1',
      userId: 'user-1',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
    }),
    destroySession: vi.fn().mockResolvedValue(undefined),
    forwardToContainer: vi.fn().mockResolvedValue(
      new Response('{"result":"ok"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
    verifyProxyToken: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeBrowserHostEnv(stubOverrides: Partial<Record<string, any>> = {}): any {
  const stub = makeMockDOStub(stubOverrides);
  return {
    BROWSER_CONTAINER: {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'do-id' }),
      get: vi.fn().mockReturnValue(stub),
    },
    _stub: stub,
  };
}

// ---------------------------------------------------------------------------
// BrowserSessionContainer class methods
// ---------------------------------------------------------------------------

describe('BrowserSessionContainer', () => {
  describe('createSession', () => {
    it('generates a proxy token and starts the container', async () => {
      const { container, ctx, tcpPortFetcher } = createContainerInstance();

      const result = await container.createSession({
        sessionId: 'sess-1',
        spaceId: 'space-1',
        userId: 'user-1',
        url: 'https://example.com',
      });

      expect(result.ok).toBe(true);
      expect(result.proxyToken).toBe('mock-proxy-token-abc123');
      // Token persisted to storage
      expect(ctx.storage.put).toHaveBeenCalledWith('proxyTokens', expect.any(Object));
    });

    it('sets session state to active after bootstrap', async () => {
      const { container } = createContainerInstance();

      await container.createSession({
        sessionId: 'sess-1',
        spaceId: 'space-1',
        userId: 'user-1',
      });

      const state = await container.getSessionState();
      expect(state).not.toBeNull();
      expect(state!.status).toBe('active');
      expect(state!.sessionId).toBe('sess-1');
    });

    it('throws when bootstrap fails', async () => {
      const { container, tcpPortFetcher } = createContainerInstance();
      tcpPortFetcher.fetch.mockResolvedValue(
        new Response('container failed', { status: 500 }),
      );

      await expect(
        container.createSession({
          sessionId: 'sess-1',
          spaceId: 'space-1',
          userId: 'user-1',
        }),
      ).rejects.toThrow('Browser bootstrap failed');
    });
  });

  describe('verifyProxyToken', () => {
    it('returns token info for a valid cached token', async () => {
      const { container } = createContainerInstance();
      await container.createSession({
        sessionId: 'sess-1',
        spaceId: 'space-1',
        userId: 'user-1',
      });

      const info = await container.verifyProxyToken('mock-proxy-token-abc123');
      expect(info).not.toBeNull();
      expect(info!.sessionId).toBe('sess-1');
      expect(info!.userId).toBe('user-1');
    });

    it('returns null for an invalid token', async () => {
      const { container } = createContainerInstance();
      await container.createSession({
        sessionId: 'sess-1',
        spaceId: 'space-1',
        userId: 'user-1',
      });

      const info = await container.verifyProxyToken('wrong-token');
      expect(info).toBeNull();
    });

    it('loads tokens from storage when cache is empty', async () => {
      const { container, ctx } = createContainerInstance();

      // Simulate a previous session that stored tokens
      ctx.storage._store.set('proxyTokens', {
        'stored-token-xyz': {
          sessionId: 'sess-old',
          spaceId: 'space-old',
          userId: 'user-old',
        },
      });

      // Clear cached tokens by setting internal state
      (container as any).cachedTokens = null;

      const info = await container.verifyProxyToken('stored-token-xyz');
      expect(info).not.toBeNull();
      expect(info!.sessionId).toBe('sess-old');
    });

    it('returns null when no tokens exist in storage', async () => {
      const { container } = createContainerInstance();
      (container as any).cachedTokens = null;

      const info = await container.verifyProxyToken('any-token');
      expect(info).toBeNull();
    });
  });

  describe('getSessionState', () => {
    it('returns null when no session has been created', async () => {
      const { container } = createContainerInstance();
      const state = await container.getSessionState();
      expect(state).toBeNull();
    });
  });

  describe('destroySession', () => {
    it('marks session as stopped and clears tokens', async () => {
      const { container, ctx } = createContainerInstance();

      await container.createSession({
        sessionId: 'sess-1',
        spaceId: 'space-1',
        userId: 'user-1',
      });

      await container.destroySession();

      const state = await container.getSessionState();
      expect(state).not.toBeNull();
      expect(state!.status).toBe('stopped');
      expect(ctx.storage.delete).toHaveBeenCalledWith('proxyTokens');
    });

    it('handles destroy when no session exists', async () => {
      const { container, ctx } = createContainerInstance();

      // Should not throw
      await container.destroySession();
      expect(ctx.storage.delete).toHaveBeenCalledWith('proxyTokens');
    });
  });

  describe('forwardToContainer', () => {
    it('forwards a request to the internal TCP port', async () => {
      const { container, tcpPortFetcher } = createContainerInstance();
      tcpPortFetcher.fetch.mockResolvedValue(
        new Response('{"page":"loaded"}', { status: 200 }),
      );

      const res = await container.forwardToContainer('/internal/goto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });

      expect(res.status).toBe(200);
      expect(tcpPortFetcher.fetch).toHaveBeenCalledWith(
        'http://internal/internal/goto',
        expect.any(Request),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Worker fetch handler routes
// ---------------------------------------------------------------------------

describe('browser-session-host Worker routes', () => {
  describe('GET /health', () => {
    it('returns 200 with service info', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/health', { method: 'GET' }),
        env,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.status).toBe('ok');
      expect(body.service).toBe('takos-browser-host');
    });
  });

  describe('POST /create', () => {
    it('creates a session with valid payload', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'sess-1',
            spaceId: 'space-1',
            userId: 'user-1',
            url: 'https://example.com',
          }),
        }),
        env,
      );
      expect(res.status).toBe(201);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(body.proxyToken).toBe('tok-123');
    });

    it('returns 400 when sessionId is missing', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spaceId: 'space-1',
            userId: 'user-1',
          }),
        }),
        env,
      );
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.error).toContain('Missing required fields');
    });

    it('returns 400 when spaceId is missing', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'sess-1',
            userId: 'user-1',
          }),
        }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when userId is missing', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'sess-1',
            spaceId: 'space-1',
          }),
        }),
        env,
      );
      expect(res.status).toBe(400);
    });

    it('returns 500 when createSession throws', async () => {
      const env = makeBrowserHostEnv({
        createSession: vi.fn().mockRejectedValue(new Error('Container start failed')),
      });
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'sess-1',
            spaceId: 'space-1',
            userId: 'user-1',
          }),
        }),
        env,
      );
      expect(res.status).toBe(500);
      const body = await res.json() as any;
      expect(body.error).toBe('Container start failed');
    });
  });

  describe('GET /session/:id', () => {
    it('returns session state when session exists', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1', { method: 'GET' }),
        env,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.sessionId).toBe('sess-1');
      expect(body.status).toBe('active');
    });

    it('returns 404 when session does not exist', async () => {
      const env = makeBrowserHostEnv({
        getSessionState: vi.fn().mockResolvedValue(null),
      });
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/nonexistent', { method: 'GET' }),
        env,
      );
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toContain('Session not found');
    });
  });

  describe('POST /session/:id/goto', () => {
    it('forwards goto request to container', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/goto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/page' }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      expect(env._stub.forwardToContainer).toHaveBeenCalledWith(
        '/internal/goto',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('returns 500 when forward fails', async () => {
      const env = makeBrowserHostEnv({
        forwardToContainer: vi.fn().mockRejectedValue(new Error('Connection lost')),
      });
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/goto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com' }),
        }),
        env,
      );
      expect(res.status).toBe(500);
      const body = await res.json() as any;
      expect(body.error).toBe('Connection lost');
    });
  });

  describe('POST /session/:id/action', () => {
    it('forwards action request to container', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'click', selector: '#btn' }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      expect(env._stub.forwardToContainer).toHaveBeenCalledWith(
        '/internal/action',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('POST /session/:id/extract', () => {
    it('forwards extract request to container', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selector: '.content' }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      expect(env._stub.forwardToContainer).toHaveBeenCalledWith(
        '/internal/extract',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('GET /session/:id/html', () => {
    it('forwards html request to container', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/html', { method: 'GET' }),
        env,
      );
      expect(res.status).toBe(200);
      expect(env._stub.forwardToContainer).toHaveBeenCalledWith('/internal/html');
    });
  });

  describe('GET /session/:id/screenshot', () => {
    it('forwards screenshot request to container', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/screenshot', { method: 'GET' }),
        env,
      );
      expect(res.status).toBe(200);
      expect(env._stub.forwardToContainer).toHaveBeenCalledWith('/internal/screenshot');
    });

    it('returns 500 when screenshot forward fails', async () => {
      const env = makeBrowserHostEnv({
        forwardToContainer: vi.fn().mockRejectedValue(new Error('Browser crashed')),
      });
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/screenshot', { method: 'GET' }),
        env,
      );
      expect(res.status).toBe(500);
      const body = await res.json() as any;
      expect(body.error).toBe('Browser crashed');
    });
  });

  describe('POST /session/:id/pdf', () => {
    it('forwards pdf request to container', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
        env,
      );
      expect(res.status).toBe(200);
      expect(env._stub.forwardToContainer).toHaveBeenCalledWith(
        '/internal/pdf',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('GET /session/:id/tabs', () => {
    it('forwards tabs request to container', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/tabs', { method: 'GET' }),
        env,
      );
      expect(res.status).toBe(200);
      expect(env._stub.forwardToContainer).toHaveBeenCalledWith('/internal/tabs');
    });
  });

  describe('POST /session/:id/tab/new', () => {
    it('forwards new tab request to container', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/tab/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com' }),
        }),
        env,
      );
      expect(res.status).toBe(200);
      expect(env._stub.forwardToContainer).toHaveBeenCalledWith(
        '/internal/tab/new',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('DELETE /session/:id', () => {
    it('destroys the session and returns success', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1', { method: 'DELETE' }),
        env,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(body.message).toContain('destroyed');
      expect(env._stub.destroySession).toHaveBeenCalled();
    });

    it('returns 500 when destroy fails', async () => {
      const env = makeBrowserHostEnv({
        destroySession: vi.fn().mockRejectedValue(new Error('Cleanup failed')),
      });
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1', { method: 'DELETE' }),
        env,
      );
      expect(res.status).toBe(500);
      const body = await res.json() as any;
      expect(body.error).toBe('Cleanup failed');
    });
  });

  describe('unknown routes', () => {
    it('returns 404 for unmatched routes', async () => {
      const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/nonexistent', { method: 'GET' }),
        env,
      );
      expect(res.status).toBe(404);
    });
  });
});
