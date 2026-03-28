/**
 * takos-browser-host Worker
 *
 * Hosts BrowserSessionContainer (CF Containers DO sidecar) and forwards
 * browser operations from the main worker to the container.
 *
 * Architecture:
 *   takos (main) → POST /create → this worker → container.createSession(...)
 *   takos (main) → POST /session/:id/goto → this worker → container forward → browserd
 *   takos (main) → GET  /session/:id/screenshot → this worker → container forward → browserd
 */

import {
  HostContainerInternals,
  HostContainerRuntime,
} from './container-runtime.ts';
import type { DurableObjectNamespace, R2Bucket } from '../../shared/types/bindings.ts';
import { Hono } from 'hono';
import { generateProxyToken } from './executor-proxy-config';
import { constantTimeEqual } from '../../shared/utils/hash';
import type {
  BrowserSessionTokenInfo,
  CreateSessionPayload,
  BrowserSessionState,
} from './browser-session-types';
import { getErrorMessage } from 'takos-common/errors';

// ---------------------------------------------------------------------------
// Environment types
// ---------------------------------------------------------------------------

interface BrowserHostEnv {
  BROWSER_CONTAINER: DurableObjectNamespace<BrowserSessionContainer>;
  BROWSER_CHECKPOINTS?: R2Bucket;
  TAKOS_EGRESS?: { fetch(request: Request): Promise<Response> };
}

type Env = BrowserHostEnv;

// ---------------------------------------------------------------------------
// Container TCP port fetcher type (internal CF Containers API)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Durable Object — BrowserSessionContainer
// ---------------------------------------------------------------------------

export class BrowserSessionContainer extends HostContainerRuntime<Env> {
  defaultPort = 8080;
  sleepAfter = '15m';
  pingEndpoint = 'internal/healthz';

  private cachedTokens: Map<string, BrowserSessionTokenInfo> | null = null;
  private sessionState: BrowserSessionState | null = null;

  /**
   * Create a browser session: generate token, start container, bootstrap browser.
   */
  async createSession(payload: CreateSessionPayload): Promise<{ ok: true; proxyToken: string }> {
    const proxyToken = generateProxyToken();
    const tokenInfo: BrowserSessionTokenInfo = {
      sessionId: payload.sessionId,
      spaceId: payload.spaceId,
      userId: payload.userId,
    };

    // Persist token in DO storage + in-memory cache
    const tokenMap: Record<string, BrowserSessionTokenInfo> = {
      [proxyToken]: tokenInfo,
    };
    await this.ctx.storage.put('proxyTokens', tokenMap);
    this.cachedTokens = new Map(Object.entries(tokenMap));

    this.sessionState = {
      sessionId: payload.sessionId,
      spaceId: payload.spaceId,
      userId: payload.userId,
      status: 'starting',
      createdAt: new Date().toISOString(),
    };

    // Start container and wait for port 8080
    await this.startAndWaitForPorts([8080]);

    // Bootstrap the browser in the container
    const tcpPort = (this as unknown as HostContainerInternals).container.getTcpPort(8080);
    const bootstrapResponse = await tcpPort.fetch(
      'http://internal/internal/bootstrap',
      new Request('http://internal/internal/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: payload.url,
          viewport: payload.viewport,
        }),
      })
    );

    if (!bootstrapResponse.ok) {
      const errorText = await bootstrapResponse.text();
      throw new Error(`Browser bootstrap failed: ${errorText}`);
    }

    this.sessionState.status = 'active';
    return { ok: true, proxyToken };
  }

  /** RPC: verify a proxy token via constant-time comparison. */
  async verifyProxyToken(token: string): Promise<BrowserSessionTokenInfo | null> {
    if (!this.cachedTokens) {
      const stored = await this.ctx.storage.get<Record<string, BrowserSessionTokenInfo>>('proxyTokens');
      if (!stored) return null;
      this.cachedTokens = new Map(Object.entries(stored));
    }
    for (const [storedToken, info] of this.cachedTokens) {
      if (constantTimeEqual(token, storedToken)) return info;
    }
    return null;
  }

  /** RPC: get current session state. */
  async getSessionState(): Promise<BrowserSessionState | null> {
    return this.sessionState;
  }

  /** RPC: destroy session — stop container and clear state. */
  async destroySession(): Promise<void> {
    if (this.sessionState) {
      this.sessionState.status = 'stopped';
    }
    this.cachedTokens = null;
    await this.ctx.storage.delete('proxyTokens');
    await this.destroy();
  }

  /**
   * Forward a request to the container's internal API.
   * Called from the Worker fetch handler.
   */
  async forwardToContainer(path: string, init?: RequestInit): Promise<Response> {
    this.renewActivityTimeout();
    const tcpPort = (this as unknown as HostContainerInternals).container.getTcpPort(8080);
    const request = new Request(`http://internal${path}`, init);
    return tcpPort.fetch(request.url, request);
  }
}

