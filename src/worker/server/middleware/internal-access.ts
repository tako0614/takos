// Access validators for internal-only HTTP endpoints exposed by the web
// worker (see takos/../../web.ts).
//
// - isSelfHostLoopback / isSelfHostInternalHostname: hostname classifiers
//   for self-host loopback addresses and cluster-internal hostnames
// - isAllowedOrigin: CORS allow-list helper for the admin domain
// - validateInternalApiAccess: gate for /internal/* endpoints (loopback or
//   cluster-internal hostname + X-Takos-Internal-Secret header)
// - validateAuthProxyAccess: gate for the auth proxy endpoints
//   (X-Takos-Auth-Proxy-Secret header)
import type { Env } from "../../shared/types/index.ts";
import { constantTimeEqual } from "../../shared/utils/hash.ts";

export function isAllowedOrigin(
  origin: string,
  adminDomain: string,
  environment?: string,
): boolean {
  if (origin === `https://${adminDomain}`) return true;
  if (environment !== "production") {
    if (
      origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:")
    ) {
      return true;
    }
  }
  return false;
}

export function isSelfHostLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" ||
    hostname === "::1" || hostname === "[::1]";
}

export function isSelfHostInternalHostname(hostname: string): boolean {
  return hostname === "control-web";
}

export function validateInternalApiAccess(
  url: string,
  env: Env,
  getHeader: (name: string) => string | undefined,
): { ok: true } | { ok: false; status: 403; message: string } {
  const hostname = new URL(url).hostname;
  if (isSelfHostLoopback(hostname)) {
    return { ok: true };
  }
  if (!isSelfHostInternalHostname(hostname)) {
    return { ok: false, status: 403, message: "forbidden" };
  }

  const expectedSecret = env.TAKOS_INTERNAL_API_SECRET;
  if (!expectedSecret) {
    return {
      ok: false,
      status: 403,
      message: "internal API secret is not configured",
    };
  }

  const actualSecret = getHeader("X-Takos-Internal-Secret");
  if (!actualSecret || !constantTimeEqual(actualSecret, expectedSecret)) {
    return { ok: false, status: 403, message: "forbidden" };
  }

  return { ok: true };
}

export function validateAuthProxyAccess(
  env: Env,
  getHeader: (name: string) => string | undefined,
): { ok: true } | { ok: false; status: 403; message: string } {
  const expectedSecret = env.TAKOS_INTERNAL_API_SECRET;
  if (!expectedSecret) {
    return {
      ok: false,
      status: 403,
      message: "internal API secret is not configured",
    };
  }

  const actualSecret = getHeader("X-Takos-Auth-Proxy-Secret");
  if (!actualSecret || !constantTimeEqual(actualSecret, expectedSecret)) {
    return { ok: false, status: 403, message: "forbidden" };
  }

  return { ok: true };
}
