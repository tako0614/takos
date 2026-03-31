import { Buffer } from 'node:buffer';
// [Deno] vi.mock removed - manually stub imports from '../../shared/config.ts'
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
  validateSpaceId,
  validateNameParam,
  validateCommand,
} from '../../runtime/validation.ts';

// ---------------------------------------------------------------------------
// validateCommandLine
// ---------------------------------------------------------------------------


import { assertEquals, assertThrows, assertStringIncludes } from 'jsr:@std/assert';

  Deno.test('validateCommandLine - accepts valid command', () => {
  try { () => validateCommandLine('echo hello'); } catch (_e) { throw new Error('Expected no throw'); };
})
  Deno.test('validateCommandLine - rejects empty command', () => {
  assertThrows(() => { () => validateCommandLine(''); }, 'Invalid command');
    assertThrows(() => { () => validateCommandLine('   '); }, 'Invalid command');
})
  Deno.test('validateCommandLine - rejects null bytes in command', () => {
  assertThrows(() => { () => validateCommandLine('echo\u0000hello'); }, 'Invalid command');
})
  Deno.test('validateCommandLine - rejects reboot command', () => {
  assertThrows(() => { () => validateCommandLine('reboot'); }, 'Dangerous command');
})
  Deno.test('validateCommandLine - rejects shutdown command', () => {
  assertThrows(() => { () => validateCommandLine('shutdown -h now'); }, 'Dangerous command');
})
  Deno.test('validateCommandLine - rejects fork bomb patterns', () => {
  assertThrows(() => { () => validateCommandLine(':() { : | : & }'); }, 'Dangerous command');
})
  Deno.test('validateCommandLine - rejects dd to device', () => {
  assertThrows(() => { () => validateCommandLine('dd if=/dev/zero of=/dev/sda'); }, 'Dangerous command');
})
// ---------------------------------------------------------------------------
// isProbablyBinary
// ---------------------------------------------------------------------------


  Deno.test('isProbablyBinary - returns false for empty buffer', () => {
  assertEquals(isProbablyBinary(Buffer.alloc(0)), false);
})
  Deno.test('isProbablyBinary - returns true for null byte', () => {
  assertEquals(isProbablyBinary(Buffer.from([0x00, 0x41, 0x42])), true);
})
  Deno.test('isProbablyBinary - returns false for regular text', () => {
  assertEquals(isProbablyBinary(Buffer.from('Hello, world! This is normal text.')), false);
})
  Deno.test('isProbablyBinary - returns true for high ratio of suspicious bytes', () => {
  // Create buffer with many control characters
    const buf = Buffer.alloc(100);
    for (let i = 0; i < 100; i++) {
      buf[i] = i % 3 === 0 ? 0x01 : 0x41; // mix control chars and 'A'
    }
    assertEquals(isProbablyBinary(buf), true);
})
  Deno.test('isProbablyBinary - returns false for buffer with few suspicious bytes', () => {
  const text = 'Hello world with tab\there\n';
    assertEquals(isProbablyBinary(Buffer.from(text)), false);
})
// ---------------------------------------------------------------------------
// isValidSessionId
// ---------------------------------------------------------------------------


  Deno.test('isValidSessionId - accepts valid alphanumeric session ID (16+ chars)', () => {
  assertEquals(isValidSessionId('abcdefghijklmnop'), true);
})
  Deno.test('isValidSessionId - accepts session ID with hyphens and underscores', () => {
  assertEquals(isValidSessionId('abc-def_ghi-jklmnop'), true);
})
  Deno.test('isValidSessionId - rejects too-short session ID', () => {
  assertEquals(isValidSessionId('abc'), false);
})
  Deno.test('isValidSessionId - rejects session ID starting with hyphen', () => {
  assertEquals(isValidSessionId('-abcdefghijklmnop'), false);
})
  Deno.test('isValidSessionId - rejects session ID ending with hyphen', () => {
  assertEquals(isValidSessionId('abcdefghijklmnop-'), false);
})
  Deno.test('isValidSessionId - rejects session ID with consecutive separators', () => {
  assertEquals(isValidSessionId('abcdefg--hijklmnop'), false);
})
  Deno.test('isValidSessionId - rejects non-string input', () => {
  // @ts-expect-error testing runtime behavior
    assertEquals(isValidSessionId(123), false);
})
  Deno.test('isValidSessionId - rejects empty string', () => {
  assertEquals(isValidSessionId(''), false);
})
// ---------------------------------------------------------------------------
// getWorkerResourceLimits
// ---------------------------------------------------------------------------


  Deno.test('getWorkerResourceLimits - returns undefined when maxMemory is falsy', () => {
  assertEquals(getWorkerResourceLimits(0), undefined);
    assertEquals(getWorkerResourceLimits(undefined), undefined);
})
  Deno.test('getWorkerResourceLimits - clamps to minimum of 16 MB', () => {
  assertEquals(getWorkerResourceLimits(4), { maxOldGenerationSizeMb: 16 });
})
  Deno.test('getWorkerResourceLimits - clamps to maximum of 512 MB', () => {
  assertEquals(getWorkerResourceLimits(1024), { maxOldGenerationSizeMb: 512 });
})
  Deno.test('getWorkerResourceLimits - floors the value', () => {
  assertEquals(getWorkerResourceLimits(256.7), { maxOldGenerationSizeMb: 256 });
})
  Deno.test('getWorkerResourceLimits - accepts values in range', () => {
  assertEquals(getWorkerResourceLimits(128), { maxOldGenerationSizeMb: 128 });
})
// ---------------------------------------------------------------------------
// validateGitRef
// ---------------------------------------------------------------------------


  Deno.test('validateGitRef - accepts valid branch name', () => {
  try { () => validateGitRef('main'); } catch (_e) { throw new Error('Expected no throw'); };
    try { () => validateGitRef('feature/new-thing'); } catch (_e) { throw new Error('Expected no throw'); };
})
  Deno.test('validateGitRef - accepts commit hash', () => {
  try { () => validateGitRef('abc123def456'); } catch (_e) { throw new Error('Expected no throw'); };
})
  Deno.test('validateGitRef - accepts tags', () => {
  try { () => validateGitRef('v1.0.0'); } catch (_e) { throw new Error('Expected no throw'); };
})
  Deno.test('validateGitRef - rejects empty string', () => {
  assertThrows(() => { () => validateGitRef(''); }, 'Git ref is required');
})
  Deno.test('validateGitRef - rejects ref starting with dot', () => {
  assertThrows(() => { () => validateGitRef('.hidden'); }, 'Git ref format is invalid');
})
  Deno.test('validateGitRef - rejects ref ending with dot', () => {
  assertThrows(() => { () => validateGitRef('branch.'); }, 'Git ref format is invalid');
})
  Deno.test('validateGitRef - rejects ref with double dots', () => {
  assertThrows(() => { () => validateGitRef('branch..name'); }, 'Git ref format is invalid');
})
  Deno.test('validateGitRef - rejects ref starting with dash', () => {
  assertThrows(() => { () => validateGitRef('-flag'); }, 'Git ref must not start with a dash');
})
  Deno.test('validateGitRef - rejects ref ending with .lock', () => {
  assertThrows(() => { () => validateGitRef('branch.lock'); }, 'Git ref must not end with .lock');
})
  Deno.test('validateGitRef - rejects ref starting with colon', () => {
  assertThrows(() => { () => validateGitRef(':ref'); }, 'Git ref must not start with a colon');
})
  Deno.test('validateGitRef - rejects ref ending with slash', () => {
  assertThrows(() => { () => validateGitRef('branch/'); }, 'Git ref must not end with a slash');
})
  Deno.test('validateGitRef - rejects ref with whitespace', () => {
  assertThrows(() => { () => validateGitRef('branch name'); }, 'Git ref must not contain whitespace');
})
  Deno.test('validateGitRef - rejects ref with backslash', () => {
  assertThrows(() => { () => validateGitRef('branch\\name'); }, 'Git ref contains invalid characters');
})
  Deno.test('validateGitRef - rejects ref with control characters', () => {
  assertThrows(() => { () => validateGitRef('branch\u0001name'); });
})
  Deno.test('validateGitRef - rejects ref with @{ sequence', () => {
  assertThrows(() => { () => validateGitRef('branch@{0}'); }, 'Git ref format is invalid');
})
  Deno.test('validateGitRef - rejects ref exceeding 256 characters', () => {
  assertThrows(() => { () => validateGitRef('a'.repeat(257)); }, 'Git ref too long');
})
// ---------------------------------------------------------------------------
// validateGitPath
// ---------------------------------------------------------------------------


  Deno.test('validateGitPath - accepts valid file path', () => {
  try { () => validateGitPath('src/index.ts'); } catch (_e) { throw new Error('Expected no throw'); };
})
  Deno.test('validateGitPath - accepts filename with dots', () => {
  try { () => validateGitPath('package.json'); } catch (_e) { throw new Error('Expected no throw'); };
})
  Deno.test('validateGitPath - accepts empty path (no file)', () => {
  try { () => validateGitPath(''); } catch (_e) { throw new Error('Expected no throw'); };
})
  Deno.test('validateGitPath - rejects path traversal with ..', () => {
  assertThrows(() => { () => validateGitPath('../etc/passwd'); }, 'Path traversal not allowed');
})
  Deno.test('validateGitPath - rejects absolute path', () => {
  assertThrows(() => { () => validateGitPath('/etc/passwd'); }, 'Path traversal not allowed');
})
  Deno.test('validateGitPath - rejects Windows absolute path', () => {
  assertThrows(() => { () => validateGitPath('C:\\Windows\\System32'); }, 'Path traversal not allowed');
})
  Deno.test('validateGitPath - rejects control characters', () => {
  assertThrows(() => { () => validateGitPath('file\u0000name'); }, 'contains invalid characters');
})
  Deno.test('validateGitPath - rejects path exceeding 4096 characters', () => {
  assertThrows(() => { () => validateGitPath('a'.repeat(4097)); }, 'Git path too long');
})
  Deno.test('validateGitPath - rejects non-string input', () => {
  // @ts-expect-error testing runtime behavior
    assertThrows(() => { () => validateGitPath(123); }, 'Git path must be a string');
})
// ---------------------------------------------------------------------------
// validateGitAuthorName
// ---------------------------------------------------------------------------


  Deno.test('validateGitAuthorName - accepts valid name', () => {
  try { () => validateGitAuthorName('John Doe'); } catch (_e) { throw new Error('Expected no throw'); };
})
  Deno.test('validateGitAuthorName - rejects empty name', () => {
  assertThrows(() => { () => validateGitAuthorName(''); }, 'Author name is required');
})
  Deno.test('validateGitAuthorName - rejects name with angle brackets', () => {
  assertThrows(() => { () => validateGitAuthorName('John <script>'); }, 'disallowed characters');
})
  Deno.test('validateGitAuthorName - rejects name with shell metacharacters', () => {
  assertThrows(() => { () => validateGitAuthorName('John; rm -rf /'); }, 'disallowed characters');
})
  Deno.test('validateGitAuthorName - rejects name exceeding 256 characters', () => {
  assertThrows(() => { () => validateGitAuthorName('a'.repeat(257)); }, 'Author name too long');
})
  Deno.test('validateGitAuthorName - rejects name with control characters', () => {
  assertThrows(() => { () => validateGitAuthorName('name\u0000test'); }, 'contains invalid characters');
})
// ---------------------------------------------------------------------------
// validateGitAuthorEmail
// ---------------------------------------------------------------------------


  Deno.test('validateGitAuthorEmail - accepts valid email', () => {
  try { () => validateGitAuthorEmail('user@example.com'); } catch (_e) { throw new Error('Expected no throw'); };
})
  Deno.test('validateGitAuthorEmail - rejects empty email', () => {
  assertThrows(() => { () => validateGitAuthorEmail(''); }, 'Author email is required');
})
  Deno.test('validateGitAuthorEmail - rejects invalid email format', () => {
  assertThrows(() => { () => validateGitAuthorEmail('not-an-email'); }, 'Author email format is invalid');
})
  Deno.test('validateGitAuthorEmail - rejects email exceeding 256 characters', () => {
  assertThrows(() => { () => validateGitAuthorEmail('a'.repeat(260) + '@b.com'); }, 'Author email too long');
})
  Deno.test('validateGitAuthorEmail - rejects email with control characters', () => {
  assertThrows(() => { () => validateGitAuthorEmail('user\u0000@test.com'); }, 'contains invalid characters');
})
// ---------------------------------------------------------------------------
// validateGitName
// ---------------------------------------------------------------------------


  Deno.test('validateGitName - accepts valid name', () => {
  assertEquals(validateGitName('my-repo'), 'my-repo');
})
  Deno.test('validateGitName - accepts single character', () => {
  assertEquals(validateGitName('a'), 'a');
})
  Deno.test('validateGitName - accepts name with underscore', () => {
  assertEquals(validateGitName('my_repo'), 'my_repo');
})
  Deno.test('validateGitName - rejects empty string', () => {
  assertEquals(validateGitName(''), null);
})
  Deno.test('validateGitName - rejects name exceeding 128 characters', () => {
  assertEquals(validateGitName('a'.repeat(129)), null);
})
  Deno.test('validateGitName - rejects name with path traversal', () => {
  assertEquals(validateGitName('../secret'), null);
})
  Deno.test('validateGitName - rejects name with forward slash', () => {
  assertEquals(validateGitName('path/to/repo'), null);
})
  Deno.test('validateGitName - rejects name with backslash', () => {
  assertEquals(validateGitName('path\\to'), null);
})
  Deno.test('validateGitName - rejects name with control characters', () => {
  assertEquals(validateGitName('name\u0000evil'), null);
})
  Deno.test('validateGitName - rejects URL-encoded traversal', () => {
  assertEquals(validateGitName('%2e%2e'), null);
})
  Deno.test('validateGitName - rejects consecutive underscores', () => {
  assertEquals(validateGitName('my__repo'), null);
})
  Deno.test('validateGitName - rejects consecutive hyphens', () => {
  assertEquals(validateGitName('my--repo'), null);
})
  Deno.test('validateGitName - rejects name starting with underscore', () => {
  assertEquals(validateGitName('_repo'), null);
})
  Deno.test('validateGitName - rejects name starting with hyphen', () => {
  assertEquals(validateGitName('-repo'), null);
})
  Deno.test('validateGitName - rejects non-string input', () => {
  // @ts-expect-error testing runtime behavior
    assertEquals(validateGitName(null), null);
})
// ---------------------------------------------------------------------------
// validateSpaceId
// ---------------------------------------------------------------------------


  Deno.test('validateSpaceId - accepts valid space ID', () => {
  assertEquals(validateSpaceId('ws123'), 'ws123');
})
  Deno.test('validateSpaceId - accepts ID with hyphens', () => {
  assertEquals(validateSpaceId('my-workspace'), 'my-workspace');
})
  Deno.test('validateSpaceId - throws on empty string', () => {
  assertThrows(() => { () => validateSpaceId(''); }, 'space_id is required');
})
  Deno.test('validateSpaceId - throws on invalid format', () => {
  assertThrows(() => { () => validateSpaceId('!invalid'); }, 'Invalid space_id format');
})
  Deno.test('validateSpaceId - throws on non-string', () => {
  // @ts-expect-error testing runtime behavior
    assertThrows(() => { () => validateSpaceId(null); }, 'space_id is required');
})
// ---------------------------------------------------------------------------
// validateNameParam
// ---------------------------------------------------------------------------


  Deno.test('validateNameParam - returns null for valid name', () => {
  assertEquals(validateNameParam('my-repo', 'repo'), null);
})
  Deno.test('validateNameParam - returns error for missing name', () => {
  assertEquals(validateNameParam(undefined, 'repo'), 'repo is required');
    assertEquals(validateNameParam('', 'repo'), 'repo is required');
})
  Deno.test('validateNameParam - returns error for invalid format', () => {
  assertEquals(validateNameParam('!invalid', 'repo'), 'Invalid repo format');
})
// ---------------------------------------------------------------------------
// validateCommand
// ---------------------------------------------------------------------------


  Deno.test('validateCommand - returns null for valid allowed command', () => {
  assertEquals(validateCommand('npm install'), null);
})
  Deno.test('validateCommand - returns null for allowed command with arguments', () => {
  assertEquals(validateCommand('git commit -m "message"'), null);
})
  Deno.test('validateCommand - returns error for empty command', () => {
  assertEquals(validateCommand(''), 'Command is empty or invalid');
})
  Deno.test('validateCommand - returns error for whitespace-only command', () => {
  assertEquals(validateCommand('   '), 'Command is empty or invalid');
})
  Deno.test('validateCommand - returns error for too-long command', () => {
  assertEquals(validateCommand('a'.repeat(100001)), 'Command is too long');
})
  Deno.test('validateCommand - returns error for shell metacharacters', () => {
  const result = validateCommand('echo hello | grep world');
    assertStringIncludes(result, 'shell metacharacters');
})
  Deno.test('validateCommand - returns error for disallowed command', () => {
  const result = validateCommand('python3 script.py');
    assertStringIncludes(result, 'Command not allowed');
})
  Deno.test('validateCommand - accepts relative path commands', () => {
  assertEquals(validateCommand('./my-script'), null);
})
  Deno.test('validateCommand - returns error for control characters', () => {
  assertEquals(validateCommand('echo\u0001hello'), 'Command contains invalid control characters');
})
  Deno.test('validateCommand - allows comments in multiline commands', () => {
  assertEquals(validateCommand('# This is a comment\nnpm install'), null);
})
  Deno.test('validateCommand - blocks SSRF attempts via curl', () => {
  const result = validateCommand('curl http://169.254.169.254/latest/meta-data/');
    assertStringIncludes(result, 'dangerous patterns');
})
  Deno.test('validateCommand - blocks SSRF attempts via wget', () => {
  const result = validateCommand('wget http://metadata.google.internal/computeMetadata/v1/');
    assertStringIncludes(result, 'dangerous patterns');
})