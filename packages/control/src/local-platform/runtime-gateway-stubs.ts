import type {
  AgentExecutorControlConfig,
  AgentExecutorDispatchPayload,
  LocalExecutorGatewayStub,
  LocalRuntimeGatewayStub,
  ProxyTokenInfo,
} from "./runtime-types.ts";
import { DEFAULT_LOCAL_PORTS } from "./runtime-types.ts";
import {
  buildServiceRequest,
  forwardRequestToBase,
  jsonResponse,
} from "./runtime-http.ts";

export function createLocalRuntimeGatewayStub(
  runtimeServiceUrl: string | null = null,
): LocalRuntimeGatewayStub {
  const tokens = new Map<string, { sessionId: string; spaceId: string }>();

  return {
    async verifyProxyToken(token: string) {
      return tokens.get(token) ?? null;
    },
    async revokeSessionProxyTokens(sessionId: string) {
      let revoked = 0;
      for (const [token, info] of tokens) {
        if (info.sessionId === sessionId) {
          tokens.delete(token);
          revoked++;
        }
      }
      return revoked;
    },
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.pathname === "/container/health") {
        if (runtimeServiceUrl) {
          return forwardRequestToBase(runtimeServiceUrl, request, "/health");
        }
        return new Response("ok", { status: 200 });
      }

      if (url.pathname === "/sessions" && request.method === "POST") {
        const token = request.headers.get("X-Takos-Proxy-Token");
        const payload = await request.clone().json().catch(() => null);
        if (token && payload && typeof payload === "object") {
          const body = payload as Record<string, unknown>;
          if (
            typeof body.session_id === "string" &&
            typeof body.space_id === "string"
          ) {
            tokens.set(token, {
              sessionId: body.session_id,
              spaceId: body.space_id,
            });
          }
        }
        if (runtimeServiceUrl) {
          return forwardRequestToBase(runtimeServiceUrl, request);
        }
        return jsonResponse({ ok: true, started: true }, 201);
      }

      if (url.pathname === "/session/destroy" && request.method === "POST") {
        const payload = await request.clone().json().catch(() => null);
        if (payload && typeof payload === "object") {
          const sessionId = (payload as Record<string, unknown>).session_id;
          if (typeof sessionId === "string") {
            for (const [token, info] of tokens) {
              if (info.sessionId === sessionId) {
                tokens.delete(token);
              }
            }
          }
        }
        if (runtimeServiceUrl) {
          return forwardRequestToBase(runtimeServiceUrl, request);
        }
        return jsonResponse({ ok: true, destroyed: true });
      }

      if (runtimeServiceUrl) {
        return forwardRequestToBase(runtimeServiceUrl, request);
      }

      return jsonResponse({ ok: true, path: url.pathname });
    },
  };
}

export function createLocalExecutorGatewayStub(
  executorServiceUrl: string | null = null,
): LocalExecutorGatewayStub {
  const tokens = new Map<string, ProxyTokenInfo>();

  return {
    async dispatchStart(body: AgentExecutorDispatchPayload) {
      const serviceId = body.serviceId || body.workerId;
      const controlToken = crypto.randomUUID().replace(/-/g, "");
      const controlConfig: AgentExecutorControlConfig = {
        controlRpcBaseUrl: Deno.env.get("CONTROL_RPC_BASE_URL") ??
          `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.executorHost}`,
        controlRpcToken: controlToken,
      };
      tokens.set(controlToken, {
        runId: body.runId,
        serviceId,
        capability: "control",
      });

      if (executorServiceUrl) {
        const response = await globalThis.fetch(
          buildServiceRequest(executorServiceUrl, "/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...body,
              serviceId,
              workerId: body.workerId || serviceId,
              ...controlConfig,
            }),
          }),
        );
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
