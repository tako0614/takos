/**
 * Timeout configuration helpers.
 *
 * Reads per-command timeouts from environment variables, falling back to
 * sensible defaults.  A shared `TAKOS_TIMEOUT_MS` env var can override all
 * timeouts at once.
 */

import { logWarning } from './cli-log.ts';

const SHARED_TIMEOUT_ENV_VAR = 'TAKOS_TIMEOUT_MS';
const API_TIMEOUT_ENV_VAR = 'TAKOS_API_TIMEOUT_MS';
const LOGIN_TIMEOUT_ENV_VAR = 'TAKOS_LOGIN_TIMEOUT_MS';
const DEFAULT_API_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;

function resolveTimeoutMs(envVar: string, defaultMs: number): number {
  for (const name of [envVar, SHARED_TIMEOUT_ENV_VAR]) {
    const raw = Deno.env.get(name);
    if (raw === undefined) continue;
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
    logWarning(`Ignoring invalid ${name}="${raw}". Expected a positive integer timeout in milliseconds.`);
  }
  return defaultMs;
}

export function getApiRequestTimeoutMs(): number {
  return resolveTimeoutMs(API_TIMEOUT_ENV_VAR, DEFAULT_API_REQUEST_TIMEOUT_MS);
}

export function getLoginTimeoutMs(): number {
  return resolveTimeoutMs(LOGIN_TIMEOUT_ENV_VAR, DEFAULT_LOGIN_TIMEOUT_MS);
}
