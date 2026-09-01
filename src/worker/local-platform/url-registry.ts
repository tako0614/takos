import type { ServiceBindingFetcher } from "../shared/types/bindings.ts";

export type ServiceTargetMap = Record<string, string>;

const SERVICE_TARGET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function normalizeBaseUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch (error) {
    throw new Error("Service target must be an absolute HTTP(S) URL", {
      cause: error,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Service target must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Service target URL must not contain credentials");
  }
  if (url.search || url.hash) {
    throw new Error("Service target URL must not contain query or fragment state");
  }
  if (!url.pathname.endsWith("/")) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

function normalizeServiceTargetMap(
  input: Record<string, unknown>,
): ServiceTargetMap {
  const out: ServiceTargetMap = Object.create(null) as ServiceTargetMap;
  for (const [name, value] of Object.entries(input)) {
    if (!SERVICE_TARGET_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid service target name: ${name}`);
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Service target ${name} must be a non-empty URL string`);
    }
    out[name] = normalizeBaseUrl(value.trim()).toString();
  }
  return out;
}

export function parseServiceTargetMap(
  raw: string | undefined,
): ServiceTargetMap {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TAKOS_LOCAL_DISPATCH_TARGETS_JSON must be a JSON object");
  }

  return normalizeServiceTargetMap(parsed as Record<string, unknown>);
}

export function createForwardingFetcher(
  baseUrl: string,
): ServiceBindingFetcher {
  const base = normalizeBaseUrl(baseUrl);
  const fetcher: ServiceBindingFetcher = {
    async fetch(
      input: string | Request,
      init?: RequestInit,
    ): Promise<Response> {
      const request = input instanceof Request
        ? input
        : new Request(input, init);
      const incomingUrl = new URL(request.url);
      const targetUrl = new URL(incomingUrl.pathname.replace(/^\//, ""), base);
      targetUrl.search = incomingUrl.search;

      return fetch(
        new Request(targetUrl, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          redirect: request.redirect,
        }),
      );
    },
  };

  return fetcher;
}

export function createFetcherRegistry(
  targets: ServiceTargetMap,
  fallback?: (name: string) => ServiceBindingFetcher,
): { get(name: string): ServiceBindingFetcher } {
  const normalizedTargets = normalizeServiceTargetMap(targets);
  return {
    get(name: string): ServiceBindingFetcher {
      const target = normalizedTargets[name];
      if (target) return createForwardingFetcher(target);
      if (fallback) return fallback(name);
      const missingTargetFetcher: ServiceBindingFetcher = {
        async fetch(): Promise<Response> {
          return Response.json({
            error: "Local service target not configured",
            worker: name,
          }, { status: 503 });
        },
      };
      return missingTargetFetcher;
    },
  };
}
