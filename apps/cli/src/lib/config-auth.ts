/**
 * Authentication mode resolution and token management.
 *
 * Session file I/O lives in ./config-session-io.ts.
 */

import Conf from 'conf';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, chmodSync, mkdirSync } from 'fs';
import { logWarning } from './cli-log.js';
import { validateApiUrl, isValidId } from './config-validation.js';
import {
  findSessionFile,
  isWindows,
  setSecurePermissions,
} from './config-session-io.js';

export interface TakosConfig {
  apiUrl: string;
  token?: string;
  sessionId?: string;
  workspaceId?: string;
  /** Alias for workspaceId — used by API layer as spaceId */
  spaceId?: string;
}

type ConfStore = { token?: string; apiUrl?: string };

function getConfInstance(): Conf<ConfStore> {
  return new Conf<ConfStore>({
    projectName: 'takos',
    cwd: join(homedir(), '.takos'),
  });
}

export const DEFAULT_API_URL = 'https://takos.jp';

/**
 * Validate workspace ID from env var and return it, or throw on invalid format.
 */
function validateEnvWorkspaceId(): string | undefined {
  const workspaceId = process.env.TAKOS_WORKSPACE_ID;
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
  const apiUrl = process.env.TAKOS_API_URL || DEFAULT_API_URL;
  if (process.env.TAKOS_API_URL) {
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
  return !!process.env.TAKOS_SESSION_ID || !!process.env.TAKOS_TOKEN || findSessionFile() !== null;
}

// Get configuration based on mode
export function getConfig(): TakosConfig {
  // 1. Check environment variables first
  if (process.env.TAKOS_SESSION_ID) {
    logWarning('Using environment variable authentication (TAKOS_SESSION_ID)');

    const sessionId = process.env.TAKOS_SESSION_ID;
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
  if (process.env.TAKOS_TOKEN) {
    logWarning('Using environment variable authentication (TAKOS_TOKEN)');

    const workspaceId = validateEnvWorkspaceId();
    return {
      apiUrl: validateEnvApiUrl(),
      token: process.env.TAKOS_TOKEN,
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
  const config = getConfInstance();
  const configuredApiUrl = config.get('apiUrl');
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
    token: config.get('token'),
  };
}

// Save token to config (external mode only)
export function saveToken(token: string): void {
  if (isContainerMode()) {
    throw new Error('Cannot save token in container mode');
  }

  const configDir = join(homedir(), '.takos');

  // Ensure config directory exists with secure permissions (0o700 for directories)
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    if (!isWindows()) {
      try {
        chmodSync(configDir, 0o700);
      } catch {
        logWarning(`Failed to set secure permissions on config directory: ${configDir}`);
      }
    }
  }

  const config = getConfInstance();
  config.set('token', token);

  const configFilePath = join(configDir, 'config.json');
  if (existsSync(configFilePath)) {
    setSecurePermissions(configFilePath);
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

  getConfInstance().set('apiUrl', normalizedApiUrl);
}

// Clear stored credentials
export function clearCredentials(): void {
  if (isContainerMode()) {
    throw new Error('Cannot clear credentials in container mode');
  }

  getConfInstance().clear();
}

// Check if authenticated
export function isAuthenticated(): boolean {
  const config = getConfig();
  return !!(config.token || config.sessionId);
}
