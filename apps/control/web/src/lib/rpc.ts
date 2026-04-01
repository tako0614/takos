import { hc } from 'hono/client';
import type { ClientResponse } from 'hono/client';
import type { ApiRoutes } from 'takos-control/rpc-types';

export const rpc = hc<ApiRoutes>('/api');

// ---------------------------------------------------------------------------
// rpcPath – type-safe traversal of the Hono RPC proxy for routes that lack
// compile-time types (wildcard `/*` routes, or routes not in the schema).
//
// At runtime, `hc()` returns a Proxy that builds up URL segments from
// property access.  Paths like `/repos/:repoId/tree/:ref/*` work fine at
// runtime but produce no type in Hono's `PathToChain` because `*` is not a
// valid key.  This single helper encapsulates the lone `any` cast so every
// call-site remains fully typed.
// ---------------------------------------------------------------------------

/** Shape of a terminal Hono RPC node that exposes HTTP-method helpers. */
interface RpcEndpoint {
  $get: (args: { param: Record<string, string>; query?: Record<string, string> }) => Promise<ClientResponse<unknown>>;
  $post: (args: { param: Record<string, string>; json?: Record<string, unknown> }) => Promise<ClientResponse<unknown>>;
  $put: (args: { param: Record<string, string>; json?: Record<string, unknown> }) => Promise<ClientResponse<unknown>>;
  $patch: (args: { param: Record<string, string>; json?: Record<string, unknown> }) => Promise<ClientResponse<unknown>>;
  $delete: (args: { param: Record<string, string> }) => Promise<ClientResponse<unknown>>;
}

/**
 * Walk the Hono RPC proxy through arbitrary path segments and return the
 * terminal node typed as {@link RpcEndpoint}.
 *
 * Example:
 * ```ts
 * rpcPath(rpc, 'repos', ':repoId', 'tree', ':ref').$get({ param: { repoId, ref } })
 * ```
 */
export function rpcPath(base: unknown, ...segments: string[]): RpcEndpoint {
  let current = base;
  for (const seg of segments) {
    current = (current as Record<string, unknown>)[seg];
  }
  return current as RpcEndpoint;
}


export class BillingQuotaError extends Error {
  code = 'BILLING_QUOTA_EXCEEDED' as const;
  reason: string;
  plan: string;
  constructor(data: { reason?: string; plan?: string }) {
    super(data.reason || 'Billing quota exceeded');
    this.reason = data.reason || 'Billing quota exceeded';
    this.plan = data.plan || '';
  }
}

export async function rpcJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch((e) => { console.warn('Failed to parse error response JSON:', e); return {}; }) as {
      error?: string;
      code?: string;
      reason?: string;
      plan?: string;
    };
    if (response.status === 401) {
      const returnTo = `${globalThis.location.pathname}${globalThis.location.search}`;
      globalThis.location.href = `/auth/login?return_to=${encodeURIComponent(returnTo)}`;
      throw new Error(data.error || 'Authentication required');
    }
    if (response.status === 402 && data.code === 'BILLING_QUOTA_EXCEEDED') {
      throw new BillingQuotaError(data);
    }
    throw new Error(data.error || 'Request failed');
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// Typed RPC helpers for routes whose wildcard patterns (`/*`) or missing
// schema entries break hono/client's type inference.
// These use `rpcPath` so no `as any` leaks into call-sites.
// ---------------------------------------------------------------------------

/** GET /repos/:repoId/tree/:ref */
export function repoTree(repoId: string, ref: string, query?: Record<string, string>) {
  return rpcPath(rpc, 'repos', ':repoId', 'tree', ':ref').$get({
    param: { repoId, ref },
    query: query ?? {},
  }) as Promise<Response>;
}

/** GET /repos/:repoId/blob/:ref */
export function repoBlob(repoId: string, ref: string, query?: Record<string, string>) {
  return rpcPath(rpc, 'repos', ':repoId', 'blob', ':ref').$get({
    param: { repoId, ref },
    query: query ?? {},
  }) as Promise<Response>;
}

/** GET /sessions/:sessionId/diff */
export function sessionDiff(sessionId: string) {
  return rpcPath(rpc, 'sessions', ':sessionId', 'diff').$get({
    param: { sessionId },
  }) as Promise<Response>;
}

/** POST /sessions/:sessionId/merge */
export function sessionMerge(sessionId: string, json: Record<string, unknown>) {
  return rpcPath(rpc, 'sessions', ':sessionId', 'merge').$post({
    param: { sessionId },
    json,
  }) as Promise<Response>;
}

