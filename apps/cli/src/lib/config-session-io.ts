/**
 * Session file I/O: reading, validating, and locating .takos-session files.
 *
 * Extracted from config-auth.ts to isolate file-system concerns (permission
 * checks, schema validation, directory walking) from higher-level auth logic.
 */

import { platform } from 'os';
import { join, resolve } from 'path';
import {
  existsSync,
  chmodSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
} from 'fs';
import { logWarning } from './cli-log.js';
import { validateApiUrl, isValidId } from './config-validation.js';

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

/** File permissions: owner read/write only (rw-------) */
const SECURE_FILE_MODE = 0o600;

export function isWindows(): boolean {
  return platform() === 'win32';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionFile {
  session_id: string;
  workspace_id: string;
  api_url: string;
}

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/**
 * Check file permissions via an open file descriptor (avoids TOCTOU race).
 * Returns true if permissions are secure, false otherwise.
 *
 * On Windows the check is skipped because Windows uses ACLs instead of
 * Unix permission bits.
 */
function checkFilePermissionsFd(
  fd: number,
  filePath: string,
): { secure: boolean; warning?: string } {
  if (isWindows()) {
    return { secure: true };
  }

  try {
    const stats = fstatSync(fd);
    const mode = stats.mode & 0o777;

    const groupReadable = (mode & 0o040) !== 0;
    const othersReadable = (mode & 0o004) !== 0;
    const groupWritable = (mode & 0o020) !== 0;
    const othersWritable = (mode & 0o002) !== 0;

    if (groupReadable || othersReadable || groupWritable || othersWritable) {
      const permString = mode.toString(8).padStart(3, '0');
      return {
        secure: false,
        warning:
          `File permissions (${permString}) are too open. ` +
          `Session file should have mode 600 (owner read/write only). ` +
          `Run: chmod 600 "${filePath}"`,
      };
    }

    return { secure: true };
  } catch {
    // Cannot check permissions (e.g. unsupported OS/filesystem) — allow access
    // rather than blocking the user. The security check is best-effort.
    return { secure: true };
  }
}

export function setSecurePermissions(filePath: string): void {
  if (isWindows()) return;

  try {
    chmodSync(filePath, SECURE_FILE_MODE);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    logWarning(
      `Failed to set secure permissions on ${filePath}: ${errorMessage}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Session file validation
// ---------------------------------------------------------------------------

function validateSessionFile(
  data: unknown,
): { valid: boolean; error?: string; data?: SessionFile } {
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'Session file must be a JSON object' };
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.session_id !== 'string' || obj.session_id.length === 0) {
    return {
      valid: false,
      error: 'session_id is required and must be a non-empty string',
    };
  }

  if (!isValidId(obj.session_id)) {
    return {
      valid: false,
      error: 'session_id has invalid format (expected UUID or alphanumeric ID)',
    };
  }

  if (obj.workspace_id !== undefined && typeof obj.workspace_id !== 'string') {
    return { valid: false, error: 'workspace_id must be a string if provided' };
  }

  if (obj.api_url !== undefined) {
    if (typeof obj.api_url !== 'string') {
      return { valid: false, error: 'api_url must be a string if provided' };
    }
    try {
      new URL(obj.api_url);
    } catch {
      return { valid: false, error: 'api_url is not a valid URL' };
    }
  }

  return {
    valid: true,
    data: {
      session_id: obj.session_id,
      workspace_id:
        typeof obj.workspace_id === 'string' ? obj.workspace_id : '',
      api_url: typeof obj.api_url === 'string' ? obj.api_url : '',
    },
  };
}

// ---------------------------------------------------------------------------
// Session file reading
// ---------------------------------------------------------------------------

/**
 * Attempt to read and validate a single session file at the given path.
 * Returns the validated SessionFile, or null if the file is invalid/inaccessible.
 */
function tryReadSessionFile(sessionPath: string): SessionFile | null {
  let fd: number | undefined;
  try {
    fd = openSync(sessionPath, 'r');

    const permCheck = checkFilePermissionsFd(fd, sessionPath);
    if (!permCheck.secure) {
      logWarning(`SECURITY WARNING: ${permCheck.warning}`);
      logWarning('Refusing to read session file with insecure permissions.');
      closeSync(fd);
      return null;
    }

    const stats = fstatSync(fd);
    if (!stats.isFile()) {
      logWarning(
        `Session path ${sessionPath} is not a regular file; skipping.`,
      );
      closeSync(fd);
      return null;
    }

    const maxSize = 64 * 1024; // 64 KiB sanity cap
    if (stats.size > maxSize) {
      logWarning(
        `Session file at ${sessionPath} is unexpectedly large (${stats.size} bytes); skipping.`,
      );
      closeSync(fd);
      return null;
    }

    const buf = Buffer.allocUnsafe(stats.size);
    let bytesRead = 0;
    while (bytesRead < stats.size) {
      const n = readSync(fd, buf, bytesRead, stats.size - bytesRead, bytesRead);
      if (n === 0) break;
      bytesRead += n;
    }
    const content = buf.slice(0, bytesRead).toString('utf-8');
    closeSync(fd);
    fd = undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      logWarning(`Failed to parse session file at ${sessionPath}`);
      return null;
    }

    const validation = validateSessionFile(parsed);
    if (!validation.valid) {
      logWarning(
        `Invalid session file at ${sessionPath}: ${validation.error}`,
      );
      return null;
    }

    const sessionData = validation.data;
    if (!sessionData) {
      logWarning(`Session file validation returned no data: ${sessionPath}`);
      return null;
    }

    if (sessionData.api_url) {
      const domainValidation = validateApiUrl(sessionData.api_url);
      if (!domainValidation.valid) {
        logWarning(
          `Invalid API URL in session file: ${domainValidation.error}`,
        );
        sessionData.api_url = '';
      }
    }

    return sessionData;
  } catch (readError) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    const errorMessage =
      readError instanceof Error ? readError.message : 'Unknown read error';
    logWarning(
      `Failed to read session file at ${sessionPath}: ${errorMessage}`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session file discovery
// ---------------------------------------------------------------------------

/**
 * Search for .takos-session file in current and parent directories.
 * Walks up the directory tree until a valid session file is found or root is reached.
 */
export function findSessionFile(): SessionFile | null {
  let dir = resolve(process.cwd());
  let prevDir = '';

  while (dir !== prevDir) {
    const sessionPath = join(dir, '.takos-session');
    if (existsSync(sessionPath)) {
      const session = tryReadSessionFile(sessionPath);
      if (session !== null) {
        return session;
      }
    }
    prevDir = dir;
    dir = resolve(dir, '..');
  }

  return null;
}