// ---------------------------------------------------------------------------
// Worker fetch handler
// ---------------------------------------------------------------------------

const app = new Hono<{ Bindings: Env }>();

function getDOStub(env: Env, sessionId: string): DurableObjectStub & BrowserSessionContainer {
  const id = env.BROWSER_CONTAINER.idFromName(sessionId);
  return env.BROWSER_CONTAINER.get(id) as unknown as DurableObjectStub & BrowserSessionContainer;
}

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'takos-browser-host' }, 200);
});

// Create session
app.post('/create', async (c) => {
  const payload = await c.req.json<CreateSessionPayload>();
  if (!payload.sessionId || !payload.spaceId || !payload.userId) {
    return c.json({ error: 'Missing required fields: sessionId, spaceId, userId' }, 400);
  }

  try {
    const stub = getDOStub(c.env, payload.sessionId);
    const result = await stub.createSession(payload);
    return c.json(result, 201);
  } catch (err) {
    return c.json({ error: getErrorMessage(err, 'Unknown error') }, 500);
  }
});

// Get session info
app.get('/session/:id', async (c) => {
  const sessionId = c.req.param('id');
  const stub = getDOStub(c.env, sessionId);
  const state = await stub.getSessionState();
  if (!state) {
    return c.json({ error: 'Session not found' }, 404);
  }
  return c.json(state);
});

// Forward routes — all delegate to container via DO

// Goto
app.post('/session/:id/goto', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json();
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer('/internal/goto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, 'Unknown error') }, 500);
  }
});

// Action
app.post('/session/:id/action', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json();
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer('/internal/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, 'Unknown error') }, 500);
  }
});

// Extract
app.post('/session/:id/extract', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json();
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer('/internal/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, 'Unknown error') }, 500);
  }
});

// HTML
app.get('/session/:id/html', async (c) => {
  const sessionId = c.req.param('id');
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer('/internal/html');
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, 'Unknown error') }, 500);
  }
});

// Screenshot
app.get('/session/:id/screenshot', async (c) => {
  const sessionId = c.req.param('id');
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer('/internal/screenshot');
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, 'Unknown error') }, 500);
  }
});

// PDF
app.post('/session/:id/pdf', async (c) => {
  const sessionId = c.req.param('id');
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer('/internal/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, 'Unknown error') }, 500);
  }
});

// Tabs
app.get('/session/:id/tabs', async (c) => {
  const sessionId = c.req.param('id');
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer('/internal/tabs');
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, 'Unknown error') }, 500);
  }
});

// New tab
app.post('/session/:id/tab/new', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json();
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer('/internal/tab/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, 'Unknown error') }, 500);
  }
});

// Close tab
app.post('/session/:id/tab/close', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json();
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer('/internal/tab/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, 'Unknown error') }, 500);
  }
});

// Switch tab
app.post('/session/:id/tab/switch', async (c) => {
  const sessionId = c.req.param('id');
  const body = await c.req.json();
  const stub = getDOStub(c.env, sessionId);
  try {
    const response = await stub.forwardToContainer('/internal/tab/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, 'Unknown error') }, 500);
  }
});

// Destroy session
app.delete('/session/:id', async (c) => {
  const sessionId = c.req.param('id');
  const stub = getDOStub(c.env, sessionId);
  try {
    await stub.destroySession();
    return c.json({ ok: true, message: 'Session destroyed' });
  } catch (err) {
    return c.json({ error: getErrorMessage(err, 'Unknown error') }, 500);
  }
});

export default {
  fetch: app.fetch,
};
