import { ALLOWED_COMMANDS_SET, COMMAND_BLOCKLIST_PATTERNS } from '../shared/config.ts';
import { createLogger } from 'takos-common/logger';
import { Buffer } from "node:buffer";

/**
 * Matches all C0 control characters (0x00-0x1F) plus DEL (0x7F).
 * Used for security-sensitive inputs (git paths, author names, emails)
 * where any control character is potentially dangerous.
 *
 * This is intentionally broader than LINE_UNSAFE_CHARS_PATTERN in
 * actions/builtin/constants.ts, which only rejects null/CR/LF for
 * line-oriented key/name formats.
 */
// eslint-disable-next-line no-control-regex
const ALL_CONTROL_CHARS_PATTERN = /[\x00-\x1f\x7f]/;
const STRICT_SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|[-_](?![-_])){14,126}[A-Za-z0-9]$/;
const VALID_GIT_REF_PATTERN = /^[A-Za-z0-9_./@^~:-]+$/;
const VALID_GIT_PATH_PATTERN = /^[A-Za-z0-9_.@/-]+$/;
const VALID_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
}

function requireMaxLength(value: string, maxLength: number, label: string): void {
  if (value.length > maxLength) {
    throw new Error(`${label} too long`);
  }
}

function rejectControlChars(value: string, label: string): void {
  if (ALL_CONTROL_CHARS_PATTERN.test(value)) {
    throw new Error(`${label} contains invalid characters`);
  }
}

export function validateCommandLine(commandLine: string): void {
  const trimmed = commandLine.trim();
  if (trimmed.length === 0 || /\0/.test(trimmed)) {
    throw new Error('Invalid command');
  }
  for (const pattern of COMMAND_BLOCKLIST_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new Error('Dangerous command arguments detected');
    }
  }
}

export function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const sampleSize = Math.min(buffer.length, 8000);
  let suspicious = 0;
  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32)) {
      suspicious++;
    }
  }
  return suspicious / sampleSize > 0.3;
}

export function isValidSessionId(sessionId: string): boolean {
  return typeof sessionId === 'string' && STRICT_SESSION_ID_PATTERN.test(sessionId);
}

export function getWorkerResourceLimits(maxMemory?: number): { maxOldGenerationSizeMb: number } | undefined {
  if (!maxMemory) return undefined;
  return { maxOldGenerationSizeMb: Math.max(16, Math.min(Math.floor(maxMemory), 512)) };
}

/**
 * Validate git ref (branch name, tag, commit hash).
 * Git commands are executed via spawn() with array args, so shell injection is not possible.
 * We only validate for Git's own ref format requirements (matching `git check-ref-format` rules).
 */
export function validateGitRef(ref: string): void {
  requireNonEmptyString(ref, 'Git ref');
  requireMaxLength(ref, 256, 'Git ref');
  // eslint-disable-next-line no-control-regex
  if (/\x00/.test(ref)) {
    throw new Error('Git ref contains invalid characters');
  }
  if (ref.startsWith('.') || ref.endsWith('.') || ref.includes('..') || ref.includes('@{')) {
    throw new Error('Git ref format is invalid');
  }
  if (ref.startsWith('-')) {
    throw new Error('Git ref must not start with a dash');
  }
  if (ref.includes('\\')) {
    throw new Error('Git ref contains invalid characters');
  }
  // Git forbids .lock suffix, leading colon, trailing slash, and space/tilde/caret/colon sequences
  if (ref.endsWith('.lock')) {
    throw new Error('Git ref must not end with .lock');
  }
  if (ref.startsWith(':')) {
    throw new Error('Git ref must not start with a colon');
  }
  if (ref.endsWith('/')) {
    throw new Error('Git ref must not end with a slash');
  }
  if (/\s/.test(ref)) {
    throw new Error('Git ref must not contain whitespace');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(ref)) {
    throw new Error('Git ref contains control characters');
  }
  if (!VALID_GIT_REF_PATTERN.test(ref)) {
    throw new Error('Git ref contains invalid characters');
  }
}

/**
 * Validate git path to prevent path traversal and command injection.
 * Allows: alphanumeric, dash, underscore, dot, slash (for subdirectories)
 * Disallows: path traversal (..), shell metacharacters, null bytes
 */
export function validateGitPath(filePath: string): void {
  if (typeof filePath !== 'string') {
    throw new Error('Git path must be a string');
  }
  requireMaxLength(filePath, 4096, 'Git path');
  rejectControlChars(filePath, 'Git path');
  if (filePath.includes('..') || filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)) {
    throw new Error('Path traversal not allowed');
  }
  if (filePath.length > 0 && !VALID_GIT_PATH_PATTERN.test(filePath)) {
    throw new Error('Git path contains invalid characters');
  }
}

/**
 * Validate git author name to prevent injection attacks.
 * Must be a reasonable name without shell metacharacters.
 */
