import type {
  AgentExecutorControlConfig,
  AgentExecutorDispatchPayload,
  BrowserSessionState,
  CreateSessionPayload,
  LocalBrowserGatewayStub,
  LocalExecutorGatewayStub,
  LocalRuntimeGatewayStub,
  ProxyTokenInfo,
} from './runtime-types.ts';
import { DEFAULT_LOCAL_PORTS } from './runtime-types.ts';
import { buildServiceRequest, forwardRequestToBase, jsonResponse } from './runtime-http.ts';

export function createLocalRuntimeGatewayStub(runtimeServiceUrl: string | null = null): LocalRuntimeGatewayStub {
  const tokens = new Map<string, { sessionId: string; spaceId: string }>();

  return {
    async verifyProxyToken(token: string) {
      return tokens.get(token) ?? null;
    },
    async fetch(request: Request) {
      const url = new URL(request.url);
      if (url.pathname === '/container/health') {
        if (runtimeServiceUrl) {
          return forwardRequestToBase(runtimeServiceUrl, request, '/health');
        }
        return new Response('ok', { status: 200 });
      }

      if (url.pathname === '/sessions' && request.method === 'POST') {
        const token = request.headers.get('X-Takos-Proxy-Token');
        const payload = await request.clone().json().catch(() => null);
        if (token && payload && typeof payload === 'object') {
          const body = payload as Record<string, unknown>;
          if (typeof body.session_id === 'string' && typeof body.space_id === 'string') {
            tokens.set(token, { sessionId: body.session_id, spaceId: body.space_id });
          }
        }
        if (runtimeServiceUrl) {
          return forwardRequestToBase(runtimeServiceUrl, request);
        }
        return jsonResponse({ ok: true, started: true }, 201);
      }

      if (runtimeServiceUrl) {
        return forwardRequestToBase(runtimeServiceUrl, request);
      }

      return jsonResponse({ ok: true, path: url.pathname });
    },
  };
}

export function createLocalExecutorGatewayStub(executorServiceUrl: string | null = null): LocalExecutorGatewayStub {
  const tokens = new Map<string, ProxyTokenInfo>();

  return {
    async dispatchStart(body: AgentExecutorDispatchPayload) {
      const serviceId = body.serviceId || body.workerId;
      const controlToken = crypto.randomUUID().replace(/-/g, '');
      const controlConfig: AgentExecutorControlConfig = {
        controlRpcBaseUrl: Deno.env.get('CONTROL_RPC_BASE_URL')
          ?? `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.executorHost}`,
        controlRpcToken: controlToken,
      };
      tokens.set(controlToken, { runId: body.runId, serviceId, capability: 'control' });

      if (executorServiceUrl) {
        const response = await globalThis.fetch(buildServiceRequest(executorServiceUrl, '/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            serviceId,
            workerId: body.workerId || serviceId,
            ...controlConfig,
          }),
        }));
        return {
          ok: response.ok,
          status: response.status,
          body: await response.text(),
        };
      }

      return {
        ok: true,
        status: 202,
        body: JSON.stringify({
          ok: true,
          local: true,
          runId: body.runId,
          serviceId,
          workerId: body.workerId || serviceId,
          ...controlConfig,
        }),
      };
    },
    async verifyProxyToken(token: string) {
      return tokens.get(token) ?? null;
    },
  };
}

export function createLocalBrowserGatewayStub(browserServiceUrl: string | null = null): LocalBrowserGatewayStub {
  const tokens = new Map<string, { sessionId: string; spaceId: string; userId: string }>();
  let state: BrowserSessionState | null = null;

  return {
    async createSession(payload: CreateSessionPayload) {
      const proxyToken = crypto.randomUUID().replace(/-/g, '');
      tokens.set(proxyToken, {
        sessionId: payload.sessionId,
        spaceId: payload.spaceId,
        userId: payload.userId,
      });
      state = {
        sessionId: payload.sessionId,
        spaceId: payload.spaceId,
        userId: payload.userId,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      if (browserServiceUrl) {
        const response = await globalThis.fetch(buildServiceRequest(browserServiceUrl, '/internal/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: payload.url,
            viewport: payload.viewport,
          }),
        }));
        if (!response.ok) {
          throw new Error(`Browser bootstrap failed: ${await response.text()}`);
        }
      }
      state = state ? { ...state, status: 'active' } : state;
      return { ok: true as const, proxyToken };
    },
    async verifyProxyToken(token: string) {
      return tokens.get(token) ?? null;
    },
    async getSessionState() {
      return state;
    },
    async destroySession() {
      state = state ? { ...state, status: 'stopped' } : null;
      tokens.clear();
    },
    async forwardToContainer(path: string, init?: RequestInit) {
      if (browserServiceUrl) {
        return globalThis.fetch(buildServiceRequest(browserServiceUrl, path, init));
      }
      const request = new Request(`http://browser.local${path}`, init);
      return this.fetch(request);
    },
    async fetch(request: Request) {
      const url = new URL(request.url);
      if (url.pathname === '/internal/healthz') {
        return new Response('ok', { status: 200 });
      }
      if (url.pathname === '/internal/bootstrap' && request.method === 'POST') {
        return jsonResponse({ ok: true, bootstrapped: true }, 200);
      }
      return jsonResponse({ ok: true, path: url.pathname });
    },
  };
}
