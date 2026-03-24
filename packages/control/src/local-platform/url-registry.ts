import type { ServiceBindingFetcher } from '../shared/types/bindings.ts';

export type ServiceTargetMap = Record<string, string>;

function normalizeBaseUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  if (!url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}/`;
  }
  return url;
}

export function parseServiceTargetMap(raw: string | undefined): ServiceTargetMap {
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('TAKOS_LOCAL_DISPATCH_TARGETS_JSON must be a JSON object');
  }

  const out: ServiceTargetMap = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' && value) {
      out[name] = value;
    }
  }
  return out;
}

export function createForwardingFetcher(baseUrl: string): ServiceBindingFetcher {
  const base = normalizeBaseUrl(baseUrl);
  const fetcher = {
    async fetch(input: string | Request, init?: RequestInit): Promise<Response> {
      const request = input instanceof Request ? input : new Request(input, init);
      const incomingUrl = new URL(request.url);
      const targetUrl = new URL(incomingUrl.pathname.replace(/^\//, ''), base);
      targetUrl.search = incomingUrl.search;

      return fetch(new Request(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: request.redirect,
      }));
    },
    connect(): never {
      throw new Error('connect() is not supported by the local URL registry');
    },
  };

  return fetcher as unknown as ServiceBindingFetcher;
}

export function createFetcherRegistry(
  targets: ServiceTargetMap,
  fallback?: (name: string) => ServiceBindingFetcher,
): { get(name: string): ServiceBindingFetcher } {
  return {
    get(name: string): ServiceBindingFetcher {
      const target = targets[name];
      if (target) return createForwardingFetcher(target);
      if (fallback) return fallback(name);
      return {
        async fetch(): Promise<Response> {
          return Response.json({
            error: 'Local service target not configured',
            worker: name,
          }, { status: 503 });
        },
        connect(): never {
          throw new Error(`No local service target configured for ${name}`);
        },
      } as unknown as ServiceBindingFetcher;
    },
  };
}
