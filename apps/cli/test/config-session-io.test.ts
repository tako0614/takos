import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, symlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import { findSessionFile, isWindows, setSecurePermissions } from '../src/lib/config-session-io.js';

let originalCwd: string;
let tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'takos-cli-session-io-'));
  tempDirs.push(dir);
  return dir;
}

function createSessionFile(dir: string, content: string, mode?: number): string {
  const sessionPath = join(dir, '.takos-session');
  writeFileSync(sessionPath, content, { mode: mode ?? 0o600 });
  return sessionPath;
}

beforeEach(() => {
  originalCwd = process.cwd();
  tempDirs = [];
});

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// isWindows
// ---------------------------------------------------------------------------

describe('isWindows', () => {
  it('returns boolean based on platform', () => {
    expect(typeof isWindows()).toBe('boolean');
    // On test platform, we know what this should be
    expect(isWindows()).toBe(platform() === 'win32');
  });
});

// ---------------------------------------------------------------------------
// findSessionFile - basic discovery
// ---------------------------------------------------------------------------

describe('findSessionFile', () => {
  const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

  it('returns null when no session file exists', () => {
    const dir = createTempDir();
    process.chdir(dir);
    expect(findSessionFile()).toBeNull();
  });

  it('finds session file in current directory', () => {
    const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
    }));
    process.chdir(dir);

    const result = findSessionFile();
    expect(result).not.toBeNull();
    expect(result!.session_id).toBe(validSessionId);
    expect(result!.workspace_id).toBe('ws-test');
  });

  it('walks up directory tree to find session file', () => {
    const parentDir = createTempDir();
    createSessionFile(parentDir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-parent',
    }));

    const childDir = join(parentDir, 'child');
    mkdirSync(childDir, { recursive: true });
    process.chdir(childDir);

    const result = findSessionFile();
    expect(result).not.toBeNull();
    expect(result!.workspace_id).toBe('ws-parent');
  });

  it('prefers closest session file in tree', () => {
    const parentDir = createTempDir();
    createSessionFile(parentDir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-parent',
    }));

    const childDir = join(parentDir, 'child');
    mkdirSync(childDir, { recursive: true });
    createSessionFile(childDir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-child',
    }));

    process.chdir(childDir);
    const result = findSessionFile();
    expect(result).not.toBeNull();
    expect(result!.workspace_id).toBe('ws-child');
  });
});

// ---------------------------------------------------------------------------
// findSessionFile - validation
// ---------------------------------------------------------------------------

describe('findSessionFile validation', () => {
  const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

  it('rejects session file with missing session_id', () => {
    const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({ workspace_id: 'ws-test' }));
    process.chdir(dir);

    expect(findSessionFile()).toBeNull();
  });

  it('rejects session file with non-string session_id', () => {
    const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: 123,
      workspace_id: 'ws-test',
    }));
    process.chdir(dir);

    expect(findSessionFile()).toBeNull();
  });

  it('rejects session file with invalid session_id format', () => {
    const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: 'invalid!@#$%',
      workspace_id: 'ws-test',
    }));
    process.chdir(dir);

    expect(findSessionFile()).toBeNull();
  });

  it('rejects session file with non-string workspace_id', () => {
    const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 123,
    }));
    process.chdir(dir);

    expect(findSessionFile()).toBeNull();
  });

  it('rejects session file with non-string api_url', () => {
    const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
      api_url: 123,
    }));
    process.chdir(dir);

    expect(findSessionFile()).toBeNull();
  });

  it('rejects session file with malformed api_url', () => {
    const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
      api_url: 'not a url',
    }));
    process.chdir(dir);

    expect(findSessionFile()).toBeNull();
  });

  it('clears invalid API domain from session file (falls back to empty)', () => {
    const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
      api_url: 'http://evil.example.com',
    }));
    process.chdir(dir);

    const result = findSessionFile();
    expect(result).not.toBeNull();
    expect(result!.api_url).toBe('');
  });

  it('preserves valid API URL from session file', () => {
    const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
      api_url: 'https://api.takos.dev',
    }));
    process.chdir(dir);

    const result = findSessionFile();
    expect(result).not.toBeNull();
    expect(result!.api_url).toBe('https://api.takos.dev');
  });

  it('rejects invalid JSON in session file', () => {
    const dir = createTempDir();
    createSessionFile(dir, '{invalid json}}}');
    process.chdir(dir);

    expect(findSessionFile()).toBeNull();
  });

  it('rejects non-object JSON in session file', () => {
    const dir = createTempDir();
    createSessionFile(dir, '"just a string"');
    process.chdir(dir);

    expect(findSessionFile()).toBeNull();
  });

  it('handles empty workspace_id gracefully', () => {
    const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
    }));
    process.chdir(dir);

    const result = findSessionFile();
    expect(result).not.toBeNull();
    expect(result!.workspace_id).toBe('');
  });
});

// ---------------------------------------------------------------------------
// findSessionFile - permission checks (skip on Windows)
// ---------------------------------------------------------------------------

const describeUnix = platform() === 'win32' ? describe.skip : describe;

describeUnix('findSessionFile permission checks', () => {
  const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

  it('rejects session file with world-readable permissions', () => {
    const dir = createTempDir();
    const sessionPath = createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
    }), 0o644);
    process.chdir(dir);

    expect(findSessionFile()).toBeNull();
  });

  it('rejects session file with group-readable permissions', () => {
    const dir = createTempDir();
    const sessionPath = createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
    }), 0o640);
    process.chdir(dir);

    expect(findSessionFile()).toBeNull();
  });

  it('accepts session file with mode 600', () => {
    const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
    }), 0o600);
    process.chdir(dir);

    const result = findSessionFile();
    expect(result).not.toBeNull();
    expect(result!.session_id).toBe(validSessionId);
  });
});

// ---------------------------------------------------------------------------
// setSecurePermissions
// ---------------------------------------------------------------------------

describeUnix('setSecurePermissions', () => {
  it('does not throw for nonexistent file', () => {
    const dir = createTempDir();
    expect(() => setSecurePermissions(join(dir, 'nonexistent'))).not.toThrow();
  });

  it('sets file to mode 600', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'test-file');
    writeFileSync(filePath, 'test', { mode: 0o644 });

    setSecurePermissions(filePath);

    const { statSync } = require('fs');
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
