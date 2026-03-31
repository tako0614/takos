import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We need to mock Conf before importing the module under test
import { assertEquals, assertThrows } from 'jsr:@std/assert';
import { stub, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const confMock = {
  const store: Record<string, unknown> = {};
  return {
    get: (key: string) => store[key],
    set: (key: string, value: unknown) => { store[key] = value; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    _store: store,
    _reset: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
};

// [Deno] vi.mock removed - manually stub imports from 'conf'
import {
  DEFAULT_API_URL,
  getConfig,
  isContainerMode,
  isAuthenticated,
} from '../src/lib/config-auth.ts';
import { logWarning } from '../src/lib/cli-log.ts';

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
// ---------------------------------------------------------------------------
// DEFAULT_API_URL
// ---------------------------------------------------------------------------


  Deno.test('DEFAULT_API_URL - is https://takos.jp', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  assertEquals(DEFAULT_API_URL, 'https://takos.jp');
  } finally {
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
  }
})
// ---------------------------------------------------------------------------
// logWarning
// ---------------------------------------------------------------------------


  Deno.test('logWarning - writes to stderr with prefix', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  const spy = stub(console, 'error') = () => {} as any;
    logWarning('test message');
    assertSpyCallArgs(spy, 0, ['[takos-cli warning] test message']);
    spy.restore();
  } finally {
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
  }
})
// ---------------------------------------------------------------------------
// isContainerMode
// ---------------------------------------------------------------------------


  Deno.test('isContainerMode - returns true when TAKOS_SESSION_ID is set', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  process.env.TAKOS_SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';
    assertEquals(isContainerMode(), true);
  } finally {
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
  }
})
  Deno.test('isContainerMode - returns true when TAKOS_TOKEN is set', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  process.env.TAKOS_TOKEN = 'some-token';
    assertEquals(isContainerMode(), true);
  } finally {
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
  }
})
  Deno.test('isContainerMode - returns true when session file exists', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  const validSessionId = '550e8400-e29b-41d4-a716-446655440000';
    const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
    }));
    process.chdir(dir);
    assertEquals(isContainerMode(), true);
  } finally {
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
  }
})
  Deno.test('isContainerMode - returns false when no auth is configured', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-empty-'));
    tempDirs.push(dir);
    process.chdir(dir);
    assertEquals(isContainerMode(), false);
  } finally {
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
  }
})
// ---------------------------------------------------------------------------
// getConfig - env var modes
// ---------------------------------------------------------------------------


  const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

  Deno.test('getConfig environment variable modes - uses TAKOS_SESSION_ID from environment', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  process.env.TAKOS_SESSION_ID = validSessionId;
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.sessionId, validSessionId);
    assertEquals(config.apiUrl, DEFAULT_API_URL);
  } finally {
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
  }
})
  Deno.test('getConfig environment variable modes - uses TAKOS_TOKEN from environment', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  process.env.TAKOS_TOKEN = 'my-api-token';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.token, 'my-api-token');
    assertEquals(config.apiUrl, DEFAULT_API_URL);
  } finally {
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
  }
})
  Deno.test('getConfig environment variable modes - uses TAKOS_WORKSPACE_ID from environment in session mode', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  process.env.TAKOS_SESSION_ID = validSessionId;
    process.env.TAKOS_WORKSPACE_ID = 'my-workspace';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.workspaceId, 'my-workspace');
    assertEquals(config.spaceId, 'my-workspace');
  } finally {
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
  }
})
  Deno.test('getConfig environment variable modes - uses custom TAKOS_API_URL from environment', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  process.env.TAKOS_SESSION_ID = validSessionId;
    process.env.TAKOS_API_URL = 'https://api.takos.dev';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.apiUrl, 'https://api.takos.dev');
  } finally {
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
  }
})
  Deno.test('getConfig environment variable modes - throws on invalid TAKOS_SESSION_ID format', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  process.env.TAKOS_SESSION_ID = 'invalid!@#';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    assertThrows(() => { () => getConfig(); }, 'Invalid TAKOS_SESSION_ID format');
  } finally {
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
  }
})
  Deno.test('getConfig environment variable modes - throws on invalid TAKOS_WORKSPACE_ID format', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  process.env.TAKOS_SESSION_ID = validSessionId;
    process.env.TAKOS_WORKSPACE_ID = 'invalid workspace!@#$';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    assertThrows(() => { () => getConfig(); }, 'Invalid TAKOS_WORKSPACE_ID format');
  } finally {
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
  }
})
  Deno.test('getConfig environment variable modes - throws on invalid TAKOS_API_URL domain', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  process.env.TAKOS_SESSION_ID = validSessionId;
    process.env.TAKOS_API_URL = 'https://evil.example.com';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    assertThrows(() => { () => getConfig(); }, 'Invalid TAKOS_API_URL');
  } finally {
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
  }
})
  Deno.test('getConfig environment variable modes - prefers TAKOS_SESSION_ID over TAKOS_TOKEN', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  process.env.TAKOS_SESSION_ID = validSessionId;
    process.env.TAKOS_TOKEN = 'my-token';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.sessionId, validSessionId);
    assertEquals(config.token, undefined);
  } finally {
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
  }
})
// ---------------------------------------------------------------------------
// getConfig - session file mode
// ---------------------------------------------------------------------------


  const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

  Deno.test('getConfig session file mode - reads session from file', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-file',
    }));
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.sessionId, validSessionId);
    assertEquals(config.workspaceId, 'ws-file');
    assertEquals(config.spaceId, 'ws-file');
  } finally {
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
  }
})
  Deno.test('getConfig session file mode - falls back to default API URL when session file has no api_url', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
    }));
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.apiUrl, DEFAULT_API_URL);
  } finally {
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
  }
})
  Deno.test('getConfig session file mode - uses session file api_url when valid', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
      api_url: 'https://api.takos.dev',
    }));
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.apiUrl, 'https://api.takos.dev');
  } finally {
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
  }
})
// ---------------------------------------------------------------------------
// getConfig - external config mode
// ---------------------------------------------------------------------------


  Deno.test('getConfig external config mode - reads token from config file', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  confMock._store['token'] = 'stored-token';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.token, 'stored-token');
    assertEquals(config.apiUrl, DEFAULT_API_URL);
  } finally {
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
  }
})
  Deno.test('getConfig external config mode - uses configured API URL from config', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  confMock._store['apiUrl'] = 'https://takos.io';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.apiUrl, 'https://takos.io');
  } finally {
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
  }
})
  Deno.test('getConfig external config mode - falls back to default API URL for invalid domain in config', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  confMock._store['apiUrl'] = 'https://evil.example.com';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    const config = getConfig();
    assertEquals(config.apiUrl, DEFAULT_API_URL);
  } finally {
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
  }
})
// ---------------------------------------------------------------------------
// isAuthenticated
// ---------------------------------------------------------------------------


  Deno.test('isAuthenticated - returns true when token is present', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  process.env.TAKOS_TOKEN = 'some-token';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    assertEquals(isAuthenticated(), true);
  } finally {
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
  }
})
  Deno.test('isAuthenticated - returns true when session ID is present', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  process.env.TAKOS_SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';
    const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    assertEquals(isAuthenticated(), true);
  } finally {
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
  }
})
  Deno.test('isAuthenticated - returns false when no auth configured', () => {
  originalEnv = {} as Record<ManagedEnvVar, string | undefined>;
  for (const envVar of MANAGED_ENV_VARS) {
    originalEnv[envVar] = process.env[envVar];
    delete process.env[envVar];
  }
  originalCwd = process.cwd();
  tempDirs = [];
  confMock._reset();
  /* mocks cleared (no-op in Deno) */ void 0;
  try {
  const dir = mkdtempSync(join(tmpdir(), 'takos-cli-auth-'));
    tempDirs.push(dir);
    process.chdir(dir);

    assertEquals(isAuthenticated(), false);
  } finally {
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
  }
})