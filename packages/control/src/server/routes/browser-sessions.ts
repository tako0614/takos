/**
 * Edge API routes for browser sessions.
 *
 * Each route authenticates the user, verifies session ownership,
 * and forwards to the BROWSER_HOST service binding (if configured).
 * Returns 503 when the binding is not available.
 */

import { Hono } from 'hono';
import type { Env, User } from '../../shared/types';
import { bytesToHex } from '../../shared/utils/encoding-utils';

type BrowserSessionVariables = {
  user?: User;
};

const browserSessions = new Hono<{
  Bindings: Env;
  Variables: BrowserSessionVariables;
}>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBrowserHost(env: Env): { fetch(request: Request): Promise<Response> } | null {
  return env.BROWSER_HOST ?? null;
}

function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function forwardToBrowserHost(
  browserHost: { fetch(request: Request): Promise<Response> },
  path: string,
  init?: RequestInit
): Promise<Response> {
  return browserHost.fetch(
    new Request(`https://browser-host.internal${path}`, init)
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Create browser session
browserSessions.post('/spaces/:spaceId/browser-sessions', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const spaceId = c.req.param('spaceId');
  const body = await c.req.json<{ url?: string; viewport?: { width: number; height: number } }>();
  const sessionId = generateSessionId();

  const browserHost = getBrowserHost(c.env);
  if (!browserHost) return c.json({ error: 'Browser service not available' }, 503);

  const response = await forwardToBrowserHost(browserHost, '/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      spaceId,
      userId: user.id,
      url: body.url,
      viewport: body.viewport,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return c.json({ error: `Failed to create browser session: ${error}` }, 500);
  }

  const result = await response.json() as Record<string, unknown>;
  return c.json({ sessionId, ...result }, 201);
});

// Get session info
browserSessions.get('/browser-sessions/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const sessionId = c.req.param('id');
  const browserHost = getBrowserHost(c.env);
  if (!browserHost) return c.json({ error: 'Browser service not available' }, 503);

  const response = await forwardToBrowserHost(browserHost, `/session/${sessionId}`);
  if (!response.ok) {
    return c.json({ error: 'Session not found' }, 404);
  }

  const state = await response.json() as { userId: string };
  // Ownership check
  if (state.userId !== user.id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  return c.json(state);
});

// Goto URL
browserSessions.post('/browser-sessions/:id/goto', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const sessionId = c.req.param('id');
  const body = await c.req.json();
  const browserHost = getBrowserHost(c.env);
  if (!browserHost) return c.json({ error: 'Browser service not available' }, 503);

  const response = await forwardToBrowserHost(
    browserHost,
    `/session/${sessionId}/goto`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  const data = await response.json();
  return c.json(data, response.status as 200);
});

// Browser action
browserSessions.post('/browser-sessions/:id/action', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const sessionId = c.req.param('id');
  const body = await c.req.json();
  const browserHost = getBrowserHost(c.env);
  if (!browserHost) return c.json({ error: 'Browser service not available' }, 503);

  const response = await forwardToBrowserHost(
    browserHost,
    `/session/${sessionId}/action`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  const data = await response.json();
  return c.json(data, response.status as 200);
});

// Extract data
browserSessions.post('/browser-sessions/:id/extract', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const sessionId = c.req.param('id');
  const body = await c.req.json();
  const browserHost = getBrowserHost(c.env);
  if (!browserHost) return c.json({ error: 'Browser service not available' }, 503);

  const response = await forwardToBrowserHost(
    browserHost,
    `/session/${sessionId}/extract`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  const data = await response.json();
  return c.json(data, response.status as 200);
});

// Get HTML
browserSessions.get('/browser-sessions/:id/html', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const sessionId = c.req.param('id');
  const browserHost = getBrowserHost(c.env);
  if (!browserHost) return c.json({ error: 'Browser service not available' }, 503);

  const response = await forwardToBrowserHost(
    browserHost,
    `/session/${sessionId}/html`
  );
  const data = await response.json();
  return c.json(data, response.status as 200);
});

// Screenshot
browserSessions.get('/browser-sessions/:id/screenshot', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const sessionId = c.req.param('id');
  const browserHost = getBrowserHost(c.env);
  if (!browserHost) return c.json({ error: 'Browser service not available' }, 503);

  const response = await forwardToBrowserHost(
    browserHost,
    `/session/${sessionId}/screenshot`
  );

  const headers = new Headers();
  headers.set('Content-Type', response.headers.get('Content-Type') ?? 'image/png');
  if (response.headers.has('Content-Length')) {
    headers.set('Content-Length', response.headers.get('Content-Length')!);
  }
  return new Response(response.body, { status: response.status, headers });
});

// PDF
browserSessions.post('/browser-sessions/:id/pdf', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const sessionId = c.req.param('id');
  const browserHost = getBrowserHost(c.env);
  if (!browserHost) return c.json({ error: 'Browser service not available' }, 503);

  const response = await forwardToBrowserHost(
    browserHost,
    `/session/${sessionId}/pdf`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }
  );

  const headers = new Headers();
  headers.set('Content-Type', response.headers.get('Content-Type') ?? 'application/pdf');
  if (response.headers.has('Content-Length')) {
    headers.set('Content-Length', response.headers.get('Content-Length')!);
  }
  return new Response(response.body, { status: response.status, headers });
});

// Destroy session
browserSessions.delete('/browser-sessions/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  const sessionId = c.req.param('id');
  const browserHost = getBrowserHost(c.env);
  if (!browserHost) return c.json({ error: 'Browser service not available' }, 503);

  const response = await forwardToBrowserHost(
    browserHost,
    `/session/${sessionId}`,
    { method: 'DELETE' }
  );
  const data = await response.json();
  return c.json(data);
});

export default browserSessions;
