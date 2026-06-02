import { createLocalExecutionContext } from "./execution-context.ts";
import type {
  LocalFetch,
  LocalRuntimeGatewayStub,
} from "./runtime-types.ts";
import type { DurableNamespaceBinding } from "../shared/types/bindings.ts";
import { jsonResponse } from "./runtime-http.ts";

type LocalRuntimeHostEnv = {
  RUNTIME_CONTAINER: DurableNamespaceBinding<LocalRuntimeGatewayStub>;
};

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

export async function buildLocalRuntimeHostFetch(
  env: LocalRuntimeHostEnv,
): Promise<LocalFetch> {
  const stub = getLocalRuntimeGatewayStub(env);
  return async (request, _executionContext = createLocalExecutionContext()) => {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ status: "ok", service: "takos-runtime-host" });
    }
    return stub.fetch(await buildLocalRuntimeHostRequest(request));
  };
}
