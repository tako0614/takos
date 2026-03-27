/**
 * Tenant worker resource limit configuration, read from environment variables.
 */

export type TenantResourceLimits = {
  /** Request timeout in milliseconds. Default: 30000 (30s). */
  cpuTimeoutMs: number;
  /** Maximum subrequests (fetch calls) per request. Default: 50. 0 = unlimited. */
  maxSubrequests: number;
  /** Maximum incoming request body size in bytes. Default: 1MB. */
  maxRequestSize: number;
  /** Maximum response body size in bytes. Default: 25MB. */
  maxResponseSize: number;
};

const DEFAULTS: TenantResourceLimits = {
  cpuTimeoutMs: 30_000,
  maxSubrequests: 50,
  maxRequestSize: 1 * 1024 * 1024,
  maxResponseSize: 25 * 1024 * 1024,
};

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseTenantResourceLimits(): TenantResourceLimits {
  return {
    cpuTimeoutMs: parseIntEnv('TAKOS_TENANT_CPU_TIMEOUT_MS', DEFAULTS.cpuTimeoutMs),
    maxSubrequests: parseIntEnv('TAKOS_TENANT_MAX_SUBREQUESTS', DEFAULTS.maxSubrequests),
    maxRequestSize: parseIntEnv('TAKOS_TENANT_MAX_REQUEST_SIZE', DEFAULTS.maxRequestSize),
    maxResponseSize: parseIntEnv('TAKOS_TENANT_MAX_RESPONSE_SIZE', DEFAULTS.maxResponseSize),
  };
}
