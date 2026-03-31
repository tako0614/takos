import { mkdtempSync, rmSync, writeFileSync, chmodSync, symlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { findSessionFile, isWindows, setSecurePermissions } from '../src/lib/config-session-io.ts';

import { assertEquals, assertNotEquals } from 'jsr:@std/assert';

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
// ---------------------------------------------------------------------------
// isWindows
// ---------------------------------------------------------------------------


  Deno.test('isWindows - returns boolean based on platform', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  assertEquals(typeof isWindows(), 'boolean');
    // On test platform, we know what this should be
    assertEquals(isWindows(), platform() === 'win32');
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
// ---------------------------------------------------------------------------
// findSessionFile - basic discovery
// ---------------------------------------------------------------------------


  const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

  Deno.test('findSessionFile - returns null when no session file exists', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    process.chdir(dir);
    assertEquals(findSessionFile(), null);
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('findSessionFile - finds session file in current directory', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
    }));
    process.chdir(dir);

    const result = findSessionFile();
    assertNotEquals(result, null);
    assertEquals(result!.session_id, validSessionId);
    assertEquals(result!.workspace_id, 'ws-test');
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('findSessionFile - walks up directory tree to find session file', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const parentDir = createTempDir();
    createSessionFile(parentDir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-parent',
    }));

    const childDir = join(parentDir, 'child');
    mkdirSync(childDir, { recursive: true });
    process.chdir(childDir);

    const result = findSessionFile();
    assertNotEquals(result, null);
    assertEquals(result!.workspace_id, 'ws-parent');
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('findSessionFile - prefers closest session file in tree', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
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
    assertNotEquals(result, null);
    assertEquals(result!.workspace_id, 'ws-child');
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
// ---------------------------------------------------------------------------
// findSessionFile - validation
// ---------------------------------------------------------------------------


  const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

  Deno.test('findSessionFile validation - rejects session file with missing session_id', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({ workspace_id: 'ws-test' }));
    process.chdir(dir);

    assertEquals(findSessionFile(), null);
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('findSessionFile validation - rejects session file with non-string session_id', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: 123,
      workspace_id: 'ws-test',
    }));
    process.chdir(dir);

    assertEquals(findSessionFile(), null);
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('findSessionFile validation - rejects session file with invalid session_id format', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: 'invalid!@#$%',
      workspace_id: 'ws-test',
    }));
    process.chdir(dir);

    assertEquals(findSessionFile(), null);
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('findSessionFile validation - rejects session file with non-string workspace_id', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 123,
    }));
    process.chdir(dir);

    assertEquals(findSessionFile(), null);
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('findSessionFile validation - rejects session file with non-string api_url', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
      api_url: 123,
    }));
    process.chdir(dir);

    assertEquals(findSessionFile(), null);
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('findSessionFile validation - rejects session file with malformed api_url', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
      api_url: 'not a url',
    }));
    process.chdir(dir);

    assertEquals(findSessionFile(), null);
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('findSessionFile validation - clears invalid API domain from session file (falls back to empty)', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
      api_url: 'http://evil.example.com',
    }));
    process.chdir(dir);

    const result = findSessionFile();
    assertNotEquals(result, null);
    assertEquals(result!.api_url, '');
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('findSessionFile validation - preserves valid API URL from session file', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
      api_url: 'https://api.takos.dev',
    }));
    process.chdir(dir);

    const result = findSessionFile();
    assertNotEquals(result, null);
    assertEquals(result!.api_url, 'https://api.takos.dev');
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('findSessionFile validation - rejects invalid JSON in session file', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    createSessionFile(dir, '{invalid json}}}');
    process.chdir(dir);

    assertEquals(findSessionFile(), null);
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('findSessionFile validation - rejects non-object JSON in session file', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    createSessionFile(dir, '"just a string"');
    process.chdir(dir);

    assertEquals(findSessionFile(), null);
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('findSessionFile validation - handles empty workspace_id gracefully', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
    }));
    process.chdir(dir);

    const result = findSessionFile();
    assertNotEquals(result, null);
    assertEquals(result!.workspace_id, '');
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
// ---------------------------------------------------------------------------
// findSessionFile - permission checks (skip on Windows)
// ---------------------------------------------------------------------------

const describeUnix = platform() === 'win32' ? describe.skip : describe;

describeUnix('findSessionFile permission checks', () => {
  const validSessionId = '550e8400-e29b-41d4-a716-446655440000';

  Deno.test('rejects session file with world-readable permissions', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    const sessionPath = createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
    }), 0o644);
    process.chdir(dir);

    assertEquals(findSessionFile(), null);
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('rejects session file with group-readable permissions', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    const sessionPath = createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
    }), 0o640);
    process.chdir(dir);

    assertEquals(findSessionFile(), null);
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('accepts session file with mode 600', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    createSessionFile(dir, JSON.stringify({
      session_id: validSessionId,
      workspace_id: 'ws-test',
    }), 0o600);
    process.chdir(dir);

    const result = findSessionFile();
    assertNotEquals(result, null);
    assertEquals(result!.session_id, validSessionId);
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})});

// ---------------------------------------------------------------------------
// setSecurePermissions
// ---------------------------------------------------------------------------

describeUnix('setSecurePermissions', () => {
  Deno.test('does not throw for nonexistent file', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    try { () => setSecurePermissions(join(dir, 'nonexistent')); } catch (_e) { throw new Error('Expected no throw'); };
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})
  Deno.test('sets file to mode 600', () => {
  originalCwd = process.cwd();
  tempDirs = [];
  try {
  const dir = createTempDir();
    const filePath = join(dir, 'test-file');
    writeFileSync(filePath, 'test', { mode: 0o644 });

    setSecurePermissions(filePath);

    const { statSync } = require('fs');
    const mode = statSync(filePath).mode & 0o777;
    assertEquals(mode, 0o600);
  } finally {
  process.chdir(originalCwd);
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  }
})});
