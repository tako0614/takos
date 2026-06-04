// Access gate for the `/internal/*` HTTP endpoints exposed by the web worker
// (see takos/../../web.ts).
//
// The worker, account-plane, and executor run in ONE process; intra-worker calls
// use the binding/DO-stub transport as their trust boundary and send no header.
// The only HTTP entry that crosses into the worker from outside is an EXTERNAL
// SCHEDULER callback (a k8s CronJob / EventBridge / Cloud Scheduler hitting
// `/internal/scheduled` and the default-app-distribution endpoints). That is the
// one gate here: the request must originate from loopback, or from an
// authenticated cluster-internal hostname presenting the shared
// `X-Takos-Internal-Secret`. The shared secret is the only defense against
// Host-spoof / DNS-rebind reaching a cluster-internal hostname; it is not a
// cross-trust-domain credential.
//
// - isSelfHostLoopback / isSelfHostInternalHostname: hostname classifiers
//   for self-host loopback addresses and cluster-internal hostnames
// - isAllowedOrigin: CORS allow-list helper for the admin domain
// - validateInternalApiAccess: gate for /internal/* endpoints (loopback or
//   cluster-internal hostname + X-Takos-Internal-Secret header)
import type { Env } from "../../shared/types/index.ts";
import { constantTimeEqual } from "../../shared/utils/hash.ts";

/**
 * Shared secret check: the request must present `headerName` matching the
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