export function validateGitAuthorName(name: string): void {
  requireNonEmptyString(name, 'Author name');
  requireMaxLength(name, 256, 'Author name');
  rejectControlChars(name, 'Author name');
  if (/[<>;&|`$(){}[\]\\"]/.test(name)) {
    throw new Error('Author name contains disallowed characters');
  }
}

/**
 * Validate git author email to prevent injection attacks.
 * Must be a valid email format.
 */
export function validateGitAuthorEmail(email: string): void {
  requireNonEmptyString(email, 'Author email');
  requireMaxLength(email, 256, 'Author email');
  rejectControlChars(email, 'Author email');
  if (!VALID_EMAIL_PATTERN.test(email)) {
    throw new Error('Author email format is invalid');
  }
}

// ---------------------------------------------------------------------------
// Git name / space-id validation
// ---------------------------------------------------------------------------

/**
 * Strict pattern: alphanumeric start/end, alphanumeric/underscore/hyphen middle.
 * No consecutive underscores or hyphens. Length enforced separately.
 */
const SAFE_NAME_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;

/**
 * Validates and sanitizes a space or repo name for use in git/HTTP paths.
 *
 * Valid names: 1-128 chars, alphanumeric start/end, middle allows underscore/hyphen,
 * no consecutive underscores or hyphens, no path traversal, no control characters.
 *
 * Returns the sanitized name or null if invalid.
 */
export function validateGitName(name: string): string | null {
  if (typeof name !== 'string' || name.length === 0 || name.length > 128) {
    return null;
  }

  // Reject null bytes, control characters, path traversal, and URL-encoded traversal
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(name)) return null;
  if (name.includes('..') || name.includes('/') || name.includes('\\')) return null;
  if (/%2e|%2f|%5c/i.test(name)) return null;
  if (/__|--/.test(name)) return null;

  if (!SAFE_NAME_PATTERN.test(name)) return null;

  return name;
}

/**
 * Pattern for space IDs: alphanumeric start, alphanumeric + underscore/hyphen middle, 1-128 chars total.
 * This is intentionally less strict than validateGitName (no consecutive-separator check, single-char allowed).
 */
const SPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * Validates a space ID.
 * Throws on invalid input, returns the validated ID string on success.
 */
export function validateSpaceId(spaceId: string): string {
  if (typeof spaceId !== 'string' || spaceId.length === 0) {
    throw new Error('space_id is required');
  }
  if (!SPACE_ID_PATTERN.test(spaceId)) {
    throw new Error('Invalid space_id format');
  }
  return spaceId;
}


/**
 * Validates a name parameter (space_id, repo_name, etc.) using SAFE_NAME_PATTERN.
 * Returns an error message string on failure, or null on success.
 */
export function validateNameParam(value: string | undefined, label: string): string | null {
  if (!value) return `${label} is required`;
  if (!SAFE_NAME_PATTERN.test(value)) return `Invalid ${label} format`;
  return null;
}

// ---------------------------------------------------------------------------
// --- Command validation ---
// ---------------------------------------------------------------------------

const commandValidationLogger = createLogger({ service: 'takos-runtime' });

const SHELL_METACHAR_PATTERN = /[|&;`$(){}]/;

function hasDisallowedShellMetacharacters(value: string): boolean {
  if (!SHELL_METACHAR_PATTERN.test(value)) {
    return false;
  }
  // Strip GitHub Actions expression syntax ${{ ... }} before checking.
  // This allows actions-style expressions while still blocking raw shell metacharacters.
  const stripped = value.replace(/\$\{\{[^}]*\}\}/g, '');
  if (!SHELL_METACHAR_PATTERN.test(stripped)) {
    return false;
  }
  // Any remaining shell metacharacter (including $VAR, ${VAR}, pipes, etc.) is disallowed.
  return true;
}

export function validateCommand(command: string): string | null {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return 'Command is empty or invalid';
  }

  if (command.length > 100000) {
    return 'Command is too long';
  }

  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(command)) {
    return 'Command contains invalid control characters';
  }

  const lines = command.split('\n').map(line => line.trim()).filter(line => line.length > 0 && !line.startsWith('#'));
  const combinedCommand = lines.join('\n');
  if (combinedCommand.length > 0 && hasDisallowedShellMetacharacters(combinedCommand)) {
    return 'Command contains shell metacharacters (|, &, ;, `, $, etc.) which are not allowed';
  }

  for (const line of lines) {
    if (hasDisallowedShellMetacharacters(line)) {
      return 'Command contains shell metacharacters (|, &, ;, `, $, etc.) which are not allowed';
    }

    for (const pattern of COMMAND_BLOCKLIST_PATTERNS) {
      if (pattern.test(line)) {
        return 'Command contains potentially dangerous patterns';
      }
    }

    const firstCommand = line.split(/\s+/)[0];
    const isAllowed = ALLOWED_COMMANDS_SET.has(firstCommand) ||
      firstCommand.startsWith('./') ||
      firstCommand.startsWith('.\\');

    if (!isAllowed) {
      commandValidationLogger.warn('Rejected unrecognized command', { command: firstCommand });
      return `Command not allowed: ${firstCommand}`;
    }
  }

  return null;
}
