// Access validators for internal-only HTTP endpoints exposed by the web
// worker (see takos/../../web.ts).
//
// These are TIER 3 (cross-service) gates per the canonical mechanism in
// docs/architecture/internal-trust-boundaries.md: they authenticate a separate
// trust domain (the operator distribution / account-plane), so they keep a
// credential. They are the LEGACY plain-shared-secret form; the canonical
// cross-service primitive is the `takos-internal-v3` signed envelope
// (verifyTakosumiInternalRequestFromHeaders), onto which these converge once the
// cross-repo callers send it. Do NOT use these for intra-worker (tier 1) calls —
// those rely on the binding/DO-stub transport as the trust boundary, no header.
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

/**
 * Shared tier-3 secret check: the request must present `headerName` matching the
 * configured internal secret (constant-time). Returns a 403 result when the
 * secret is unconfigured or the header is missing/wrong.
 */
function checkInternalSecretHeader(
  env: Env,
  getHeader: (name: string) => string | undefined,
  headerName: string,
): { ok: true } | { ok: false; status: 403; message: string } {
  const expectedSecret = env.TAKOS_INTERNAL_API_SECRET;
  if (!expectedSecret) {
    return {
      ok: false,
      status: 403,
      message: "internal API secret is not configured",
    };
  }
  const actualSecret = getHeader(headerName);
  if (!actualSecret || !constantTimeEqual(actualSecret, expectedSecret)) {
    return { ok: false, status: 403, message: "forbidden" };
  }
  return { ok: true };
}

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
  return checkInternalSecretHeader(env, getHeader, "X-Takos-Internal-Secret");
}

export function validateAuthProxyAccess(
  env: Env,
  getHeader: (name: string) => string | undefined,
): { ok: true } | { ok: false; status: 403; message: string } {
  return checkInternalSecretHeader(env, getHeader, "X-Takos-Auth-Proxy-Secret");
}
