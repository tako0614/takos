/**
 * Resolve the base URL the worker uses to reach its in-process container hosts
 * (runtime / executor / egress callbacks). Single source of precedence shared by
 * the worker entry (`web.ts`) and the workers platform adapter so the two cannot
 * drift.
 *
 * Precedence: explicit `PROXY_BASE_URL` → `AUTH_PUBLIC_BASE_URL` → the admin
 * origin (`https://<ADMIN_DOMAIN>`) → the `https://takos` degenerate fallback
 * (only reached when every source is unset, which is not a valid deploy config).
 * Empty strings are treated as unset.
 */
export function resolveContainerHostBaseUrl(opts: {
  proxyBaseUrl?: string;
  authPublicBaseUrl?: string;
  adminDomain?: string;
}): string {
  return (
    opts.proxyBaseUrl ||
    opts.authPublicBaseUrl ||
    (opts.adminDomain ? `https://${opts.adminDomain}` : "https://takos")
  );
}
