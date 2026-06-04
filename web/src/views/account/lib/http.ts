/**
 * Shared transport for the typed account-plane RPC client.
 *
 * A thin fetch wrapper that:
 *   - sends the HttpOnly `takosumi_session` cookie via `credentials: "include"`
 *     against the same-origin account plane (`/v1/*`, mounted in-process at the
 *     worker origin root). The cookie is the sole credential.
 *   - on 401, clears the session and redirects to /sign-in.
 *   - parses JSON on success, throws {@link ApiError} on non-2xx with the
 *     server's {error, error_description} body when available.
 *
 * This module is the single HTTP seam every `rpc.*` method goes through; the
 * RPC layer adds typing + contract-mirrored paths on top of it.
 *
 * Ported from takosumi dashboard-ui/src/lib/rpc/http.ts. This is the
 * account-plane client; it is deliberately separate from the takos product
 * `lib/rpc.ts` Hono client (different base + auth).
 */
import { clearSession } from "./session.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RequestOpts {
  readonly method?: string;
  readonly body?: unknown; // JSON-serialized if object
  readonly headers?: Record<string, string>;
  readonly auth?: boolean; // default true; pass false for /healthz etc.
  readonly signal?: AbortSignal;
}

export async function apiFetch<T>(
  path: string,
  opts: RequestOpts = {},
): Promise<T> {
  const auth = opts.auth !== false;

  const headers: Record<string, string> = {
    accept: "application/json",
    ...(opts.headers ?? {}),
  };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (typeof opts.body === "string" || opts.body instanceof FormData) {
      body = opts.body as BodyInit;
    } else {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
  }
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers,
    body,
    credentials: "include",
    signal: opts.signal,
  });

  if (res.status === 401 && auth) {
    clearSession();
    if (typeof location !== "undefined") {
      const intended = location.pathname + location.search;
      location.assign("/sign-in?return=" + encodeURIComponent(intended));
    }
    throw new ApiError(401, "unauthorized", "session expired");
  }

  const ct = res.headers.get("content-type") ?? "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    const code = (data as { error?: string } | undefined)?.error;
    const desc = (data as { error_description?: string } | undefined)
      ?.error_description;
    throw new ApiError(
      res.status,
      code,
      desc ?? `${res.status} ${res.statusText}`,
      data,
    );
  }
  return data as T;
}

/** Build a query string from an object, skipping undefined values. */
export function qs(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? "?" + s : "";
}
