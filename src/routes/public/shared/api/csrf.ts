import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
import type { Context, MiddlewareHandler } from "hono";
import { commonError } from "./common.ts";

/**
 * Origin-based CSRF defense.
 *
 * For state-changing methods (POST/PUT/PATCH/DELETE) that rely on cookie auth,
 * we require `Origin` (or `Referer` fallback) to match a configured allowlist.
 * Bearer-auth requests bypass CSRF because the token in the `Authorization`
 * header is itself not auto-attached by browsers.
 *
 * Configuration is read from `TAKOS_API_CSRF_ALLOWED_ORIGINS` (comma-separated
 * exact-origin list). When the env is empty the middleware is permissive — this
 * preserves backward compatibility for proxies that haven't enabled the gate.
 * Setting the env unlocks strict enforcement.
 */

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const CSRF_ALLOWED_ORIGINS_ENV = "TAKOS_API_CSRF_ALLOWED_ORIGINS";

export type CsrfOriginEnv = {
  /**
   * Reads `TAKOS_API_CSRF_ALLOWED_ORIGINS` once per call so the middleware
   * picks up env changes between tests without restarting the worker.
   */
  read: () => string | undefined;
};

const DEFAULT_ENV: CsrfOriginEnv = {
  read: () => getEnv(CSRF_ALLOWED_ORIGINS_ENV)?.trim() || undefined,
};

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map(normalizeOrigin)
    .filter((entry): entry is string => entry !== null);
}

function normalizeOrigin(entry: string): string | null {
  // Allow callers to configure either bare origins ("https://takos.test")
  // or full URLs ("https://takos.test/"). Anything that isn't a valid URL
  // is dropped silently rather than blocking startup.
  try {
    return new URL(entry).origin;
  } catch {
    return null;
  }
}

function originFromHeader(header: string | null): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed || trimmed === "null") return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function requestHasBearerAuth(headers: Headers): boolean {
  const authorization = headers.get("authorization");
  if (!authorization) return false;
  const lower = authorization.toLowerCase();
  return lower.startsWith("bearer ") || lower.startsWith("basic ");
}

function requestHasCookieAuth(headers: Headers): boolean {
  return Boolean(headers.get("cookie"));
}

export type CsrfDecision =
  | { ok: true }
  | { ok: false; reason: "csrf_origin_mismatch" | "csrf_origin_missing" };

/**
 * Pure decision function exposed for tests. The middleware below is just a
 * thin Hono wrapper around this.
 */
export function evaluateCsrf(
  request: Request,
  allowedOrigins: readonly string[],
): CsrfDecision {
  if (!STATE_CHANGING_METHODS.has(request.method.toUpperCase())) {
    return { ok: true };
  }
  // Browsers don't attach Authorization headers automatically, so a Bearer
  // request indicates a deliberate API client and is not a CSRF risk.
  if (requestHasBearerAuth(request.headers)) return { ok: true };
  // Without any credential at all the request can't perform a privileged
  // mutation; downstream auth will reject it with 401.
  if (!requestHasCookieAuth(request.headers)) return { ok: true };
  // If no allowlist is configured we don't enforce — the deployment hasn't
  // opted into the gate. This mirrors the existing CORS env-driven model.
  if (allowedOrigins.length === 0) return { ok: true };

  const originHeader = originFromHeader(request.headers.get("origin")) ??
    originFromHeader(request.headers.get("referer"));
  if (!originHeader) {
    return { ok: false, reason: "csrf_origin_missing" };
  }
  if (!allowedOrigins.includes(originHeader)) {
    return { ok: false, reason: "csrf_origin_mismatch" };
  }
  return { ok: true };
}

export function csrfMiddleware(
  env: CsrfOriginEnv = DEFAULT_ENV,
): MiddlewareHandler {
  return async (c: Context, next: () => Promise<void>) => {
    const allowed = parseAllowedOrigins(env.read());
    const decision = evaluateCsrf(c.req.raw, allowed);
    if (decision.ok) return await next();
    return c.json(
      commonError(decision.reason, "request origin is not allowed"),
      403,
    );
  };
}
