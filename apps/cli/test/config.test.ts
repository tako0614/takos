import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getConfig,
  getApiRequestTimeoutMs,
  getLoginTimeoutMs,
  validateApiUrl,
} from '../src/lib/config.js';

const MANAGED_ENV_VARS = [
  'TAKOS_TIMEOUT_MS',
  'TAKOS_API_TIMEOUT_MS',
  'TAKOS_LOGIN_TIMEOUT_MS',
  'TAKOS_SESSION_ID',
  'TAKOS_TOKEN',
  'TAKOS_API_URL',
  'TAKOS_WORKSPACE_ID',
] as const;

type ManagedEnvVar = typeof MANAGED_ENV_VARS[number];
let originalEnv: Record<ManagedEnvVar, string | undefined>;
let originalCwd: string;
let tempDirs: string[] = [];

function createSessionWorkspace(sessionJson: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'takos-cli-config-'));
  writeFileSync(join(dir, '.takos-session'), sessionJson, { mode: 0o600 });
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  originalEnv = {
    TAKOS_TIMEOUT_MS: process.env.TAKOS_TIMEOUT_MS,
    TAKOS_API_TIMEOUT_MS: process.env.TAKOS_API_TIMEOUT_MS,
    TAKOS_LOGIN_TIMEOUT_MS: process.env.TAKOS_LOGIN_TIMEOUT_MS,
    TAKOS_SESSION_ID: process.env.TAKOS_SESSION_ID,
    TAKOS_TOKEN: process.env.TAKOS_TOKEN,
    TAKOS_API_URL: process.env.TAKOS_API_URL,
    TAKOS_WORKSPACE_ID: process.env.TAKOS_WORKSPACE_ID,
  };

  originalCwd = process.cwd();
  tempDirs = [];

  for (const envVar of MANAGED_ENV_VARS) {
    delete process.env[envVar];
  }
});

afterEach(() => {
  process.chdir(originalCwd);

  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }

  for (const envVar of MANAGED_ENV_VARS) {
    const originalValue = originalEnv[envVar];
    if (originalValue === undefined) {
      delete process.env[envVar];
    } else {
      process.env[envVar] = originalValue;
    }
  }
});

describe('validateApiUrl policy', () => {
  it('accepts HTTPS URLs on allowed domains', () => {
    const result = validateApiUrl('https://api.takos.dev');
    expect(result.valid).toBe(true);
  });

  it('rejects HTTP on non-localhost domains', () => {
    const result = validateApiUrl('http://api.takos.dev');
    expect(result.valid).toBe(false);
  });

  it('allows localhost HTTP and marks it as insecure', () => {
    const result = validateApiUrl('http://127.10.20.30:8787');
    expect(result.valid).toBe(true);
    expect(result.insecureLocalhostHttp).toBe(true);
  });

  it('rejects non-HTTP(S) schemes on non-localhost', () => {
    const result = validateApiUrl('ftp://api.takos.dev');
    expect(result.valid).toBe(false);
  });

  it('rejects URLs with embedded credentials', () => {
    const result = validateApiUrl('https://user:pass@api.takos.jp');
    expect(result.valid).toBe(false);
  });
});

describe('session file mode', () => {
  const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

  it('falls back to default API URL when session file omits api_url', () => {
    const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-demo',
    }));

    process.chdir(dir);

    const config = getConfig();
    expect(config).toEqual({
      apiUrl: 'https://takos.jp',
      sessionId: validSessionId,
      workspaceId: 'ws-demo',
      spaceId: 'ws-demo',
    });
  });

  it('falls back to default API URL when session file api_url has invalid domain', () => {
    const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-demo',
      api_url: 'http://api.example.com',
    }));

    process.chdir(dir);

    const config = getConfig();
    expect(config).toEqual({
      apiUrl: 'https://takos.jp',
      sessionId: validSessionId,
      workspaceId: 'ws-demo',
      spaceId: 'ws-demo',
    });
  });

  it('uses session file api_url when schema and policy are valid', () => {
    const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-demo',
      api_url: 'https://api.takos.dev',
    }));

    process.chdir(dir);

    const config = getConfig();
    expect(config).toEqual({
      apiUrl: 'https://api.takos.dev',
      sessionId: validSessionId,
      workspaceId: 'ws-demo',
      spaceId: 'ws-demo',
    });
  });

  it('uses session file api_url in session file mode regardless of TAKOS_API_URL', () => {
    const dir = createSessionWorkspace(JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-demo',
      api_url: 'https://api.takos.dev',
    }));
    process.chdir(dir);

    process.env.TAKOS_API_URL = 'https://api.takos.jp';

    const config = getConfig();
    expect(config).toEqual({
      apiUrl: 'https://api.takos.dev',
      sessionId: validSessionId,
      workspaceId: 'ws-demo',
      spaceId: 'ws-demo',
    });
  });
});

describe('timeout resolution', () => {
  it('uses defaults when env vars are not set', () => {
    expect(getApiRequestTimeoutMs()).toBe(30_000);
    expect(getLoginTimeoutMs()).toBe(5 * 60_000);
  });

  it('uses shared timeout when specific vars are missing', () => {
    process.env.TAKOS_TIMEOUT_MS = '45000';

    expect(getApiRequestTimeoutMs()).toBe(45_000);
    expect(getLoginTimeoutMs()).toBe(45_000);
  });

  it('prefers specific timeout vars over the shared timeout', () => {
    process.env.TAKOS_TIMEOUT_MS = '45000';
    process.env.TAKOS_API_TIMEOUT_MS = '12000';
    process.env.TAKOS_LOGIN_TIMEOUT_MS = '180000';

    expect(getApiRequestTimeoutMs()).toBe(12_000);
    expect(getLoginTimeoutMs()).toBe(180_000);
  });
});
