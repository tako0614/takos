import type { LocalBinding } from './runtime-types.ts';

export function createForwardingBinding(baseUrl: string): LocalBinding {
  return {
    fetch(request: Request) {
      return forwardRequestToBase(baseUrl, request);
    },
  };
}

export function ensureTrailingSlash(baseUrl: string): URL {
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith('/')) {
    base.pathname = `${base.pathname}/`;
  }
  return base;
}

export function buildServiceRequest(baseUrl: string, path: string, init?: RequestInit): Request {
  const base = ensureTrailingSlash(baseUrl);
  const targetUrl = new URL(path.replace(/^\//, ''), base);
  return new Request(targetUrl, init);
}

export function forwardRequestToBase(baseUrl: string, request: Request, pathOverride?: string): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const targetPath = pathOverride ?? incomingUrl.pathname;
  const nextRequest = buildServiceRequest(baseUrl, targetPath, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: request.redirect,
  });
  const targetUrl = new URL(nextRequest.url);
  targetUrl.search = incomingUrl.search;
  return globalThis.fetch(new Request(targetUrl, nextRequest));
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function readBearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function resolveServiceUrl(envVarName: string, defaultPort: number): string {
  const explicit = Deno.env.get(envVarName)?.trim();
  if (explicit) return explicit;
  return `http://127.0.0.1:${defaultPort}/`;
}

export function resolveOptionalServiceForwardUrl(envVarName: string, defaultPort: number): string | null {
  const explicit = Deno.env.get(envVarName)?.trim();
  if (explicit) return explicit;
  if (Deno.env.get('VITEST')) return null;
  return `http://127.0.0.1:${defaultPort}/`;
}
