import { hc } from "hono/client";
import type { ClientResponse } from "hono/client";
import type { ApiRoutes } from "takos-control/rpc-types";

export const rpc = hc<ApiRoutes>("/api");

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
  $get: (
    args: { param: Record<string, string>; query?: Record<string, string> },
  ) => Promise<ClientResponse<unknown>>;
  $post: (
    args: { param: Record<string, string>; json?: Record<string, unknown> },
  ) => Promise<ClientResponse<unknown>>;
  $put: (
    args: { param: Record<string, string>; json?: Record<string, unknown> },
  ) => Promise<ClientResponse<unknown>>;
  $patch: (
    args: { param: Record<string, string>; json?: Record<string, unknown> },
  ) => Promise<ClientResponse<unknown>>;
  $delete: (
    args: { param: Record<string, string> },
  ) => Promise<ClientResponse<unknown>>;
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
  code = "BILLING_QUOTA_EXCEEDED" as const;
  reason: string;
  plan: string;
  constructor(data: { reason?: string; plan?: string }) {
    super(data.reason || "Billing quota exceeded");
    this.reason = data.reason || "Billing quota exceeded";
    this.plan = data.plan || "";
  }
}

export interface JsonResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type RpcResponse = ClientResponse<unknown>;

/**
 * Extract a human-readable error message from a parsed error payload.
 *
 * The takos stack produces error bodies in three distinct shapes:
 *
 *  1. **takos common envelope** – `{ error: { code, message } }`
 *     Emitted by `AppError.toResponse()` for any route that throws an
 *     `AppError` subclass (NotFoundError, BadRequestError, etc.).
 *
 *  2. **OAuth 2.0 (RFC 6749 §5.2)** – `{ error: 'invalid_client',
 *     error_description: 'Client not found' }`
 *     Emitted by `/oauth/token`, `/oauth/revoke`, `/oauth/introspect`, and
 *     `/oauth/device`. These routes MUST use the flat shape to remain
 *     compliant with the RFC, so we detect and flatten it here instead of
 *     forcing every route onto the envelope.
 *
 *  3. **Legacy plain string** – `{ error: 'something went wrong' }`
 *     Older routes that haven't migrated to AppError yet.
 *
 * Returns `null` when no useful message can be extracted so the caller can
 * fall back to a generic default.
 */
function extractErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const rawError = record.error;

  // Shape (1): { error: { code, message } }
  if (rawError && typeof rawError === "object") {
    const envelope = rawError as Record<string, unknown>;
    if (typeof envelope.message === "string" && envelope.message.length > 0) {
      return envelope.message;
    }
    if (typeof envelope.code === "string" && envelope.code.length > 0) {
      return envelope.code;
    }
    return null;
  }

  // Shape (2): { error: 'invalid_client', error_description: '...' }
  if (typeof rawError === "string") {
    const description = record.error_description;
    if (typeof description === "string" && description.length > 0) {
      return description;
    }
    // Shape (3): { error: 'plain string' }
    if (rawError.length > 0) return rawError;
  }

  return null;
}

export async function rpcJson<T>(response: JsonResponseLike): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch((e) => {
      console.warn("Failed to parse error response JSON:", e);
      return {};
    }) as {
      error?: unknown;
      error_description?: unknown;
      code?: string;
      reason?: string;
      plan?: string;
    };
    const message = extractErrorMessage(data);
    if (response.status === 401) {
      const returnTo =
        `${globalThis.location.pathname}${globalThis.location.search}`;
      globalThis.location.href = `/auth/login?return_to=${
        encodeURIComponent(returnTo)
      }`;
      throw new Error(message || "Authentication required");
    }
    if (response.status === 402 && data.code === "BILLING_QUOTA_EXCEEDED") {
      throw new BillingQuotaError(data);
    }
    throw new Error(message || "Request failed");
  }
  return await response.json() as T;
}

// ---------------------------------------------------------------------------
// Typed RPC helpers for routes whose wildcard patterns (`/*`) or missing
// schema entries break hono/client's type inference.
// These use `rpcPath` so no `as any` leaks into call-sites.
// ---------------------------------------------------------------------------

/** GET /repos/:repoId/tree/:ref */
export function repoTree(
  repoId: string,
  ref: string,
  query?: Record<string, string>,
): Promise<RpcResponse> {
  return rpcPath(rpc, "repos", ":repoId", "tree", ":ref").$get({
    param: { repoId, ref },
    query: query ?? {},
  });
}

/** GET /repos/:repoId/blob/:ref */
export function repoBlob(
  repoId: string,
  ref: string,
  query?: Record<string, string>,
): Promise<RpcResponse> {
  return rpcPath(rpc, "repos", ":repoId", "blob", ":ref").$get({
    param: { repoId, ref },
    query: query ?? {},
  });
}

/** GET /sessions/:sessionId/diff */
export function sessionDiff(sessionId: string): Promise<RpcResponse> {
  return rpcPath(rpc, "sessions", ":sessionId", "diff").$get({
    param: { sessionId },
  });
}

/** POST /sessions/:sessionId/merge */
export function sessionMerge(
  sessionId: string,
  json: Record<string, unknown>,
): Promise<RpcResponse> {
  return rpcPath(rpc, "sessions", ":sessionId", "merge").$post({
    param: { sessionId },
    json,
  });
}
