/**
 * takos-runtime-host Worker
 *
 * Hosts TakosRuntimeContainer as a Cloudflare Container (Durable Object sidecar).
 * Other workers call this via RUNTIME_HOST service binding; requests are forwarded
 * transparently to the Node.js Express server running inside the container.
 *
 * Container → host communication uses DO-local random tokens (same pattern as
 * executor). The container calls /forward/* endpoints on this worker,
 * which verifies the token via DO RPC and proxies to takos-web via service binding.
 */

import {
  HostContainerRuntime,
} from './container-runtime.ts';
import { generateProxyToken } from './executor-proxy-config';
import { extractBearerToken } from '../../shared/utils';
import { constantTimeEqual } from '../../shared/utils/hash';
import { validateRuntimeHostEnv, createEnvGuard } from '../../shared/utils/validate-env';
import { logError, logWarn } from '../../shared/utils/logger';
import { jsonResponse, errorJsonResponse } from '../../shared/utils/http-response';

interface RuntimeContainerStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  generateSessionProxyToken(sessionId: string, spaceId: string): Promise<string>;
  verifyProxyToken(token: string): Promise<RuntimeProxyTokenInfo | null>;
}

interface ContainerNamespace {
  getByName(name: string): RuntimeContainerStub;
}

export const RUNTIME_PROXY_TOKEN_HEADER = 'X-Takos-Proxy-Token';

interface Env {
  RUNTIME_CONTAINER: ContainerNamespace;
  ADMIN_DOMAIN: string;
  PROXY_BASE_URL: string;
  TAKOS_WEB?: { fetch(request: Request): Promise<Response> };
  JWT_PUBLIC_KEY?: string;
}

export function buildRuntimeContainerEnv(env: Pick<Env, 'ADMIN_DOMAIN' | 'JWT_PUBLIC_KEY' | 'PROXY_BASE_URL'>): Record<string, string> {
  const containerEnv: Record<string, string> = {
    TAKOS_API_URL: `https://${env.ADMIN_DOMAIN}`,
  };

  if (env.PROXY_BASE_URL) {
    containerEnv.PROXY_BASE_URL = env.PROXY_BASE_URL;
  }

  if (env.JWT_PUBLIC_KEY) {
    containerEnv.JWT_PUBLIC_KEY = env.JWT_PUBLIC_KEY;
  }

  return containerEnv;
}

/** Token metadata stored alongside each random proxy token. */
export interface RuntimeProxyTokenInfo {
  sessionId: string;
  spaceId: string;
}

/**
 * Durable Object that manages the takos-runtime container lifecycle.
 * The Container base class automatically starts the container image on first
 * request and routes fetch() calls to the container process on defaultPort.
 */
export class TakosRuntimeContainer extends HostContainerRuntime<Env> {
  defaultPort = 8080;
  sleepAfter = '10m';
  pingEndpoint = 'container/health';

  private cachedTokens: Map<string, RuntimeProxyTokenInfo> | null = null;

  constructor(ctx: DurableObjectState<Record<string, never>>, env: Env) {
    super(ctx, env);
    this.envVars = buildRuntimeContainerEnv(env);
  }

  /** Generate a proxy token for a session and persist it in DO storage. */
  async generateSessionProxyToken(sessionId: string, spaceId: string): Promise<string> {
    const token = generateProxyToken();
    const info: RuntimeProxyTokenInfo = { sessionId, spaceId };

    // Load existing tokens
    if (!this.cachedTokens) {
      const stored = await this.ctx.storage.get<Record<string, RuntimeProxyTokenInfo>>('proxyTokens');
      this.cachedTokens = stored ? new Map(Object.entries(stored)) : new Map();
    }

    this.cachedTokens.set(token, info);
    await this.ctx.storage.put('proxyTokens', Object.fromEntries(this.cachedTokens));
    return token;
  }

  /** RPC method: called by the worker fetch handler to verify proxy tokens. */
  async verifyProxyToken(token: string): Promise<RuntimeProxyTokenInfo | null> {
    if (!this.cachedTokens) {
      const stored = await this.ctx.storage.get<Record<string, RuntimeProxyTokenInfo>>('proxyTokens');
      if (!stored) return null;
      this.cachedTokens = new Map(Object.entries(stored));
    }
    for (const [storedToken, info] of this.cachedTokens) {
      if (constantTimeEqual(token, storedToken)) return info;
    }
    return null;
  }
}

