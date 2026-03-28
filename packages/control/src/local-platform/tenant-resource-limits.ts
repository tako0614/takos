/**
 * Tenant worker resource limit configuration, read from environment variables.
 */

import { parseIntEnv } from 'takos-common/env-parse';

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

export function parseTenantResourceLimits(): TenantResourceLimits {
  return {
    cpuTimeoutMs: parseIntEnv('TAKOS_TENANT_CPU_TIMEOUT_MS', DEFAULTS.cpuTimeoutMs, { min: 0 }),
    maxSubrequests: parseIntEnv('TAKOS_TENANT_MAX_SUBREQUESTS', DEFAULTS.maxSubrequests, { min: 0 }),
    maxRequestSize: parseIntEnv('TAKOS_TENANT_MAX_REQUEST_SIZE', DEFAULTS.maxRequestSize, { min: 0 }),
    maxResponseSize: parseIntEnv('TAKOS_TENANT_MAX_RESPONSE_SIZE', DEFAULTS.maxResponseSize, { min: 0 }),
  };
}
