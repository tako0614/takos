/**
 * Authentication mode resolution and token management.
 *
 * Session file I/O lives in ./config-session-io.ts.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PRODUCTION_DOMAIN } from 'takos-control/shared/constants';
import { logWarning } from './cli-log.ts';
import { validateApiUrl, isValidId } from './config-validation.ts';
import {
  findSessionFile,
  isWindows,
  setSecurePermissions,
} from './config-session-io.ts';

export interface TakosConfig {
  apiUrl: string;
  token?: string;
  sessionId?: string;
  workspaceId?: string;
  /** Alias for workspaceId — used by API layer as spaceId */
  spaceId?: string;
}

type ConfStore = { token?: string; apiUrl?: string };

const CONFIG_DIR = join(homedir(), '.takos');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

function readConfStore(): ConfStore {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as ConfStore;
  } catch {
    return {};
  }
}

function writeConfStore(store: ConfStore): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(store, null, 2));
}

export const DEFAULT_API_URL = `https://${PRODUCTION_DOMAIN}`;

/**
 * Validate workspace ID from env var and return it, or throw on invalid format.
 */
function validateEnvWorkspaceId(): string | undefined {
  const workspaceId = Deno.env.get('TAKOS_WORKSPACE_ID');
  if (workspaceId && !isValidId(workspaceId)) {
    logWarning('SECURITY WARNING: TAKOS_WORKSPACE_ID has invalid format');
    logWarning('Expected UUID v4 or alphanumeric ID (1-64 characters)');
    throw new Error('Invalid TAKOS_WORKSPACE_ID format');
  }
  return workspaceId;
}

/**
 * Validate API URL from env var and return it, or throw on invalid domain.
 */
function validateEnvApiUrl(): string {
  const apiUrl = Deno.env.get('TAKOS_API_URL') || DEFAULT_API_URL;
  if (Deno.env.get('TAKOS_API_URL')) {
    logWarning(`Using custom API URL from environment: ${apiUrl}`);
    const domainValidation = validateApiUrl(apiUrl);
    if (!domainValidation.valid) {
      logWarning(`SECURITY WARNING: ${domainValidation.error}`);
      throw new Error(`Invalid TAKOS_API_URL: ${domainValidation.error}`);
    }
  }
  return apiUrl;
}

// Check if running inside takos container (env var or session file)
export function isContainerMode(): boolean {
  return !!Deno.env.get('TAKOS_SESSION_ID') || !!Deno.env.get('TAKOS_TOKEN') || findSessionFile() !== null;
}

// Get configuration based on mode
export function getConfig(): TakosConfig {
  // 1. Check environment variables first
  if (Deno.env.get('TAKOS_SESSION_ID')) {
    logWarning('Using environment variable authentication (TAKOS_SESSION_ID)');

    const sessionId = Deno.env.get('TAKOS_SESSION_ID')!;
    if (!isValidId(sessionId)) {
      logWarning('SECURITY WARNING: TAKOS_SESSION_ID has invalid format');
      logWarning('Expected UUID v4 or alphanumeric ID (8-64 characters)');
      throw new Error('Invalid TAKOS_SESSION_ID format');
    }

    const workspaceId = validateEnvWorkspaceId();
    return {
      apiUrl: validateEnvApiUrl(),
      sessionId,
      workspaceId,
      spaceId: workspaceId,
    };
  }

  // 1b. Environment token mode (TAKOS_TOKEN)
  if (Deno.env.get('TAKOS_TOKEN')) {
    logWarning('Using environment variable authentication (TAKOS_TOKEN)');

    const workspaceId = validateEnvWorkspaceId();
    return {
      apiUrl: validateEnvApiUrl(),
      token: Deno.env.get('TAKOS_TOKEN'),
      workspaceId,
      spaceId: workspaceId,
    };
  }

  // 2. Check for .takos-session file
  const sessionFile = findSessionFile();
  if (sessionFile) {
    return {
      apiUrl: sessionFile.api_url || DEFAULT_API_URL,
      sessionId: sessionFile.session_id,
      workspaceId: sessionFile.workspace_id,
      spaceId: sessionFile.workspace_id,
    };
  }

  // 3. External mode - read from config file
  const store = readConfStore();
  const configuredApiUrl = store.apiUrl;
  let validatedApiUrl = DEFAULT_API_URL;
  if (configuredApiUrl) {
    const domainValidation = validateApiUrl(configuredApiUrl);
    if (!domainValidation.valid) {
      logWarning(`SECURITY WARNING: Ignoring invalid apiUrl in config: ${domainValidation.error}`);
      logWarning(`Falling back to default API URL: ${DEFAULT_API_URL}`);
    } else {
      validatedApiUrl = configuredApiUrl;
    }
  }

  return {
    apiUrl: validatedApiUrl,
    token: store.token,
  };
}

// Save token to config (external mode only)
export function saveToken(token: string): void {
  if (isContainerMode()) {
    throw new Error('Cannot save token in container mode');
  }

  // Ensure config directory exists with secure permissions (0o700 for directories)
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    if (!isWindows()) {
      try {
        chmodSync(CONFIG_DIR, 0o700);
      } catch {
        logWarning(`Failed to set secure permissions on config directory: ${CONFIG_DIR}`);
      }
    }
  }

  const store = readConfStore();
  store.token = token;
  writeConfStore(store);

  if (existsSync(CONFIG_FILE)) {
    setSecurePermissions(CONFIG_FILE);
  }
}

// Save API URL to config
export function saveApiUrl(apiUrl: string): void {
  if (isContainerMode()) {
    throw new Error('Cannot save config in container mode');
  }

  const normalizedApiUrl = apiUrl.trim();
  const domainValidation = validateApiUrl(normalizedApiUrl);
  if (!domainValidation.valid) {
    throw new Error(`Invalid API URL: ${domainValidation.error}`);
  }

  const store = readConfStore();
  store.apiUrl = normalizedApiUrl;
  writeConfStore(store);
}

// Clear stored credentials
export function clearCredentials(): void {
  if (isContainerMode()) {
    throw new Error('Cannot clear credentials in container mode');
  }

  writeConfStore({});
}

// Check if authenticated
export function isAuthenticated(): boolean {
  const config = getConfig();
  return !!(config.token || config.sessionId);
}
