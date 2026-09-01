import { hc } from "hono/client";
import type { ClientResponse } from "hono/client";
import type { ApiRoutes } from "takos-api-contract/rpc-types";
import { getTranslation, type TranslationKey } from "../i18n.ts";
import { detectLanguage } from "./locale.ts";
import { withTimeout } from "./withTimeout.ts";

type RpcInput = {
  param?: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  form?: unknown;
  header?: Record<string, string>;
};

type RpcMethod = (input?: RpcInput) => Promise<ClientResponse<unknown>>;

/**
 * The public contract currently contains exact types for stable public
 * endpoints and a deliberately loose fallback for product-local routes.
 * Hono cannot turn a string index signature into a traversable proxy type, so
 * keep that fallback cast at this one construction boundary instead of
 * scattering `any` casts across every caller.
 */
type ProductRpcNode = RpcMethod & {
  readonly [segment: string]: ProductRpcNode;
};

export const rpc = hc<ApiRoutes>("/api") as unknown as ProductRpcNode;
const DEFAULT_API_TIMEOUT_MS = 15000;

function fallbackMessage(key: TranslationKey): string {
  return getTranslation(detectLanguage(), key);
}

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
  $get: (args: {
    param?: Record<string, string>;
    query?: Record<string, string>;
  }) => Promise<ClientResponse<unknown>>;
  $post: (args: {
    param?: Record<string, string>;
    json?: Record<string, unknown>;
  }) => Promise<ClientResponse<unknown>>;
  $put: (args: {
    param?: Record<string, string>;
    json?: Record<string, unknown>;
  }) => Promise<ClientResponse<unknown>>;
  $patch: (args: {
    param?: Record<string, string>;
    json?: Record<string, unknown>;
  }) => Promise<ClientResponse<unknown>>;
  $delete: (args: {
    param?: Record<string, string>;
  }) => Promise<ClientResponse<unknown>>;
}

/**
 * Walk the Hono RPC proxy through arbitrary path segments and return the
 * terminal node typed as {@link RpcEndpoint}.
 *
 * Example:
 * ```ts
 * rpcPath(rpc, "spaces", ":spaceId", "threads").$get({
 *   param: { spaceId },
 * })
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
    super(data.reason || fallbackMessage("billingQuotaExceeded"));
    this.reason = data.reason || fallbackMessage("billingQuotaExceeded");
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
 * The takos stack produces error bodies in two current shapes:
 *
 *  1. **takos common envelope** – `{ error: { code, message } }`
 *     Emitted by `AppError.toResponse()` for any route that throws an
 *     `AppError` subclass (NotFoundError, BadRequestError, etc.).
 *
 *  2. **Protocol flat error** – `{ error: 'invalid_client',
 *     error_description: 'Client not found' }`
 *     Protocol endpoints may need a flat shape for standards compliance, so
 *     we detect and flatten it here instead of forcing every route onto the
 *     envelope.
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
    if (/^[a-z][a-z0-9_.:-]*$/.test(rawError)) return rawError;
  }

  return null;
}

export async function rpcJson<T>(response: JsonResponseLike): Promise<T> {
  if (!response.ok) {
    const data = (await response.json().catch((e) => {
      console.warn("Failed to parse error response JSON:", e);
      return {};
    })) as {
      error?: unknown;
      error_description?: unknown;
      code?: string;
      reason?: string;
      plan?: string;
    };
    const message = extractErrorMessage(data);
    if (response.status === 401) {
      const returnTo = `${globalThis.location.pathname}${globalThis.location.search}`;
      globalThis.location.href = `/auth/oidc/login?return_to=${encodeURIComponent(
        returnTo,
      )}`;
      throw new Error(message || fallbackMessage("authenticationRequired"));
    }
    if (response.status === 402 && data.code === "BILLING_QUOTA_EXCEEDED") {
      throw new BillingQuotaError(data);
    }
    throw new Error(message || fallbackMessage("requestFailed"));
  }
  return (await response.json()) as T;
}

export interface ApiJsonOptions {
  timeoutMs?: number;
  init?: RequestInit;
}

export async function apiJson<T>(
  path: string,
  options: ApiJsonOptions = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, init } = options;
  const response = await withTimeout(
    (signal) => {
      const headers = new Headers(init?.headers);
      if (!headers.has("Accept")) {
        headers.set("Accept", "application/json");
      }
      const requestSignal = init?.signal
        ? AbortSignal.any([signal, init.signal])
        : signal;
      return fetch(path, {
        ...init,
        headers,
        signal: requestSignal,
      });
    },
    timeoutMs,
    fallbackMessage("requestTimedOut"),
  );
  return await rpcJson<T>(response);
}
