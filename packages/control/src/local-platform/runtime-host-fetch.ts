import { createLocalExecutionContext } from "./execution-context.ts";
import type {
  LocalBinding,
  LocalFetch,
  LocalRuntimeGatewayStub,
} from "./runtime-types.ts";
import type { DurableNamespaceBinding } from "../shared/types/bindings.ts";
import { jsonResponse, readBearerToken } from "./runtime-http.ts";

type LocalRuntimeHostEnv = {
  RUNTIME_CONTAINER: DurableNamespaceBinding<LocalRuntimeGatewayStub>;
  TAKOS_WEB?: LocalBinding;
};

function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function getLocalRuntimeGatewayStub(
  env: LocalRuntimeHostEnv,
): LocalRuntimeGatewayStub {
  const namespace = env.RUNTIME_CONTAINER;
  if (typeof namespace.getByName === "function") {
    return namespace.getByName("singleton");
  }
  return namespace.get(namespace.idFromName("singleton"));
}

async function buildLocalRuntimeHostRequest(
  request: Request,
  stub: LocalRuntimeGatewayStub,
): Promise<Request> {
  const bodyText = request.method === "GET" || request.method === "HEAD"
    ? null
    : await request.text();
  const headers = new Headers(request.headers);

  if (
    new URL(request.url).pathname === "/sessions" &&
    request.method === "POST" && bodyText
  ) {
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      if (
        typeof parsed.session_id === "string" &&
        typeof parsed.space_id === "string"
      ) {
        const token = crypto.randomUUID().replace(/-/g, "");
        await stub.verifyProxyToken(token).catch(() => null);
        headers.set("X-Takos-Proxy-Token", token);
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

function buildCliProxyWebRequest(
  request: Request,
  url: URL,
  spaceId: string,
  sessionId: string,
): Request {
  const apiPath = url.pathname.replace("/forward/cli-proxy", "");
  return new Request(`http://takos${apiPath}${url.search}`, {
    method: request.method,
    headers: {
      "X-Takos-Internal-Marker": "1",
      "X-Takos-Session-Id": sessionId,
      "X-Takos-Space-Id": spaceId,
      "Content-Type": request.headers.get("Content-Type") ||
        "application/json",
    },
    body: request.body,
    redirect: request.redirect,
  });
}

async function handleLocalRuntimeForward(
  request: Request,
  env: LocalRuntimeHostEnv,
  stub: LocalRuntimeGatewayStub,
  url: URL,
): Promise<Response | null> {
  if (!url.pathname.startsWith("/forward/")) return null;

  const token = readBearerToken(request.headers.get("Authorization"));
  if (!token) {
    return errorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }

  const tokenInfo = await stub.verifyProxyToken(token);
  if (!tokenInfo) {
    return errorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }

  if (url.pathname.startsWith("/forward/cli-proxy/")) {
    const sessionId = request.headers.get("X-Takos-Session-Id");
    if (!sessionId) {
      return errorResponse("UNAUTHORIZED", "Unauthorized", 401);
    }
    if (tokenInfo.sessionId !== sessionId) {
      return errorResponse("UNAUTHORIZED", "Unauthorized", 401);
    }
    if (!env.TAKOS_WEB) {
      return errorResponse(
        "INTERNAL_ERROR",
        "Internal configuration error",
        500,
      );
    }
    return await env.TAKOS_WEB.fetch(
      buildCliProxyWebRequest(request, url, tokenInfo.spaceId, sessionId),
    );
  }

  if (url.pathname.startsWith("/forward/heartbeat/")) {
    const sessionId = url.pathname.replace("/forward/heartbeat/", "");
    if (!sessionId || tokenInfo.sessionId !== sessionId) {
      return errorResponse("UNAUTHORIZED", "Unauthorized", 401);
    }
    if (!env.TAKOS_WEB) {
      return errorResponse(
        "INTERNAL_ERROR",
        "Internal configuration error",
        500,
      );
    }
    return await env.TAKOS_WEB.fetch(
      new Request(`http://takos/api/sessions/${sessionId}/heartbeat`, {
        method: "POST",
        headers: {
          "X-Takos-Internal-Marker": "1",
          "X-Takos-Session-Id": sessionId,
          "X-Takos-Space-Id": tokenInfo.spaceId,
          "Content-Type": "application/json",
        },
      }),
    );
  }

  return errorResponse("NOT_FOUND", "Not found", 404);
}

export async function buildLocalRuntimeHostFetch(
  env: LocalRuntimeHostEnv,
): Promise<LocalFetch> {
  const stub = getLocalRuntimeGatewayStub(env);
  return async (request, _executionContext = createLocalExecutionContext()) => {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ status: "ok", service: "takos-runtime-host" });
    }
    const forwardResponse = await handleLocalRuntimeForward(
      request,
      env,
      stub,
      url,
    );
    if (forwardResponse) return forwardResponse;
    return stub.fetch(await buildLocalRuntimeHostRequest(request, stub));
  };
}
