import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
import { getWebApp } from "takos-worker/core/web";
import { buildWorkersWebPlatform } from "takos-worker/platform/adapters/workers";
import type { ControlPlatform } from "takos-worker/platform";
import type {
  Env as ControlEnv,
  PlatformExecutionContext,
} from "takos-worker/shared/types";
import type { ApiBindings } from "../shared/api/bindings.ts";

type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
  };
};

type ForwardOptions = {
  env?: ApiBindings;
  executionCtx?: PlatformExecutionContext;
  rewriteLocation?: (location: string, requestPathname: string) => string;
};

type ControlRequestEnv = ControlEnv & {
  PLATFORM?: ControlPlatform<ControlEnv>;
};

const controlWebApp = getWebApp();

export async function forwardInProcessControlRequest(
  request: Request,
  targetPath: string,
  options: ForwardOptions = {},
): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (!canUseInProcessControl(options.env)) {
    return Response.json(
      commonError(
        "INTERNAL_ERROR",
        "in-process control routes require the takos-worker DB binding",
      ),
      { status: 500 },
    );
  }

  const target = new URL("http://internal/");
  target.pathname = targetPath;
  target.search = requestUrl.search;

  const forwardedRequest = new Request(target, {
    method: request.method,
    headers: proxyRequestHeaders(request.headers),
    body: await proxyRequestBody(request),
    redirect: "manual",
  });
  const response = await controlWebApp.fetch(
    forwardedRequest,
    controlRequestEnv(options.env),
    options.executionCtx,
  );

  return proxyResponse(response, requestUrl.pathname, options);
}

export async function forwardInProcessControlJsonRequest(
  targetPath: string,
  init: {
    env?: ApiBindings;
    executionCtx?: PlatformExecutionContext;
    headers?: HeadersInit;
    body?: BodyInit | null;
    method?: string;
  } = {},
): Promise<Response> {
  if (!canUseInProcessControl(init.env)) {
    return Response.json(
      commonError(
        "INTERNAL_ERROR",
        "in-process control routes require the takos-worker DB binding",
      ),
      { status: 500 },
    );
  }

  const target = new URL("http://internal/");
  target.pathname = targetPath;
  target.search = "";
  const response = await controlWebApp.fetch(
    new Request(target, {
      method: init.method ?? "POST",
      headers: init.headers,
      body: init.body,
      redirect: "manual",
    }),
    controlRequestEnv(init.env),
    init.executionCtx,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function commonError(code: string, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

/**
 * Resolves the in-process control backend path for an incoming request, or
 * `null` when the path is not owned by this forwarder. The same matcher backs
 * both the `matches` predicate (used by the dispatch loop) and the `forward`
 * 404 guard, so the membership decision and the rewrite live in one place.
 */
export type ControlMatchTarget = (
  pathname: string,
  method: string,
) => string | null;

export type ControlForwarder = {
  /** Stable identifier; also the registry key for the dispatch loop. */
  name: string;
  /** True when this forwarder owns the request path/method. */
  matches: (pathname: string, method: string) => boolean;
  /** Forwards to the in-process control backend (404 if no longer owned). */
  forward: (
    request: Request,
    env?: ApiBindings,
    executionCtx?: PlatformExecutionContext,
  ) => Promise<Response>;
};

/**
 * Builds one control-path forwarder from a path matcher. Every forwarder shares
 * the identical skeleton — `matches` delegating to `matchTarget`, and `forward`
 * resolving the target then either returning a `NOT_FOUND` envelope or proxying
 * the request to the in-process control web app — so only the `name` (404 label)
 * and `matchTarget` (path/method rule) vary per registry entry.
 */
export function defineControlForwarder(descriptor: {
  name: string;
  matchTarget: ControlMatchTarget;
}): ControlForwarder {
  const { name, matchTarget } = descriptor;
  return {
    name,
    matches(pathname: string, method = "GET"): boolean {
      return matchTarget(pathname, method) !== null;
    },
    async forward(
      request: Request,
      env?: ApiBindings,
      executionCtx?: PlatformExecutionContext,
    ): Promise<Response> {
      const requestUrl = new URL(request.url);
      const targetPath = matchTarget(requestUrl.pathname, request.method);
      if (!targetPath) {
        return Response.json(
          commonError("NOT_FOUND", `${name} route not found`),
          { status: 404 },
        );
      }
      return await forwardInProcessControlRequest(request, targetPath, {
        env,
        executionCtx,
      });
    },
  };
}

function controlRequestEnv(env: ApiBindings | undefined): ControlRequestEnv {
  const bindings = { ...(env ?? {}) } as ControlRequestEnv;
  bindings.TAKOS_INTERNAL_API_SECRET ??= getEnv(
    "TAKOS_INTERNAL_API_SECRET",
  );
  bindings.PLATFORM ??= buildWorkersWebPlatform(bindings);
  return bindings;
}

function canUseInProcessControl(env: ApiBindings | undefined): boolean {
  return Boolean(env && "DB" in env && env.DB);
}

function proxyRequestHeaders(source: Headers): Headers {
  const target = new Headers();
  for (const [name, value] of source) {
    const normalized = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalized)) continue;
    if (TAKOS_INTERNAL_ACTOR_HEADERS.has(normalized)) continue;
    target.set(name, value);
  }
  return target;
}

async function proxyRequestBody(
  request: Request,
): Promise<ArrayBuffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  return await request.arrayBuffer();
}

function proxyResponse(
  response: Response,
  requestPathname: string,
  options: ForwardOptions,
): Response {
  const headers = new Headers(response.headers);
  const location = headers.get("location");
  if (location && options.rewriteLocation) {
    headers.set(
      "location",
      options.rewriteLocation(location, requestPathname),
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const TAKOS_INTERNAL_ACTOR_HEADERS = new Set([
  "x-takos-account-id",
  "x-takos-roles",
  "x-takos-internal-secret",
  "x-takos-auth-proxy-secret",
  "x-takos-actor-context",
  "x-takosumi-actor-context",
]);
