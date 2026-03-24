import * as fs from 'fs/promises';
import * as os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/config.js', () => ({
  REPOS_BASE_DIR: '/repos',
  WORKDIR_BASE_DIR: os.tmpdir(),
}));

import {
  isPathWithinBase,
  resolvePathWithin,
  getRepoPath,
  resolveWorkDirPath,
  verifyPathWithinAfterAccess,
  verifyPathWithinBeforeCreate,
  verifyNoSymlinkPathComponents,
  resolveRepoGitPath,
} from '../../runtime/paths.js';
import { SymlinkEscapeError, SymlinkNotAllowedError } from '../../shared/errors.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-paths-test-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// isPathWithinBase
// ---------------------------------------------------------------------------

describe('isPathWithinBase', () => {
  it('returns true for a child path', () => {
    expect(isPathWithinBase('/base', '/base/child')).toBe(true);
  });

  it('returns true for deeply nested path', () => {
    expect(isPathWithinBase('/base', '/base/a/b/c/d')).toBe(true);
  });

  it('returns true for base itself when allowBase is true', () => {
    expect(isPathWithinBase('/base', '/base', { allowBase: true })).toBe(true);
  });

  it('returns false for base itself when allowBase is false', () => {
    expect(isPathWithinBase('/base', '/base', { allowBase: false })).toBe(false);
  });

  it('returns false for path outside base', () => {
    expect(isPathWithinBase('/base', '/other/path')).toBe(false);
  });

  it('returns false for parent path', () => {
    expect(isPathWithinBase('/base/child', '/base')).toBe(false);
  });

  it('returns false for traversal path', () => {
    expect(isPathWithinBase('/base', '/base/../other')).toBe(false);
  });

  it('handles resolveInputs option', () => {
    expect(isPathWithinBase('/tmp', '/tmp/./child', { resolveInputs: true })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolvePathWithin
// ---------------------------------------------------------------------------

describe('resolvePathWithin', () => {
  it('resolves a valid relative path', () => {
    const result = resolvePathWithin(tempDir, 'subdir/file.txt', 'test');
    expect(result).toBe(path.resolve(tempDir, 'subdir/file.txt'));
  });

  it('throws on empty target', () => {
    expect(() => resolvePathWithin(tempDir, '', 'test')).toThrow('Invalid test path');
  });

  it('throws on whitespace-only target', () => {
    expect(() => resolvePathWithin(tempDir, '   ', 'test')).toThrow('Invalid test path');
  });

  it('throws on absolute path when not allowed', () => {
    expect(() => resolvePathWithin(tempDir, '/etc/passwd', 'test')).toThrow(
      'Absolute test paths are not allowed',
    );
  });

  it('throws on path traversal', () => {
    expect(() => resolvePathWithin(tempDir, '../etc/passwd', 'test')).toThrow(
      'Path traversal not allowed in test',
    );
  });

  it('allows absolute paths when allowAbsolute is true', () => {
    const absPath = path.join(tempDir, 'allowed');
    const result = resolvePathWithin(tempDir, absPath, 'test', false, true);
    expect(result).toBe(path.resolve(absPath));
  });

  it('rejects absolute paths outside base even when allowAbsolute is true', () => {
    expect(() => resolvePathWithin(tempDir, '/completely/different', 'test', false, true)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// getRepoPath
// ---------------------------------------------------------------------------

describe('getRepoPath', () => {
  it('builds correct repo path', () => {
    const result = getRepoPath('workspace1', 'myrepo');
    expect(result).toBe(path.join('/repos', 'workspace1', 'myrepo.git'));
  });

  it('throws on empty spaceId', () => {
    expect(() => getRepoPath('', 'myrepo')).toThrow('spaceId is required');
  });

  it('throws on empty repoName', () => {
    expect(() => getRepoPath('ws1', '')).toThrow('repoName is required');
  });

  it('throws on spaceId with invalid characters', () => {
    expect(() => getRepoPath('ws/../evil', 'repo')).toThrow('invalid characters');
  });

  it('throws on repoName with invalid characters', () => {
    expect(() => getRepoPath('ws1', 'repo/../../evil')).toThrow('invalid characters');
  });

  it('throws on spaceId starting with non-alphanumeric', () => {
    expect(() => getRepoPath('_ws', 'repo')).toThrow('must start with an alphanumeric');
  });

  it('throws on repoName exceeding 128 characters', () => {
    expect(() => getRepoPath('ws1', 'a'.repeat(129))).toThrow('too long');
  });
});

// ---------------------------------------------------------------------------
// resolveRepoGitPath
// ---------------------------------------------------------------------------

describe('resolveRepoGitPath', () => {
  it('accepts valid absolute .git path under REPOS_BASE_DIR', () => {
    const p = '/repos/ws1/myrepo.git';
    expect(resolveRepoGitPath(p)).toBe(path.resolve(p));
  });

  it('rejects relative path', () => {
    expect(() => resolveRepoGitPath('ws1/myrepo.git')).toThrow('Invalid repoGitPath');
  });

  it('rejects path not ending in .git', () => {
    expect(() => resolveRepoGitPath('/repos/ws1/myrepo')).toThrow('Invalid repoGitPath');
  });

  it('rejects path outside REPOS_BASE_DIR', () => {
    expect(() => resolveRepoGitPath('/other/ws1/myrepo.git')).toThrow('Invalid repoGitPath');
  });

  it('rejects REPOS_BASE_DIR itself as .git', () => {
    // /repos is the base but doesn't end with .git - would already fail
    expect(() => resolveRepoGitPath('/repos')).toThrow('Invalid repoGitPath');
  });
});

// ---------------------------------------------------------------------------
// verifyPathWithinAfterAccess
// ---------------------------------------------------------------------------

describe('verifyPathWithinAfterAccess', () => {
  it('succeeds for path within base', async () => {
    const child = path.join(tempDir, 'child');
    await fs.mkdir(child, { recursive: true });
    const result = await verifyPathWithinAfterAccess(tempDir, child, 'test');
    expect(result).toBe(await fs.realpath(child));
  });

  it('throws SymlinkEscapeError for path outside base', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-'));
    try {
      await expect(
        verifyPathWithinAfterAccess(tempDir, outside, 'test'),
      ).rejects.toThrow(SymlinkEscapeError);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// verifyNoSymlinkPathComponents
// ---------------------------------------------------------------------------

describe('verifyNoSymlinkPathComponents', () => {
  it('succeeds for path with no symlinks', async () => {
    const child = path.join(tempDir, 'a', 'b');
    await fs.mkdir(child, { recursive: true });
    await expect(
      verifyNoSymlinkPathComponents(tempDir, child, 'test'),
    ).resolves.not.toThrow();
  });

  it('throws SymlinkNotAllowedError when path component is symlink', async () => {
    const realDir = path.join(tempDir, 'real');
    await fs.mkdir(realDir, { recursive: true });
    const symlinkDir = path.join(tempDir, 'sym');
    await fs.symlink(realDir, symlinkDir);
    const target = path.join(symlinkDir, 'file');

    await expect(
      verifyNoSymlinkPathComponents(tempDir, target, 'test'),
    ).rejects.toThrow(SymlinkNotAllowedError);
  });

  it('succeeds when path does not exist (ENOENT)', async () => {
    const nonexistent = path.join(tempDir, 'nonexistent', 'deep', 'path');
    await expect(
      verifyNoSymlinkPathComponents(tempDir, nonexistent, 'test'),
    ).resolves.not.toThrow();
  });

  it('succeeds for base path itself', async () => {
    await expect(
      verifyNoSymlinkPathComponents(tempDir, tempDir, 'test'),
    ).resolves.not.toThrow();
  });
});
