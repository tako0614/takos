import * as fs from 'fs/promises';
import * as os from 'os';
import path from 'path';
// [Deno] vi.mock removed - manually stub imports from '../../shared/config.ts'
import {
  isPathWithinBase,
  resolvePathWithin,
  getRepoPath,
  resolveWorkDirPath,
  verifyPathWithinAfterAccess,
  verifyPathWithinBeforeCreate,
  verifyNoSymlinkPathComponents,
  resolveRepoGitPath,
} from '../../runtime/paths.ts';
import { SymlinkEscapeError, SymlinkNotAllowedError } from '../../shared/errors.ts';

import { assertEquals, assertThrows, assertRejects } from 'jsr:@std/assert';

let tempDir: string;
// ---------------------------------------------------------------------------
// isPathWithinBase
// ---------------------------------------------------------------------------


  Deno.test('isPathWithinBase - returns true for a child path', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertEquals(isPathWithinBase('/base', '/base/child'), true);
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('isPathWithinBase - returns true for deeply nested path', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertEquals(isPathWithinBase('/base', '/base/a/b/c/d'), true);
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('isPathWithinBase - returns true for base itself when allowBase is true', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertEquals(isPathWithinBase('/base', '/base', { allowBase: true }), true);
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('isPathWithinBase - returns false for base itself when allowBase is false', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertEquals(isPathWithinBase('/base', '/base', { allowBase: false }), false);
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('isPathWithinBase - returns false for path outside base', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertEquals(isPathWithinBase('/base', '/other/path'), false);
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('isPathWithinBase - returns false for parent path', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertEquals(isPathWithinBase('/base/child', '/base'), false);
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('isPathWithinBase - returns false for traversal path', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertEquals(isPathWithinBase('/base', '/base/../other'), false);
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('isPathWithinBase - handles resolveInputs option', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertEquals(isPathWithinBase('/tmp', '/tmp/./child', { resolveInputs: true }), true);
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
// ---------------------------------------------------------------------------
// resolvePathWithin
// ---------------------------------------------------------------------------


  Deno.test('resolvePathWithin - resolves a valid relative path', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  const result = resolvePathWithin(tempDir, 'subdir/file.txt', 'test');
    assertEquals(result, path.resolve(tempDir, 'subdir/file.txt'));
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('resolvePathWithin - throws on empty target', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => resolvePathWithin(tempDir, '', 'test'); }, 'Invalid test path');
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('resolvePathWithin - throws on whitespace-only target', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => resolvePathWithin(tempDir, '   ', 'test'); }, 'Invalid test path');
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('resolvePathWithin - throws on absolute path when not allowed', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => resolvePathWithin(tempDir, '/etc/passwd', 'test'); }, 
      'Absolute test paths are not allowed',
    );
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('resolvePathWithin - throws on path traversal', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => resolvePathWithin(tempDir, '../etc/passwd', 'test'); }, 
      'Path traversal not allowed in test',
    );
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('resolvePathWithin - allows absolute paths when allowAbsolute is true', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  const absPath = path.join(tempDir, 'allowed');
    const result = resolvePathWithin(tempDir, absPath, 'test', false, true);
    assertEquals(result, path.resolve(absPath));
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('resolvePathWithin - rejects absolute paths outside base even when allowAbsolute is true', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => resolvePathWithin(tempDir, '/completely/different', 'test', false, true); });
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
// ---------------------------------------------------------------------------
// getRepoPath
// ---------------------------------------------------------------------------


  Deno.test('getRepoPath - builds correct repo path', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  const result = getRepoPath('workspace1', 'myrepo');
    assertEquals(result, path.join('/repos', 'workspace1', 'myrepo.git'));
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('getRepoPath - throws on empty spaceId', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => getRepoPath('', 'myrepo'); }, 'spaceId is required');
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('getRepoPath - throws on empty repoName', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => getRepoPath('ws1', ''); }, 'repoName is required');
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('getRepoPath - throws on spaceId with invalid characters', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => getRepoPath('ws/../evil', 'repo'); }, 'invalid characters');
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('getRepoPath - throws on repoName with invalid characters', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => getRepoPath('ws1', 'repo/../../evil'); }, 'invalid characters');
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('getRepoPath - throws on spaceId starting with non-alphanumeric', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => getRepoPath('_ws', 'repo'); }, 'must start with an alphanumeric');
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('getRepoPath - throws on repoName exceeding 128 characters', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => getRepoPath('ws1', 'a'.repeat(129)); }, 'too long');
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
// ---------------------------------------------------------------------------
// resolveRepoGitPath
// ---------------------------------------------------------------------------


  Deno.test('resolveRepoGitPath - accepts valid absolute .git path under REPOS_BASE_DIR', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  const p = '/repos/ws1/myrepo.git';
    assertEquals(resolveRepoGitPath(p), path.resolve(p));
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('resolveRepoGitPath - rejects relative path', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => resolveRepoGitPath('ws1/myrepo.git'); }, 'Invalid repoGitPath');
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('resolveRepoGitPath - rejects path not ending in .git', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => resolveRepoGitPath('/repos/ws1/myrepo'); }, 'Invalid repoGitPath');
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('resolveRepoGitPath - rejects path outside REPOS_BASE_DIR', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  assertThrows(() => { () => resolveRepoGitPath('/other/ws1/myrepo.git'); }, 'Invalid repoGitPath');
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('resolveRepoGitPath - rejects REPOS_BASE_DIR itself as .git', () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  // /repos is the base but doesn't end with .git - would already fail
    assertThrows(() => { () => resolveRepoGitPath('/repos'); }, 'Invalid repoGitPath');
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
// ---------------------------------------------------------------------------
// verifyPathWithinAfterAccess
// ---------------------------------------------------------------------------


  Deno.test('verifyPathWithinAfterAccess - succeeds for path within base', async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  const child = path.join(tempDir, 'child');
    await fs.mkdir(child, { recursive: true });
    const result = await verifyPathWithinAfterAccess(tempDir, child, 'test');
    assertEquals(result, await fs.realpath(child));
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('verifyPathWithinAfterAccess - throws SymlinkEscapeError for path outside base', async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-'));
    try {
      await await assertRejects(async () => { await 
        verifyPathWithinAfterAccess(tempDir, outside, 'test'),
      ; }, SymlinkEscapeError);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
// ---------------------------------------------------------------------------
// verifyNoSymlinkPathComponents
// ---------------------------------------------------------------------------


  Deno.test('verifyNoSymlinkPathComponents - succeeds for path with no symlinks', async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  const child = path.join(tempDir, 'a', 'b');
    await fs.mkdir(child, { recursive: true });
    await await 
      verifyNoSymlinkPathComponents(tempDir, child, 'test'),
    ;
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('verifyNoSymlinkPathComponents - throws SymlinkNotAllowedError when path component is symlink', async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  const realDir = path.join(tempDir, 'real');
    await fs.mkdir(realDir, { recursive: true });
    const symlinkDir = path.join(tempDir, 'sym');
    await fs.symlink(realDir, symlinkDir);
    const target = path.join(symlinkDir, 'file');

    await await assertRejects(async () => { await 
      verifyNoSymlinkPathComponents(tempDir, target, 'test'),
    ; }, SymlinkNotAllowedError);
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('verifyNoSymlinkPathComponents - succeeds when path does not exist (ENOENT)', async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  const nonexistent = path.join(tempDir, 'nonexistent', 'deep', 'path');
    await await 
      verifyNoSymlinkPathComponents(tempDir, nonexistent, 'test'),
    ;
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})
  Deno.test('verifyNoSymlinkPathComponents - succeeds for base path itself', async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
  try {
  await await 
      verifyNoSymlinkPathComponents(tempDir, tempDir, 'test'),
    ;
  } finally {
  await fs.rm(tempDir, { recursive: true, force: true });
  }
})