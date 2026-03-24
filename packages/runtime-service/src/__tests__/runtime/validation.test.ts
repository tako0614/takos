import { describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/config.js', () => ({
  ALLOWED_COMMANDS_SET: new Set([
    'npm', 'npx', 'node', 'pnpm', 'git', 'echo', 'ls', 'cat', 'curl', 'wget',
    'grep', 'find', 'sed', 'awk', 'tar', 'chmod',
  ]),
  COMMAND_BLOCKLIST_PATTERNS: [
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?[/\\]\*?\s*$/i,
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?[/\\]\s/i,
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?~[/\s]*$/i,
    /\breboot\b/i,
    /\bshutdown\b/i,
    /\bpoweroff\b/i,
    /\bhalt\b/i,
    /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/,
    /\bdd\b.*\bof=\/dev\//i,
    /\bmkfs\b/i,
    /\bchmod\s+(-[a-zA-Z]*\s+)?[0-7]*777\s+[/\\]/i,
    /\bmount\b/i,
    /\bumount\b/i,
    /\b(curl|wget)\b.*\b169\.254\.169\.254\b/i,
    /\b(curl|wget)\b.*\bmetadata\.google\.internal\b/i,
    /\b(curl|wget)\b.*\b100\.100\.100\.200\b/i,
    /\b(curl|wget)\b.*\bfd00::1\b/i,
  ],
}));

import {
  validateCommandLine,
  isProbablyBinary,
  isValidSessionId,
  getWorkerResourceLimits,
  validateGitRef,
  validateGitPath,
  validateGitAuthorName,
  validateGitAuthorEmail,
  validateGitName,
  validateWorkspaceId,
  validateNameParam,
  validateCommand,
} from '../../runtime/validation.js';

// ---------------------------------------------------------------------------
// validateCommandLine
// ---------------------------------------------------------------------------

describe('validateCommandLine', () => {
  it('accepts valid command', () => {
    expect(() => validateCommandLine('echo hello')).not.toThrow();
  });

  it('rejects empty command', () => {
    expect(() => validateCommandLine('')).toThrow('Invalid command');
    expect(() => validateCommandLine('   ')).toThrow('Invalid command');
  });

  it('rejects null bytes in command', () => {
    expect(() => validateCommandLine('echo\u0000hello')).toThrow('Invalid command');
  });

  it('rejects reboot command', () => {
    expect(() => validateCommandLine('reboot')).toThrow('Dangerous command');
  });

  it('rejects shutdown command', () => {
    expect(() => validateCommandLine('shutdown -h now')).toThrow('Dangerous command');
  });

  it('rejects fork bomb patterns', () => {
    expect(() => validateCommandLine(':() { : | : & }')).toThrow('Dangerous command');
  });

  it('rejects dd to device', () => {
    expect(() => validateCommandLine('dd if=/dev/zero of=/dev/sda')).toThrow('Dangerous command');
  });
});

// ---------------------------------------------------------------------------
// isProbablyBinary
// ---------------------------------------------------------------------------

