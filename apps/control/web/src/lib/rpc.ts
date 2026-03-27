import { hc } from 'hono/client';
import type { ApiRoutes } from '../../../routes/rpc-types';

export const rpc = hc<ApiRoutes>('/api');


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
    const data = await response.json().catch(() => ({})) as {
      error?: string;
      code?: string;
      reason?: string;
      plan?: string;
    };
    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        window.location.href = `/auth/login?return_to=${encodeURIComponent(returnTo)}`;
      }
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
// Typed RPC helpers for routes whose path params contain colons that break
// hono/client's type inference (e.g. /repos/:repoId/tree/:ref).
// These centralise the `as any` casts so consumers stay type-safe.
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

/** GET /repos/:repoId/tree/:ref */
export function repoTree(repoId: string, ref: string, query?: Record<string, string>) {
  return (rpc.repos[':repoId'] as any).tree[':ref'].$get({
    param: { repoId, ref },
    query: query ?? {},
  }) as Promise<Response>;
}

/** GET /repos/:repoId/blob/:ref */
export function repoBlob(repoId: string, ref: string, query?: Record<string, string>) {
  return (rpc.repos[':repoId'] as any).blob[':ref'].$get({
    param: { repoId, ref },
    query: query ?? {},
  }) as Promise<Response>;
}

/** GET /sessions/:sessionId/diff */
export function sessionDiff(sessionId: string) {
  return (rpc.sessions[':sessionId'] as any).diff.$get({
    param: { sessionId },
  }) as Promise<Response>;
}

/** POST /sessions/:sessionId/merge */
export function sessionMerge(sessionId: string, json: Record<string, unknown>) {
  return (rpc.sessions[':sessionId'] as any).merge.$post({
    param: { sessionId },
    json,
  }) as Promise<Response>;
}

/* eslint-enable @typescript-eslint/no-explicit-any */

