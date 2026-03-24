/**
 * Configuration management for takos-cli
 *
 * Three modes (checked in order):
 * 1. Environment variables: TAKOS_SESSION_ID or TAKOS_TOKEN (container mode)
 * 2. Session file: .takos-session in current directory (session workdir)
 * 3. External mode: ~/.takos/credentials.json (local development)
 */

// Re-export public API from split modules
export type { ApiUrlValidationResult } from './config-validation.js';
export { validateApiUrl } from './config-validation.js';

export type { TakosConfig } from './config-auth.js';
export {
  isContainerMode,
  getConfig,
  saveToken,
  saveApiUrl,
  clearCredentials,
  isAuthenticated,
} from './config-auth.js';

import { logWarning } from './config-auth.js';

// ---------------------------------------------------------------------------
// Timeout configuration
// ---------------------------------------------------------------------------

const SHARED_TIMEOUT_ENV_VAR = 'TAKOS_TIMEOUT_MS';
const API_TIMEOUT_ENV_VAR = 'TAKOS_API_TIMEOUT_MS';
const LOGIN_TIMEOUT_ENV_VAR = 'TAKOS_LOGIN_TIMEOUT_MS';
const DEFAULT_API_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000;

function resolveTimeoutMs(envVar: string, defaultMs: number): number {
  for (const name of [envVar, SHARED_TIMEOUT_ENV_VAR]) {
    const raw = process.env[name];
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