describe('isProbablyBinary', () => {
  it('returns false for empty buffer', () => {
    expect(isProbablyBinary(Buffer.alloc(0))).toBe(false);
  });

  it('returns true for null byte', () => {
    expect(isProbablyBinary(Buffer.from([0x00, 0x41, 0x42]))).toBe(true);
  });

  it('returns false for regular text', () => {
    expect(isProbablyBinary(Buffer.from('Hello, world! This is normal text.'))).toBe(false);
  });

  it('returns true for high ratio of suspicious bytes', () => {
    // Create buffer with many control characters
    const buf = Buffer.alloc(100);
    for (let i = 0; i < 100; i++) {
      buf[i] = i % 3 === 0 ? 0x01 : 0x41; // mix control chars and 'A'
    }
    expect(isProbablyBinary(buf)).toBe(true);
  });

  it('returns false for buffer with few suspicious bytes', () => {
    const text = 'Hello world with tab\there\n';
    expect(isProbablyBinary(Buffer.from(text))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isValidSessionId
// ---------------------------------------------------------------------------

describe('isValidSessionId', () => {
  it('accepts valid alphanumeric session ID (16+ chars)', () => {
    expect(isValidSessionId('abcdefghijklmnop')).toBe(true);
  });

  it('accepts session ID with hyphens and underscores', () => {
    expect(isValidSessionId('abc-def_ghi-jklmnop')).toBe(true);
  });

  it('rejects too-short session ID', () => {
    expect(isValidSessionId('abc')).toBe(false);
  });

  it('rejects session ID starting with hyphen', () => {
    expect(isValidSessionId('-abcdefghijklmnop')).toBe(false);
  });

  it('rejects session ID ending with hyphen', () => {
    expect(isValidSessionId('abcdefghijklmnop-')).toBe(false);
  });

  it('rejects session ID with consecutive separators', () => {
    expect(isValidSessionId('abcdefg--hijklmnop')).toBe(false);
  });

  it('rejects non-string input', () => {
    // @ts-expect-error testing runtime behavior
    expect(isValidSessionId(123)).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidSessionId('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getWorkerResourceLimits
// ---------------------------------------------------------------------------

describe('getWorkerResourceLimits', () => {
  it('returns undefined when maxMemory is falsy', () => {
    expect(getWorkerResourceLimits(0)).toBeUndefined();
    expect(getWorkerResourceLimits(undefined)).toBeUndefined();
  });

  it('clamps to minimum of 16 MB', () => {
    expect(getWorkerResourceLimits(4)).toEqual({ maxOldGenerationSizeMb: 16 });
  });

  it('clamps to maximum of 512 MB', () => {
    expect(getWorkerResourceLimits(1024)).toEqual({ maxOldGenerationSizeMb: 512 });
  });

  it('floors the value', () => {
    expect(getWorkerResourceLimits(256.7)).toEqual({ maxOldGenerationSizeMb: 256 });
  });

  it('accepts values in range', () => {
    expect(getWorkerResourceLimits(128)).toEqual({ maxOldGenerationSizeMb: 128 });
  });
});

// ---------------------------------------------------------------------------
// validateGitRef
// ---------------------------------------------------------------------------

describe('validateGitRef', () => {
  it('accepts valid branch name', () => {
    expect(() => validateGitRef('main')).not.toThrow();
    expect(() => validateGitRef('feature/new-thing')).not.toThrow();
  });

  it('accepts commit hash', () => {
    expect(() => validateGitRef('abc123def456')).not.toThrow();
  });

  it('accepts tags', () => {
    expect(() => validateGitRef('v1.0.0')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validateGitRef('')).toThrow('Git ref is required');
  });

  it('rejects ref starting with dot', () => {
    expect(() => validateGitRef('.hidden')).toThrow('Git ref format is invalid');
  });

  it('rejects ref ending with dot', () => {
    expect(() => validateGitRef('branch.')).toThrow('Git ref format is invalid');
  });

  it('rejects ref with double dots', () => {
    expect(() => validateGitRef('branch..name')).toThrow('Git ref format is invalid');
  });

  it('rejects ref starting with dash', () => {
    expect(() => validateGitRef('-flag')).toThrow('Git ref must not start with a dash');
  });

  it('rejects ref ending with .lock', () => {
    expect(() => validateGitRef('branch.lock')).toThrow('Git ref must not end with .lock');
  });

  it('rejects ref starting with colon', () => {
    expect(() => validateGitRef(':ref')).toThrow('Git ref must not start with a colon');
  });

  it('rejects ref ending with slash', () => {
    expect(() => validateGitRef('branch/')).toThrow('Git ref must not end with a slash');
  });

  it('rejects ref with whitespace', () => {
    expect(() => validateGitRef('branch name')).toThrow('Git ref must not contain whitespace');
  });

  it('rejects ref with backslash', () => {
    expect(() => validateGitRef('branch\\name')).toThrow('Git ref contains invalid characters');
  });

  it('rejects ref with control characters', () => {
    expect(() => validateGitRef('branch\u0001name')).toThrow();
  });

  it('rejects ref with @{ sequence', () => {
    expect(() => validateGitRef('branch@{0}')).toThrow('Git ref format is invalid');
  });

  it('rejects ref exceeding 256 characters', () => {
    expect(() => validateGitRef('a'.repeat(257))).toThrow('Git ref too long');
  });
});

// ---------------------------------------------------------------------------
// validateGitPath
// ---------------------------------------------------------------------------

describe('validateGitPath', () => {
  it('accepts valid file path', () => {
    expect(() => validateGitPath('src/index.ts')).not.toThrow();
  });

  it('accepts filename with dots', () => {
    expect(() => validateGitPath('package.json')).not.toThrow();
  });

  it('accepts empty path (no file)', () => {
    expect(() => validateGitPath('')).not.toThrow();
  });

  it('rejects path traversal with ..', () => {
    expect(() => validateGitPath('../etc/passwd')).toThrow('Path traversal not allowed');
  });

  it('rejects absolute path', () => {
    expect(() => validateGitPath('/etc/passwd')).toThrow('Path traversal not allowed');
  });

  it('rejects Windows absolute path', () => {
    expect(() => validateGitPath('C:\\Windows\\System32')).toThrow('Path traversal not allowed');
  });

  it('rejects control characters', () => {
    expect(() => validateGitPath('file\u0000name')).toThrow('contains invalid characters');
  });

  it('rejects path exceeding 4096 characters', () => {
    expect(() => validateGitPath('a'.repeat(4097))).toThrow('Git path too long');
  });

  it('rejects non-string input', () => {
    // @ts-expect-error testing runtime behavior
    expect(() => validateGitPath(123)).toThrow('Git path must be a string');
  });
});

// ---------------------------------------------------------------------------
// validateGitAuthorName
// ---------------------------------------------------------------------------

describe('validateGitAuthorName', () => {
  it('accepts valid name', () => {
    expect(() => validateGitAuthorName('John Doe')).not.toThrow();
  });

  it('rejects empty name', () => {
    expect(() => validateGitAuthorName('')).toThrow('Author name is required');
  });

  it('rejects name with angle brackets', () => {
    expect(() => validateGitAuthorName('John <script>')).toThrow('disallowed characters');
  });

  it('rejects name with shell metacharacters', () => {
    expect(() => validateGitAuthorName('John; rm -rf /')).toThrow('disallowed characters');
  });

  it('rejects name exceeding 256 characters', () => {
    expect(() => validateGitAuthorName('a'.repeat(257))).toThrow('Author name too long');
  });

  it('rejects name with control characters', () => {
    expect(() => validateGitAuthorName('name\u0000test')).toThrow('contains invalid characters');
  });
});

// ---------------------------------------------------------------------------
// validateGitAuthorEmail
// ---------------------------------------------------------------------------

describe('validateGitAuthorEmail', () => {
  it('accepts valid email', () => {
    expect(() => validateGitAuthorEmail('user@example.com')).not.toThrow();
  });

  it('rejects empty email', () => {
    expect(() => validateGitAuthorEmail('')).toThrow('Author email is required');
  });

  it('rejects invalid email format', () => {
    expect(() => validateGitAuthorEmail('not-an-email')).toThrow('Author email format is invalid');
  });

  it('rejects email exceeding 256 characters', () => {
    expect(() => validateGitAuthorEmail('a'.repeat(260) + '@b.com')).toThrow('Author email too long');
  });

  it('rejects email with control characters', () => {
    expect(() => validateGitAuthorEmail('user\u0000@test.com')).toThrow('contains invalid characters');
  });
});

// ---------------------------------------------------------------------------
// validateGitName
// ---------------------------------------------------------------------------

describe('validateGitName', () => {
  it('accepts valid name', () => {
    expect(validateGitName('my-repo')).toBe('my-repo');
  });

  it('accepts single character', () => {
    expect(validateGitName('a')).toBe('a');
  });

  it('accepts name with underscore', () => {
    expect(validateGitName('my_repo')).toBe('my_repo');
  });

  it('rejects empty string', () => {
    expect(validateGitName('')).toBeNull();
  });

  it('rejects name exceeding 128 characters', () => {
    expect(validateGitName('a'.repeat(129))).toBeNull();
  });

  it('rejects name with path traversal', () => {
    expect(validateGitName('../secret')).toBeNull();
  });

  it('rejects name with forward slash', () => {
    expect(validateGitName('path/to/repo')).toBeNull();
  });

  it('rejects name with backslash', () => {
    expect(validateGitName('path\\to')).toBeNull();
  });

  it('rejects name with control characters', () => {
    expect(validateGitName('name\u0000evil')).toBeNull();
  });

  it('rejects URL-encoded traversal', () => {
    expect(validateGitName('%2e%2e')).toBeNull();
  });

  it('rejects consecutive underscores', () => {
    expect(validateGitName('my__repo')).toBeNull();
  });

  it('rejects consecutive hyphens', () => {
    expect(validateGitName('my--repo')).toBeNull();
  });

  it('rejects name starting with underscore', () => {
    expect(validateGitName('_repo')).toBeNull();
  });

  it('rejects name starting with hyphen', () => {
    expect(validateGitName('-repo')).toBeNull();
  });

  it('rejects non-string input', () => {
    // @ts-expect-error testing runtime behavior
    expect(validateGitName(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateWorkspaceId
// ---------------------------------------------------------------------------

describe('validateWorkspaceId', () => {
  it('accepts valid workspace ID', () => {
    expect(validateWorkspaceId('ws123')).toBe('ws123');
  });

  it('accepts ID with hyphens', () => {
    expect(validateWorkspaceId('my-workspace')).toBe('my-workspace');
  });

  it('throws on empty string', () => {
    expect(() => validateWorkspaceId('')).toThrow('space_id is required');
  });

  it('throws on invalid format', () => {
    expect(() => validateWorkspaceId('!invalid')).toThrow('Invalid space_id format');
  });

  it('throws on non-string', () => {
    // @ts-expect-error testing runtime behavior
    expect(() => validateWorkspaceId(null)).toThrow('space_id is required');
  });
});

// ---------------------------------------------------------------------------
// validateNameParam
// ---------------------------------------------------------------------------

describe('validateNameParam', () => {
  it('returns null for valid name', () => {
    expect(validateNameParam('my-repo', 'repo')).toBeNull();
  });

  it('returns error for missing name', () => {
    expect(validateNameParam(undefined, 'repo')).toBe('repo is required');
    expect(validateNameParam('', 'repo')).toBe('repo is required');
  });

  it('returns error for invalid format', () => {
    expect(validateNameParam('!invalid', 'repo')).toBe('Invalid repo format');
  });
});

// ---------------------------------------------------------------------------
// validateCommand
// ---------------------------------------------------------------------------

describe('validateCommand', () => {
  it('returns null for valid allowed command', () => {
    expect(validateCommand('npm install')).toBeNull();
  });

  it('returns null for allowed command with arguments', () => {
    expect(validateCommand('git commit -m "message"')).toBeNull();
  });

  it('returns error for empty command', () => {
    expect(validateCommand('')).toBe('Command is empty or invalid');
  });

  it('returns error for whitespace-only command', () => {
    expect(validateCommand('   ')).toBe('Command is empty or invalid');
  });

  it('returns error for too-long command', () => {
    expect(validateCommand('a'.repeat(100001))).toBe('Command is too long');
  });

  it('returns error for shell metacharacters', () => {
    const result = validateCommand('echo hello | grep world');
    expect(result).toContain('shell metacharacters');
  });

  it('returns error for disallowed command', () => {
    const result = validateCommand('python3 script.py');
    expect(result).toContain('Command not allowed');
  });

  it('accepts relative path commands', () => {
    expect(validateCommand('./my-script')).toBeNull();
  });

  it('returns error for control characters', () => {
    expect(validateCommand('echo\u0001hello')).toBe('Command contains invalid control characters');
  });

  it('allows comments in multiline commands', () => {
    expect(validateCommand('# This is a comment\nnpm install')).toBeNull();
  });

  it('blocks SSRF attempts via curl', () => {
    const result = validateCommand('curl http://169.254.169.254/latest/meta-data/');
    expect(result).toContain('dangerous patterns');
  });

  it('blocks SSRF attempts via wget', () => {
    const result = validateCommand('wget http://metadata.google.internal/computeMetadata/v1/');
    expect(result).toContain('dangerous patterns');
  });
});