function buildProxyTokenHeader(token: string): Record<string, string> {
  return { [RUNTIME_PROXY_TOKEN_HEADER]: token };
}

export async function buildRuntimeForwardRequest(
  request: Request,
  env: Env,
  stub: RuntimeContainerStub,
): Promise<Request> {
  const url = new URL(request.url);
  const bodyText = request.method === 'GET' || request.method === 'HEAD'
    ? null
    : await request.text();
  const headers = new Headers(request.headers);
  headers.delete(RUNTIME_PROXY_TOKEN_HEADER);

  // For /sessions POST, generate a proxy token and inject it
  if (url.pathname === '/sessions' && request.method === 'POST' && bodyText) {
    try {
      const parsed: unknown = JSON.parse(bodyText);
      if (typeof parsed === 'object' && parsed !== null) {
        const body = parsed as Record<string, unknown>;
        if (typeof body.session_id === 'string' && typeof body.space_id === 'string') {
          const token = await stub.generateSessionProxyToken(body.session_id, body.space_id);
          const tokenHeaders = buildProxyTokenHeader(token);
          for (const [key, value] of Object.entries(tokenHeaders)) {
            headers.set(key, value);
          }
        }
      }
    } catch (err) {
      logWarn('Failed to parse /sessions body', { module: 'runtime-host', error: err instanceof Error ? err.message : String(err) });
    }
  }

  return new Request(request.url, {
    method: request.method,
    headers,
    body: bodyText,
  });
}

function unauthorized(): Response {
  return errorJsonResponse('Unauthorized', 401);
}

// Cached environment validation guard.
const envGuard = createEnvGuard(validateRuntimeHostEnv);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Validate environment on first request (cached).
    const envError = envGuard(env as unknown as Record<string, unknown>);
    if (envError) {
      return errorJsonResponse('Configuration Error', 503, {
        message: 'Runtime host is misconfigured. Please contact administrator.',
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/health' && request.method === 'GET') {
      return jsonResponse({ status: 'ok', service: 'takos-runtime-host' });
    }

    // /forward/* — proxy endpoints called by the runtime container
    if (path.startsWith('/forward/')) {
      const token = extractBearerToken(request.headers.get('Authorization'));
      if (!token) return unauthorized();

      // Verify token via DO RPC
      const stub = env.RUNTIME_CONTAINER.getByName('singleton');
      const tokenInfo = await stub.verifyProxyToken(token);
      if (!tokenInfo) return unauthorized();

      if (!env.TAKOS_WEB) {
        logError('TAKOS_WEB service binding not configured', undefined, { module: 'runtime-host' });
        return errorJsonResponse('Internal configuration error', 500);
      }

      // /forward/cli-proxy/* — CLI proxy requests from the container
      if (path.startsWith('/forward/cli-proxy/')) {
        const sessionId = request.headers.get('X-Takos-Session-Id');
        if (!sessionId) return unauthorized();

        const apiPath = path.replace('/forward/cli-proxy', '');
        const search = url.search;
        return env.TAKOS_WEB.fetch(new Request(`https://takos-web${apiPath}${search}`, {
          method: request.method,
          headers: {
            'X-Takos-Internal': '1',
            'X-Takos-Session-Id': sessionId,
            'X-Takos-Space-Id': tokenInfo.spaceId,
            'Content-Type': request.headers.get('Content-Type') || 'application/json',
          },
          body: request.body,
        }));
      }

      // /forward/heartbeat/:sessionId — heartbeat from the container
      if (path.startsWith('/forward/heartbeat/')) {
        const sessionId = path.replace('/forward/heartbeat/', '');
        if (!sessionId) return unauthorized();

        return env.TAKOS_WEB.fetch(new Request(`https://takos-web/api/sessions/${sessionId}/heartbeat`, {
          method: 'POST',
          headers: {
            'X-Takos-Internal': '1',
            'X-Takos-Session-Id': sessionId,
            'X-Takos-Space-Id': tokenInfo.spaceId,
            'Content-Type': 'application/json',
          },
        }));
      }

      return errorJsonResponse('Not found', 404);
    }

    // Route all other requests to the singleton runtime container instance.
    const stub = env.RUNTIME_CONTAINER.getByName('singleton');
    try {
      return await stub.fetch(await buildRuntimeForwardRequest(request, env, stub));
    } catch (err) {
      logError('container fetch failed', err, { module: 'runtime-host' });
      const message = err instanceof Error ? err.message : String(err);
      return new Response(`Failed to start container: ${message}`, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
