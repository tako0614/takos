import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { PROXY_BASE_URL } from '../../shared/config.js';
import { isValidSessionId } from '../../runtime/validation.js';
import { sessionStore } from '../sessions/storage.js';
import { badRequest, internalError, forbidden } from '@takos/common/middleware/hono';

const app = new Hono();

const ALLOWED_PATHS = [
  /^\/api\/repos\/[^/]+\/import$/,
  /^\/api\/repos\/[^/]+\/export$/,
  /^\/api\/repos\/[^/]+\/status$/,
  /^\/api\/repos\/[^/]+\/log$/,
  /^\/api\/repos\/[^/]+\/commit$/,
];

function getProxyPathAndQuery(c: import('hono').Context): { apiPath: string; apiQuery: string } {
  // In Hono, c.req.path gives us the path matched by the route.
  // c.req.url gives the full URL. We need to extract the proxy target.
  const url = new URL(c.req.url);
  const fullPath = url.pathname;
  const rawProxyTarget = fullPath.startsWith('/cli-proxy')
    ? fullPath.slice('/cli-proxy'.length)
    : fullPath;
  const [apiPath, ...queryParts] = rawProxyTarget.split('?');
  return {
    apiPath: apiPath ?? '',
    apiQuery: queryParts.join('?') || url.search.slice(1),
  };
}

app.all('/cli-proxy/*', async (c) => {
  try {
    const sessionId = c.req.header('X-Takos-Session-Id');
    if (!sessionId) {
      return badRequest(c, 'Missing X-Takos-Session-Id header');
    }
    if (!isValidSessionId(sessionId)) {
      return badRequest(c, 'Invalid X-Takos-Session-Id');
    }

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      return forbidden(c, 'Session not found');
    }
    const spaceId = c.req.header('X-Takos-Space-Id');
    if (spaceId && session.spaceId !== spaceId) {
      return forbidden(c, 'Session does not belong to workspace');
    }
    session.lastAccessedAt = Date.now();

    const { apiPath, apiQuery } = getProxyPathAndQuery(c);
    if (!apiPath) {
      return badRequest(c, 'API path required');
    }
    if (apiPath.includes('..') || apiPath.includes('//')) {
      return badRequest(c, 'Invalid API path');
    }

    if (!ALLOWED_PATHS.some(pattern => pattern.test(apiPath))) {
      return forbidden(c, `Path not allowed: ${apiPath}`);
    }

    const proxyToken = session.proxyToken;
    if (!PROXY_BASE_URL || !proxyToken) {
      return internalError(c, 'PROXY_BASE_URL or proxy token not configured');
    }

    const headers: Record<string, string> = {
      'Content-Type': c.req.header('content-type') || 'application/json',
      'X-Takos-Session-Id': sessionId,
      'Authorization': `Bearer ${proxyToken}`,
    };

    const fetchOptions: RequestInit = {
      method: c.req.method,
      headers,
    };

    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const body = await c.req.json();
      fetchOptions.body = JSON.stringify(body);
    }

    const baseUrl = PROXY_BASE_URL.endsWith('/') ? PROXY_BASE_URL.slice(0, -1) : PROXY_BASE_URL;
    const targetUrl = new URL(`/forward/cli-proxy${apiPath}`, baseUrl);
    if (apiQuery) {
      targetUrl.search = `?${apiQuery}`;
    }
    const response = await fetch(targetUrl.toString(), fetchOptions);
    const text = await response.text();
    try {
      const data = JSON.parse(text);
      return c.json(data, response.status as ContentfulStatusCode);
    } catch {
      return c.text(text, response.status as ContentfulStatusCode);
    }
  } catch (err) {
    c.get('log')?.error('CLI proxy error', { error: err });
    return internalError(c, 'Failed to proxy request');
  }
});

export default app;
