/**
 * Tests for browser-session-host: Worker fetch handler routes and
 * BrowserSessionContainer class methods.
 *
 * The Worker is a Hono app that delegates to a BrowserSessionContainer
 * Durable Object. We test the routing layer (via app.fetch) and the
 * DO class methods independently.
 */
// [Deno] vi.mock removed - manually stub imports from '@/container-hosts/executor-proxy-config'
// [Deno] vi.mock removed - manually stub imports from '@/utils/hash'
import browserSessionHost, { BrowserSessionContainer } from '@/container-hosts/browser-session-host';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { assertEquals, assertNotEquals, assert, assertRejects, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

function makeMockStorage(): any {
  const store = new Map<string, unknown>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
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
    fetch: (async () => new Response('{"ok":true}', {
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
    getTcpPort: (() => tcpPortFetcher),
  };

  return { container, ctx, tcpPortFetcher };
}

function makeMockDOStub(overrides: Partial<Record<string, any>> = {}): any {
  return {
    createSession: (async () => ({ ok: true, proxyToken: 'tok-123' })),
    getSessionState: (async () => ({
      sessionId: 'sess-1',
      spaceId: 'space-1',
      userId: 'user-1',
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
    })),
    destroySession: (async () => undefined),
    forwardToContainer: (async () => new Response('{"result":"ok"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),),
    verifyProxyToken: (async () => null),
    ...overrides,
  };
}

function makeBrowserHostEnv(stubOverrides: Partial<Record<string, any>> = {}): any {
  const stub = makeMockDOStub(stubOverrides);
  return {
    BROWSER_CONTAINER: {
      idFromName: (() => ({ toString: () => 'do-id' })),
      get: (() => stub),
    },
    _stub: stub,
  };
}

// ---------------------------------------------------------------------------
// BrowserSessionContainer class methods
// ---------------------------------------------------------------------------


  
    Deno.test('BrowserSessionContainer - createSession - generates a proxy token and starts the container', async () => {
  const { container, ctx, tcpPortFetcher } = createContainerInstance();

      const result = await container.createSession({
        sessionId: 'sess-1',
        spaceId: 'space-1',
        userId: 'user-1',
        url: 'https://example.com',
      });

      assertEquals(result.ok, true);
      assertEquals(result.proxyToken, 'mock-proxy-token-abc123');
      // Token persisted to storage
      assertSpyCallArgs(ctx.storage.put, 0, ['proxyTokens', /* expect.any(Object) */ {} as any]);
})
    Deno.test('BrowserSessionContainer - createSession - sets session state to active after bootstrap', async () => {
  const { container } = createContainerInstance();

      await container.createSession({
        sessionId: 'sess-1',
        spaceId: 'space-1',
        userId: 'user-1',
      });

      const state = await container.getSessionState();
      assertNotEquals(state, null);
      assertEquals(state!.status, 'active');
      assertEquals(state!.sessionId, 'sess-1');
})
    Deno.test('BrowserSessionContainer - createSession - throws when bootstrap fails', async () => {
  const { container, tcpPortFetcher } = createContainerInstance();
      tcpPortFetcher.fetch = (async () => new Response('container failed', { status: 500 }),) as any;

      await await assertRejects(async () => { await 
        container.createSession({
          sessionId: 'sess-1',
          spaceId: 'space-1',
          userId: 'user-1',
        }),
      ; }, 'Browser bootstrap failed');
})  
  
    Deno.test('BrowserSessionContainer - verifyProxyToken - returns token info for a valid cached token', async () => {
  const { container } = createContainerInstance();
      await container.createSession({
        sessionId: 'sess-1',
        spaceId: 'space-1',
        userId: 'user-1',
      });

      const info = await container.verifyProxyToken('mock-proxy-token-abc123');
      assertNotEquals(info, null);
      assertEquals(info!.sessionId, 'sess-1');
      assertEquals(info!.userId, 'user-1');
})
    Deno.test('BrowserSessionContainer - verifyProxyToken - returns null for an invalid token', async () => {
  const { container } = createContainerInstance();
      await container.createSession({
        sessionId: 'sess-1',
        spaceId: 'space-1',
        userId: 'user-1',
      });

      const info = await container.verifyProxyToken('wrong-token');
      assertEquals(info, null);
})
    Deno.test('BrowserSessionContainer - verifyProxyToken - loads tokens from storage when cache is empty', async () => {
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
      assertNotEquals(info, null);
      assertEquals(info!.sessionId, 'sess-old');
})
    Deno.test('BrowserSessionContainer - verifyProxyToken - returns null when no tokens exist in storage', async () => {
  const { container } = createContainerInstance();
      (container as any).cachedTokens = null;

      const info = await container.verifyProxyToken('any-token');
      assertEquals(info, null);
})  
  
    Deno.test('BrowserSessionContainer - getSessionState - returns null when no session has been created', async () => {
  const { container } = createContainerInstance();
      const state = await container.getSessionState();
      assertEquals(state, null);
})  
  
    Deno.test('BrowserSessionContainer - destroySession - marks session as stopped and clears tokens', async () => {
  const { container, ctx } = createContainerInstance();

      await container.createSession({
        sessionId: 'sess-1',
        spaceId: 'space-1',
        userId: 'user-1',
      });

      await container.destroySession();

      const state = await container.getSessionState();
      assertNotEquals(state, null);
      assertEquals(state!.status, 'stopped');
      assertSpyCallArgs(ctx.storage.delete, 0, ['proxyTokens']);
})
    Deno.test('BrowserSessionContainer - destroySession - handles destroy when no session exists', async () => {
  const { container, ctx } = createContainerInstance();

      // Should not throw
      await container.destroySession();
      assertSpyCallArgs(ctx.storage.delete, 0, ['proxyTokens']);
})  
  
    Deno.test('BrowserSessionContainer - forwardToContainer - forwards a request to the internal TCP port', async () => {
  const { container, tcpPortFetcher } = createContainerInstance();
      tcpPortFetcher.fetch = (async () => new Response('{"page":"loaded"}', { status: 200 }),) as any;

      const res = await container.forwardToContainer('/internal/goto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com' }),
      });

      assertEquals(res.status, 200);
      assertSpyCallArgs(tcpPortFetcher.fetch, 0, [
        'http://internal/internal/goto',
        /* expect.any(Request) */ {} as any,
      ]);
})  
// ---------------------------------------------------------------------------
// Worker fetch handler routes
// ---------------------------------------------------------------------------


  
    Deno.test('browser-session-host Worker routes - GET /health - returns 200 with service info', async () => {
  const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/health', { method: 'GET' }),
        env,
      );
      assertEquals(res.status, 200);
      const body = await res.json() as any;
      assertEquals(body.status, 'ok');
      assertEquals(body.service, 'takos-browser-host');
})  
  
    Deno.test('browser-session-host Worker routes - POST /create - creates a session with valid payload', async () => {
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
      assertEquals(res.status, 201);
      const body = await res.json() as any;
      assertEquals(body.ok, true);
      assertEquals(body.proxyToken, 'tok-123');
})
    Deno.test('browser-session-host Worker routes - POST /create - returns 400 when sessionId is missing', async () => {
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
      assertEquals(res.status, 400);
      const body = await res.json() as any;
      assertStringIncludes(body.error, 'Missing required fields');
})
    Deno.test('browser-session-host Worker routes - POST /create - returns 400 when spaceId is missing', async () => {
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
      assertEquals(res.status, 400);
})
    Deno.test('browser-session-host Worker routes - POST /create - returns 400 when userId is missing', async () => {
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
      assertEquals(res.status, 400);
})
    Deno.test('browser-session-host Worker routes - POST /create - returns 500 when createSession throws', async () => {
  const env = makeBrowserHostEnv({
        createSession: (async () => { throw new Error('Container start failed'); }),
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
      assertEquals(res.status, 500);
      const body = await res.json() as any;
      assertEquals(body.error, 'Container start failed');
})  
  
    Deno.test('browser-session-host Worker routes - GET /session/:id - returns session state when session exists', async () => {
  const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1', { method: 'GET' }),
        env,
      );
      assertEquals(res.status, 200);
      const body = await res.json() as any;
      assertEquals(body.sessionId, 'sess-1');
      assertEquals(body.status, 'active');
})
    Deno.test('browser-session-host Worker routes - GET /session/:id - returns 404 when session does not exist', async () => {
  const env = makeBrowserHostEnv({
        getSessionState: (async () => null),
      });
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/nonexistent', { method: 'GET' }),
        env,
      );
      assertEquals(res.status, 404);
      const body = await res.json() as any;
      assertStringIncludes(body.error, 'Session not found');
})  
  
    Deno.test('browser-session-host Worker routes - POST /session/:id/goto - forwards goto request to container', async () => {
  const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/goto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com/page' }),
        }),
        env,
      );
      assertEquals(res.status, 200);
      assertSpyCallArgs(env._stub.forwardToContainer, 0, [
        '/internal/goto',
        ({ method: 'POST' }),
      ]);
})
    Deno.test('browser-session-host Worker routes - POST /session/:id/goto - returns 500 when forward fails', async () => {
  const env = makeBrowserHostEnv({
        forwardToContainer: (async () => { throw new Error('Connection lost'); }),
      });
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/goto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com' }),
        }),
        env,
      );
      assertEquals(res.status, 500);
      const body = await res.json() as any;
      assertEquals(body.error, 'Connection lost');
})  
  
    Deno.test('browser-session-host Worker routes - POST /session/:id/action - forwards action request to container', async () => {
  const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'click', selector: '#btn' }),
        }),
        env,
      );
      assertEquals(res.status, 200);
      assertSpyCallArgs(env._stub.forwardToContainer, 0, [
        '/internal/action',
        ({ method: 'POST' }),
      ]);
})  
  
    Deno.test('browser-session-host Worker routes - POST /session/:id/extract - forwards extract request to container', async () => {
  const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selector: '.content' }),
        }),
        env,
      );
      assertEquals(res.status, 200);
      assertSpyCallArgs(env._stub.forwardToContainer, 0, [
        '/internal/extract',
        ({ method: 'POST' }),
      ]);
})  
  
    Deno.test('browser-session-host Worker routes - GET /session/:id/html - forwards html request to container', async () => {
  const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/html', { method: 'GET' }),
        env,
      );
      assertEquals(res.status, 200);
      assertSpyCallArgs(env._stub.forwardToContainer, 0, ['/internal/html']);
})  
  
    Deno.test('browser-session-host Worker routes - GET /session/:id/screenshot - forwards screenshot request to container', async () => {
  const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/screenshot', { method: 'GET' }),
        env,
      );
      assertEquals(res.status, 200);
      assertSpyCallArgs(env._stub.forwardToContainer, 0, ['/internal/screenshot']);
})
    Deno.test('browser-session-host Worker routes - GET /session/:id/screenshot - returns 500 when screenshot forward fails', async () => {
  const env = makeBrowserHostEnv({
        forwardToContainer: (async () => { throw new Error('Browser crashed'); }),
      });
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/screenshot', { method: 'GET' }),
        env,
      );
      assertEquals(res.status, 500);
      const body = await res.json() as any;
      assertEquals(body.error, 'Browser crashed');
})  
  
    Deno.test('browser-session-host Worker routes - POST /session/:id/pdf - forwards pdf request to container', async () => {
  const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
        env,
      );
      assertEquals(res.status, 200);
      assertSpyCallArgs(env._stub.forwardToContainer, 0, [
        '/internal/pdf',
        ({ method: 'POST' }),
      ]);
})  
  
    Deno.test('browser-session-host Worker routes - GET /session/:id/tabs - forwards tabs request to container', async () => {
  const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/tabs', { method: 'GET' }),
        env,
      );
      assertEquals(res.status, 200);
      assertSpyCallArgs(env._stub.forwardToContainer, 0, ['/internal/tabs']);
})  
  
    Deno.test('browser-session-host Worker routes - POST /session/:id/tab/new - forwards new tab request to container', async () => {
  const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1/tab/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com' }),
        }),
        env,
      );
      assertEquals(res.status, 200);
      assertSpyCallArgs(env._stub.forwardToContainer, 0, [
        '/internal/tab/new',
        ({ method: 'POST' }),
      ]);
})  
  
    Deno.test('browser-session-host Worker routes - DELETE /session/:id - destroys the session and returns success', async () => {
  const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1', { method: 'DELETE' }),
        env,
      );
      assertEquals(res.status, 200);
      const body = await res.json() as any;
      assertEquals(body.ok, true);
      assertStringIncludes(body.message, 'destroyed');
      assert(env._stub.destroySession.calls.length > 0);
})
    Deno.test('browser-session-host Worker routes - DELETE /session/:id - returns 500 when destroy fails', async () => {
  const env = makeBrowserHostEnv({
        destroySession: (async () => { throw new Error('Cleanup failed'); }),
      });
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/session/sess-1', { method: 'DELETE' }),
        env,
      );
      assertEquals(res.status, 500);
      const body = await res.json() as any;
      assertEquals(body.error, 'Cleanup failed');
})  
  
    Deno.test('browser-session-host Worker routes - unknown routes - returns 404 for unmatched routes', async () => {
  const env = makeBrowserHostEnv();
      const res = await browserSessionHost.fetch(
        new Request('http://localhost/nonexistent', { method: 'GET' }),
        env,
      );
      assertEquals(res.status, 404);
})  