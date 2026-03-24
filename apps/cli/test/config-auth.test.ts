import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We need to mock Conf before importing the module under test
const confMock = vi.hoisted(() => {
  const store: Record<string, unknown> = {};
  return {
    get: vi.fn((key: string) => store[key]),
    set: vi.fn((key: string, value: unknown) => { store[key] = value; }),
    clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
    _store: store,
    _reset: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
});

vi.mock('conf', () => ({
  default: vi.fn(() => confMock),
}));

import {
  DEFAULT_API_URL,
  getConfig,
  isContainerMode,
  isAuthenticated,
  logWarning,
} from '../src/lib/config-auth.js';

const MANAGED_ENV_VARS = [
  'TAKOS_SESSION_ID',
  'TAKOS_TOKEN',
  'TAKOS_API_URL',
  'TAKOS_WORKSPACE_ID',
] as const;

type ManagedEnvVar = typeof MANAGED_ENV_VARS[number];
let originalEnv: Record<ManagedEnvVar, string | undefined>;
let originalCwd: string;
let tempDirs: string[] = [];

function createSessionWorkspace(sessionJson: string, mode?: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
  writeFileSync(join(dir, '.takos-session'), sessionJson, { mode: mode ?? 0o600 });
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  vi.clearAllMocks();
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const envVar of MANAGED_ENV_VARS) {
    if (originalEnv[envVar] === undefined) {
      delete process.env[envVar];
    } else {
      process.env[envVar] = originalEnv[envVar];
    }
  }
});

// ---------------------------------------------------------------------------
// DEFAULT_API_URL
// ---------------------------------------------------------------------------

describe('DEFAULT_API_URL', () => {
  it('is https://takos.jp', () => {
    expect(DEFAULT_API_URL).toBe('https://takos.jp');
  });
});

// ---------------------------------------------------------------------------
// logWarning
// ---------------------------------------------------------------------------

describe('logWarning', () => {
  it('writes to stderr with prefix', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logWarning('test message');
    expect(spy).toHaveBeenCalledWith('[takos-cli warning] test message');
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// isContainerMode
// ---------------------------------------------------------------------------

describe('isContainerMode', () => {
  it('returns true when TAKOS_SESSION_ID is set', () => {
    process.env.TAKOS_SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';
    expect(isContainerMode()).toBe(true);
  });

  it('returns true when TAKOS_TOKEN is set', () => {
    process.env.TAKOS_TOKEN = 'some-token';
    expect(isContainerMode()).toBe(true);
  });

  it('returns true when session file exists', () => {
    const validSessionId = '550e8400-e29b-41d4-a716-446655440000';
    const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
    }));
    process.chdir(dir);
    expect(isContainerMode()).toBe(true);
  });

  it('returns false when no auth is configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-empty-'));
    tempDirs.push(dir);
    process.chdir(dir);
    expect(isContainerMode()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getConfig - env var modes
// ---------------------------------------------------------------------------

describe('getConfig environment variable modes', () => {
  const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

  it('uses TAKOS_SESSION_ID from environment', () => {
    process.env.TAKOS_SESSION_ID = validSessionId;
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    expect(config.sessionId).toBe(validSessionId);
    expect(config.apiUrl).toBe(DEFAULT_API_URL);
  });

  it('uses TAKOS_TOKEN from environment', () => {
    process.env.TAKOS_TOKEN = 'my-api-token';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    expect(config.token).toBe('my-api-token');
    expect(config.apiUrl).toBe(DEFAULT_API_URL);
  });

  it('uses TAKOS_WORKSPACE_ID from environment in session mode', () => {
    process.env.TAKOS_SESSION_ID = validSessionId;
    process.env.TAKOS_WORKSPACE_ID = 'my-workspace';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    expect(config.workspaceId).toBe('my-workspace');
    expect(config.spaceId).toBe('my-workspace');
  });

  it('uses custom TAKOS_API_URL from environment', () => {
    process.env.TAKOS_SESSION_ID = validSessionId;
    process.env.TAKOS_API_URL = 'https://api.takos.dev';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    expect(config.apiUrl).toBe('https://api.takos.dev');
  });

  it('throws on invalid TAKOS_SESSION_ID format', () => {
    process.env.TAKOS_SESSION_ID = 'invalid!@#';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    expect(() => getConfig()).toThrow('Invalid TAKOS_SESSION_ID format');
  });

  it('throws on invalid TAKOS_WORKSPACE_ID format', () => {
    process.env.TAKOS_SESSION_ID = validSessionId;
    process.env.TAKOS_WORKSPACE_ID = 'invalid workspace!@#$';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    expect(() => getConfig()).toThrow('Invalid TAKOS_WORKSPACE_ID format');
  });

  it('throws on invalid TAKOS_API_URL domain', () => {
    process.env.TAKOS_SESSION_ID = validSessionId;
    process.env.TAKOS_API_URL = 'https://evil.example.com';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    expect(() => getConfig()).toThrow('Invalid TAKOS_API_URL');
  });

  it('prefers TAKOS_SESSION_ID over TAKOS_TOKEN', () => {
    process.env.TAKOS_SESSION_ID = validSessionId;
    process.env.TAKOS_TOKEN = 'my-token';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    expect(config.sessionId).toBe(validSessionId);
    expect(config.token).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getConfig - session file mode
// ---------------------------------------------------------------------------

describe('getConfig session file mode', () => {
  const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

  it('reads session from file', () => {
    const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-file',
    }));
    process.chdir(dir);

    const config = getConfig();
    expect(config.sessionId).toBe(validSessionId);
    expect(config.workspaceId).toBe('ws-file');
    expect(config.spaceId).toBe('ws-file');
  });

  it('falls back to default API URL when session file has no api_url', () => {
    const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
    }));
    process.chdir(dir);

    const config = getConfig();
    expect(config.apiUrl).toBe(DEFAULT_API_URL);
  });

  it('uses session file api_url when valid', () => {
    const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
      api_url: 'https://api.takos.dev',
    }));
    process.chdir(dir);

    const config = getConfig();
    expect(config.apiUrl).toBe('https://api.takos.dev');
  });
});

// ---------------------------------------------------------------------------
// getConfig - external config mode
// ---------------------------------------------------------------------------

describe('getConfig external config mode', () => {
  it('reads token from config file', () => {
    confMock._store['token'] = 'stored-token';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    expect(config.token).toBe('stored-token');
    expect(config.apiUrl).toBe(DEFAULT_API_URL);
  });

  it('uses configured API URL from config', () => {
    confMock._store['apiUrl'] = 'https://takos.io';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    expect(config.apiUrl).toBe('https://takos.io');
  });

  it('falls back to default API URL for invalid domain in config', () => {
    confMock._store['apiUrl'] = 'https://evil.example.com';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    expect(config.apiUrl).toBe(DEFAULT_API_URL);
  });
});

// ---------------------------------------------------------------------------
// isAuthenticated
// ---------------------------------------------------------------------------

describe('isAuthenticated', () => {
  it('returns true when token is present', () => {
    process.env.TAKOS_TOKEN = 'some-token';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    expect(isAuthenticated()).toBe(true);
  });

  it('returns true when session ID is present', () => {
    process.env.TAKOS_SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    expect(isAuthenticated()).toBe(true);
  });

  it('returns false when no auth configured', () => {
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    expect(isAuthenticated()).toBe(false);
  });
});
