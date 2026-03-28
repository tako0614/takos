import { createLocalExecutionContext } from './execution-context.ts';
import type {
  CreateSessionPayload,
  LocalBrowserGatewayStub,
  LocalFetch,
  LocalRuntimeGatewayStub,
} from './runtime-types.ts';
import type { DurableNamespaceBinding } from '../shared/types/bindings.ts';
import { jsonResponse } from './runtime-http.ts';
import { getErrorMessage } from '@takos/common/errors';

function getLocalRuntimeGatewayStub(env: { RUNTIME_CONTAINER: unknown }): LocalRuntimeGatewayStub {
  const namespace = env.RUNTIME_CONTAINER as DurableNamespaceBinding;
  if (typeof namespace.getByName === 'function') {
    return namespace.getByName('singleton') as unknown as LocalRuntimeGatewayStub;
  }
  return namespace.get(namespace.idFromName('singleton')) as unknown as LocalRuntimeGatewayStub;
}

async function buildLocalRuntimeHostRequest(
  request: Request,
  stub: LocalRuntimeGatewayStub,
): Promise<Request> {
  const bodyText = request.method === 'GET' || request.method === 'HEAD'
    ? null
    : await request.text();
  const headers = new Headers(request.headers);

  if (new URL(request.url).pathname === '/sessions' && request.method === 'POST' && bodyText) {
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      if (typeof parsed.session_id === 'string' && typeof parsed.space_id === 'string') {
        const token = crypto.randomUUID().replace(/-/g, '');
        await stub.verifyProxyToken(token).catch(() => null);
        headers.set('X-Takos-Proxy-Token', token);
      }
    } catch {
      // Ignore malformed session payloads and forward as-is.
    }
  }

  return new Request(request.url, {
    method: request.method,
    headers,
    body: bodyText,
    redirect: request.redirect,
  });
}

export async function buildLocalRuntimeHostFetch(
  env: { RUNTIME_CONTAINER: unknown },
): Promise<LocalFetch> {
  const stub = getLocalRuntimeGatewayStub(env);
  return async (request, _executionContext = createLocalExecutionContext()) => {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ status: 'ok', service: 'takos-runtime-host' });
    }
    return stub.fetch(await buildLocalRuntimeHostRequest(request, stub));
  };
}

function getLocalBrowserGatewayStub(
  env: { BROWSER_CONTAINER: unknown },
  sessionId: string,
): LocalBrowserGatewayStub {
  const namespace = env.BROWSER_CONTAINER as DurableNamespaceBinding;
  return namespace.get(namespace.idFromName(sessionId)) as unknown as LocalBrowserGatewayStub;
}

function browserForwardPath(pathname: string): { sessionId: string; containerPath: string } | null {
  const patterns: Array<[RegExp, string]> = [
    [/^\/session\/([^/]+)\/goto$/, '/internal/goto'],
    [/^\/session\/([^/]+)\/action$/, '/internal/action'],
    [/^\/session\/([^/]+)\/extract$/, '/internal/extract'],
    [/^\/session\/([^/]+)\/html$/, '/internal/html'],
    [/^\/session\/([^/]+)\/screenshot$/, '/internal/screenshot'],
    [/^\/session\/([^/]+)\/pdf$/, '/internal/pdf'],
    [/^\/session\/([^/]+)\/tabs$/, '/internal/tabs'],
    [/^\/session\/([^/]+)\/tab\/new$/, '/internal/tab/new'],
  ];
  for (const [pattern, containerPath] of patterns) {
    const match = pathname.match(pattern);
    if (match) {
      return { sessionId: match[1], containerPath };
    }
  }
  return null;
}

export async function buildLocalBrowserHostFetch(
  env: { BROWSER_CONTAINER: unknown },
): Promise<LocalFetch> {
  return async (request, _executionContext = createLocalExecutionContext()) => {
    const url = new URL(request.url);

    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ status: 'ok', service: 'takos-browser-host' });
    }

    if (url.pathname === '/create' && request.method === 'POST') {
      const payload = await request.json().catch(() => null) as CreateSessionPayload | null;
      if (!payload?.sessionId || !payload.spaceId || !payload.userId) {
        return jsonResponse({ error: 'Missing required fields: sessionId, spaceId, userId' }, 400);
      }
      try {
        const stub = getLocalBrowserGatewayStub(env, payload.sessionId);
        return jsonResponse(await stub.createSession(payload), 201);
      } catch (err) {
        return jsonResponse({ error: getErrorMessage(err, 'Unknown error') }, 500);
      }
    }

    const sessionMatch = url.pathname.match(/^\/session\/([^/]+)$/);
    if (sessionMatch && request.method === 'GET') {
      const stub = getLocalBrowserGatewayStub(env, sessionMatch[1]);
      const state = await stub.getSessionState();
      if (!state) {
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      return jsonResponse(state);
    }

    if (sessionMatch && request.method === 'DELETE') {
      try {
        const stub = getLocalBrowserGatewayStub(env, sessionMatch[1]);
        await stub.destroySession();
        return jsonResponse({ ok: true, message: `Session ${sessionMatch[1]} destroyed` });
      } catch (err) {
        return jsonResponse({ error: getErrorMessage(err, 'Unknown error') }, 500);
      }
    }

    const forward = browserForwardPath(url.pathname);
    if (forward) {
      try {
        const stub = getLocalBrowserGatewayStub(env, forward.sessionId);
        const init: RequestInit = {
          method: request.method,
          headers: request.headers,
        };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          init.body = await request.text();
        }
        const response = await stub.forwardToContainer(forward.containerPath, init);
        return new Response(response.body, { status: response.status, headers: response.headers });
      } catch (err) {
        return jsonResponse({ error: getErrorMessage(err, 'Unknown error') }, 500);
      }
    }

    return new Response('Not found', { status: 404 });
  };
}
