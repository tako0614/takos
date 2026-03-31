/**
 * Configuration management for takos-cli
 *
 * Three modes (checked in order):
 * 1. Environment variables: TAKOS_SESSION_ID or TAKOS_TOKEN (container mode)
 * 2. Session file: .takos-session in current directory (session workdir)
 * 3. External mode: ~/.takos/credentials.json (local development)
 */

// Re-export public API from split modules
export type { ApiUrlValidationResult } from './config-validation.ts';
export { validateApiUrl } from './config-validation.ts';

export type { TakosConfig } from './config-auth.ts';
export {
  isContainerMode,
  getConfig,
  saveToken,
  saveApiUrl,
  clearCredentials,
  isAuthenticated,
} from './config-auth.ts';

export { getApiRequestTimeoutMs, getLoginTimeoutMs } from './config-timeout.ts';
