import { describe, it, expect, beforeEach } from 'vitest';
import { MockR2Bucket } from '../../../../../test/integration/setup';
import {
  isValidGitPath,
  assertValidGitPath,
  createTree,
  getTree,
  getEntryAtPath,
  listDirectory,
  getBlobAtPath,
  buildTreeFromPaths,
  applyTreeChanges,
  flattenTree,
  createEmptyTree,
  createSingleFileTree,
} from '@/services/git-smart/core/tree-ops';
import { putTree, putBlob } from '@/services/git-smart/core/object-store';
import { FILE_MODES } from '@/services/git-smart/types';
import type { TreeEntry } from '@/services/git-smart/types';

const enc = new TextEncoder();

let bucket: InstanceType<typeof MockR2Bucket>;

beforeEach(() => {
  bucket = new MockR2Bucket();
});

// ---------------------------------------------------------------------------
// Helper: store a blob and return its sha
// ---------------------------------------------------------------------------
async function storeBlob(content: string): Promise<string> {
  return putBlob(bucket as any, enc.encode(content));
}

// Helper: build a simple nested tree structure
// root/
//   file-a.txt  ("aaa")
//   dir/
//     file-b.txt ("bbb")
//     sub/
//       file-c.txt ("ccc")
async function buildNestedTree(): Promise<string> {
  const blobA = await storeBlob('aaa');
  const blobB = await storeBlob('bbb');
  const blobC = await storeBlob('ccc');

  const subTree = await putTree(bucket as any, [
    { mode: FILE_MODES.REGULAR_FILE, name: 'file-c.txt', sha: blobC },
  ]);

  const dirTree = await putTree(bucket as any, [
    { mode: FILE_MODES.REGULAR_FILE, name: 'file-b.txt', sha: blobB },
    { mode: FILE_MODES.DIRECTORY, name: 'sub', sha: subTree },
  ]);

  const rootTree = await putTree(bucket as any, [
    { mode: FILE_MODES.DIRECTORY, name: 'dir', sha: dirTree },
    { mode: FILE_MODES.REGULAR_FILE, name: 'file-a.txt', sha: blobA },
  ]);

  return rootTree;
}

// ===========================================================================
// isValidGitPath
// ===========================================================================
describe('isValidGitPath', () => {
  it('accepts simple file name', () => {
    expect(isValidGitPath('README.md')).toBe(true);
  });

  it('accepts nested path', () => {
    expect(isValidGitPath('src/utils/helpers.ts')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidGitPath('')).toBe(false);
  });

  it('rejects leading slash', () => {
    expect(isValidGitPath('/foo.txt')).toBe(false);
  });

  it('rejects trailing slash', () => {
    expect(isValidGitPath('foo/')).toBe(false);
  });

  it('rejects double slash', () => {
    expect(isValidGitPath('foo//bar')).toBe(false);
  });

  it('rejects backslash', () => {
    expect(isValidGitPath('foo\\bar')).toBe(false);
  });

  it('rejects "." segment', () => {
    expect(isValidGitPath('foo/./bar')).toBe(false);
  });

  it('rejects ".." segment', () => {
    expect(isValidGitPath('foo/../bar')).toBe(false);
  });

  it('rejects null byte', () => {
    expect(isValidGitPath('foo\0bar')).toBe(false);
  });

  it('rejects control characters', () => {
    expect(isValidGitPath('foo\x01bar')).toBe(false);
  });

  it('rejects path exceeding max length', () => {
    const longPath = 'a'.repeat(4097);
    expect(isValidGitPath(longPath)).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidGitPath(undefined as any)).toBe(false);
    expect(isValidGitPath(null as any)).toBe(false);
  });
});

// ===========================================================================
// assertValidGitPath
// ===========================================================================
describe('assertValidGitPath', () => {
  it('returns trimmed path when valid', () => {
    expect(assertValidGitPath('  foo/bar.txt  ')).toBe('foo/bar.txt');
  });

  it('throws on invalid path', () => {
    expect(() => assertValidGitPath('/invalid')).toThrow('Invalid git path');
  });
});

// ===========================================================================
// createTree / getTree
// ===========================================================================
describe('createTree / getTree', () => {
  it('creates and retrieves a tree', async () => {
    const blobSha = await storeBlob('hello');
    const entries: TreeEntry[] = [
      { mode: FILE_MODES.REGULAR_FILE, name: 'hello.txt', sha: blobSha },
    ];
    const treeSha = await createTree(bucket as any, entries);
    expect(treeSha).toMatch(/^[0-9a-f]{40}$/);

    const result = await getTree(bucket as any, treeSha);
    expect(result).not.toBeNull();
    expect(result!.sha).toBe(treeSha);
    expect(result!.entries).toHaveLength(1);
    expect(result!.entries[0].name).toBe('hello.txt');
  });

  it('returns null for non-existent sha', async () => {
    const result = await getTree(bucket as any, 'a'.repeat(40));
    expect(result).toBeNull();
  });
});

// ===========================================================================
// createEmptyTree
// ===========================================================================
describe('createEmptyTree', () => {
  it('creates a tree with no entries', async () => {
    const sha = await createEmptyTree(bucket as any);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);

    const result = await getTree(bucket as any, sha);
    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(0);
  });
});

// ===========================================================================
// createSingleFileTree
// ===========================================================================
describe('createSingleFileTree', () => {
  it('creates a tree with one blob', async () => {
    const sha = await createSingleFileTree(bucket as any, 'readme.txt', enc.encode('hi'));
    const result = await getTree(bucket as any, sha);
    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(1);
    expect(result!.entries[0].name).toBe('readme.txt');
    expect(result!.entries[0].mode).toBe(FILE_MODES.REGULAR_FILE);
  });
});

// ===========================================================================
// getEntryAtPath
// ===========================================================================
describe('getEntryAtPath', () => {
  it('returns root tree for empty path', async () => {
    const rootSha = await buildNestedTree();
    const entry = await getEntryAtPath(bucket as any, rootSha, '');
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe('tree');
    expect(entry!.sha).toBe(rootSha);
  });

  it('finds a file at root level', async () => {
    const rootSha = await buildNestedTree();
    const entry = await getEntryAtPath(bucket as any, rootSha, 'file-a.txt');
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe('blob');
    expect(entry!.name).toBe('file-a.txt');
  });

  it('finds a directory', async () => {
    const rootSha = await buildNestedTree();
    const entry = await getEntryAtPath(bucket as any, rootSha, 'dir');
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe('tree');
  });

  it('finds a deeply nested file', async () => {
    const rootSha = await buildNestedTree();
    const entry = await getEntryAtPath(bucket as any, rootSha, 'dir/sub/file-c.txt');
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe('blob');
    expect(entry!.name).toBe('file-c.txt');
  });

  it('returns null for non-existent path', async () => {
    const rootSha = await buildNestedTree();
    const entry = await getEntryAtPath(bucket as any, rootSha, 'no-such-file.txt');
    expect(entry).toBeNull();
  });

  it('returns null for path through a blob', async () => {
    const rootSha = await buildNestedTree();
    const entry = await getEntryAtPath(bucket as any, rootSha, 'file-a.txt/child');
    expect(entry).toBeNull();
  });

  it('strips leading/trailing slashes from path', async () => {
    const rootSha = await buildNestedTree();
    const entry = await getEntryAtPath(bucket as any, rootSha, '/dir/');
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe('tree');
  });
});

// ===========================================================================
// listDirectory
// ===========================================================================
describe('listDirectory', () => {
  it('lists root directory entries', async () => {
    const rootSha = await buildNestedTree();
    const entries = await listDirectory(bucket as any, rootSha);
    expect(entries).not.toBeNull();
    expect(entries!.length).toBe(2);
    const names = entries!.map(e => e.name).sort();
    expect(names).toEqual(['dir', 'file-a.txt']);
  });

  it('lists a subdirectory', async () => {
    const rootSha = await buildNestedTree();
    const entries = await listDirectory(bucket as any, rootSha, 'dir');
    expect(entries).not.toBeNull();
    expect(entries!.length).toBe(2);
    const names = entries!.map(e => e.name).sort();
    expect(names).toEqual(['file-b.txt', 'sub']);
  });

  it('returns null when path is a blob', async () => {
    const rootSha = await buildNestedTree();
    const entries = await listDirectory(bucket as any, rootSha, 'file-a.txt');
    expect(entries).toBeNull();
  });

  it('returns null for non-existent path', async () => {
    const rootSha = await buildNestedTree();
    const entries = await listDirectory(bucket as any, rootSha, 'nope');
    expect(entries).toBeNull();
  });
});

// ===========================================================================
// getBlobAtPath
// ===========================================================================
describe('getBlobAtPath', () => {
  it('returns blob content for a file', async () => {
    const rootSha = await buildNestedTree();
    const content = await getBlobAtPath(bucket as any, rootSha, 'file-a.txt');
    expect(content).not.toBeNull();
    expect(new TextDecoder().decode(content!)).toBe('aaa');
  });

  it('returns blob for nested file', async () => {
    const rootSha = await buildNestedTree();
    const content = await getBlobAtPath(bucket as any, rootSha, 'dir/sub/file-c.txt');
    expect(content).not.toBeNull();
    expect(new TextDecoder().decode(content!)).toBe('ccc');
  });

  it('returns null for a directory path', async () => {
    const rootSha = await buildNestedTree();
    const content = await getBlobAtPath(bucket as any, rootSha, 'dir');
    expect(content).toBeNull();
  });

  it('returns null for non-existent path', async () => {
    const rootSha = await buildNestedTree();
    const content = await getBlobAtPath(bucket as any, rootSha, 'missing.txt');
    expect(content).toBeNull();
  });
});

// ===========================================================================
// flattenTree
// ===========================================================================
describe('flattenTree', () => {
  it('flattens a nested tree into file paths', async () => {
    const rootSha = await buildNestedTree();
    const files = await flattenTree(bucket as any, rootSha);
    expect(files).toHaveLength(3);
    const paths = files.map(f => f.path).sort();
    expect(paths).toEqual(['dir/file-b.txt', 'dir/sub/file-c.txt', 'file-a.txt']);
  });

  it('returns empty array for empty tree', async () => {
    const sha = await createEmptyTree(bucket as any);
    const files = await flattenTree(bucket as any, sha);
    expect(files).toHaveLength(0);
  });

  it('respects basePath prefix', async () => {
    const rootSha = await buildNestedTree();
    const files = await flattenTree(bucket as any, rootSha, 'root');
    const paths = files.map(f => f.path).sort();
    expect(paths).toEqual(['root/dir/file-b.txt', 'root/dir/sub/file-c.txt', 'root/file-a.txt']);
  });

  it('throws on depth limit exceeded', async () => {
    // Build a deeply nested single-entry chain: d1/d2/d3/file.txt at depth 3
    const blob = await storeBlob('deep');
    let currentTree = await putTree(bucket as any, [
      { mode: FILE_MODES.REGULAR_FILE, name: 'file.txt', sha: blob },
    ]);
    for (let i = 0; i < 3; i++) {
      currentTree = await putTree(bucket as any, [
        { mode: FILE_MODES.DIRECTORY, name: `d${i}`, sha: currentTree },
      ]);
    }
    await expect(
      flattenTree(bucket as any, currentTree, '', { maxDepth: 2 }),
    ).rejects.toThrow('depth limit exceeded');
  });

  it('throws on entry limit exceeded', async () => {
    const rootSha = await buildNestedTree();
    await expect(
      flattenTree(bucket as any, rootSha, '', { maxEntries: 1 }),
    ).rejects.toThrow('entry limit exceeded');
  });

  it('throws on symlink by default', async () => {
    const blob = await storeBlob('target');
    const treeSha = await putTree(bucket as any, [
      { mode: FILE_MODES.SYMLINK, name: 'link', sha: blob },
    ]);
    await expect(flattenTree(bucket as any, treeSha)).rejects.toThrow('Symlink');
  });

  it('skips symlinks when skipSymlinks option is set', async () => {
    const blob = await storeBlob('target');
    const realBlob = await storeBlob('real');
    const treeSha = await putTree(bucket as any, [
      { mode: FILE_MODES.SYMLINK, name: 'link', sha: blob },
      { mode: FILE_MODES.REGULAR_FILE, name: 'real.txt', sha: realBlob },
    ]);
    const files = await flattenTree(bucket as any, treeSha, '', { skipSymlinks: true });
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('real.txt');
  });
});

// ===========================================================================
// buildTreeFromPaths
// ===========================================================================
describe('buildTreeFromPaths', () => {
  it('builds a tree from flat paths', async () => {
    const blobA = await storeBlob('a');
    const blobB = await storeBlob('b');

    const treeSha = await buildTreeFromPaths(bucket as any, [
      { path: 'file-a.txt', sha: blobA },
      { path: 'dir/file-b.txt', sha: blobB },
    ]);

    const files = await flattenTree(bucket as any, treeSha);
    const paths = files.map(f => f.path).sort();
    expect(paths).toEqual(['dir/file-b.txt', 'file-a.txt']);
  });

  it('uses custom file mode', async () => {
    const blob = await storeBlob('#!/bin/sh');
    const treeSha = await buildTreeFromPaths(bucket as any, [
      { path: 'run.sh', sha: blob, mode: FILE_MODES.EXECUTABLE },
    ]);
    const tree = await getTree(bucket as any, treeSha);
    expect(tree!.entries[0].mode).toBe(FILE_MODES.EXECUTABLE);
  });

  it('throws on path conflict (file where directory expected)', async () => {
    const blob = await storeBlob('x');
    await expect(
      buildTreeFromPaths(bucket as any, [
        { path: 'a', sha: blob },
        { path: 'a/b.txt', sha: blob },
      ]),
    ).rejects.toThrow('Path conflict');
  });

  it('throws on invalid path', async () => {
    const blob = await storeBlob('x');
    await expect(
      buildTreeFromPaths(bucket as any, [{ path: '/bad', sha: blob }]),
    ).rejects.toThrow('Invalid git path');
  });
});

// ===========================================================================
// applyTreeChanges
// ===========================================================================
describe('applyTreeChanges', () => {
  it('adds a new file to existing tree', async () => {
    const rootSha = await buildNestedTree();
    const newBlob = await storeBlob('new content');

    const newTreeSha = await applyTreeChanges(bucket as any, rootSha, [
      { path: 'new-file.txt', operation: 'add', sha: newBlob },
    ]);

    const files = await flattenTree(bucket as any, newTreeSha);
    const paths = files.map(f => f.path).sort();
    expect(paths).toContain('new-file.txt');
    expect(paths).toHaveLength(4);
  });

  it('deletes a file from existing tree', async () => {
    const rootSha = await buildNestedTree();

    const newTreeSha = await applyTreeChanges(bucket as any, rootSha, [
      { path: 'file-a.txt', operation: 'delete' },
    ]);

    const files = await flattenTree(bucket as any, newTreeSha);
    const paths = files.map(f => f.path);
    expect(paths).not.toContain('file-a.txt');
    expect(files).toHaveLength(2);
  });

  it('modifies an existing file', async () => {
    const rootSha = await buildNestedTree();
    const updatedBlob = await storeBlob('updated aaa');

    const newTreeSha = await applyTreeChanges(bucket as any, rootSha, [
      { path: 'file-a.txt', operation: 'modify', sha: updatedBlob },
    ]);

    const content = await getBlobAtPath(bucket as any, newTreeSha, 'file-a.txt');
    expect(new TextDecoder().decode(content!)).toBe('updated aaa');
  });

  it('handles multiple changes at once', async () => {
    const rootSha = await buildNestedTree();
    const newBlob = await storeBlob('added');

    const newTreeSha = await applyTreeChanges(bucket as any, rootSha, [
      { path: 'file-a.txt', operation: 'delete' },
      { path: 'new.txt', operation: 'add', sha: newBlob },
      { path: 'dir/file-b.txt', operation: 'modify', sha: newBlob },
    ]);

    const files = await flattenTree(bucket as any, newTreeSha);
    const paths = files.map(f => f.path).sort();
    expect(paths).toEqual(['dir/file-b.txt', 'dir/sub/file-c.txt', 'new.txt']);
  });

  it('throws when sha is missing for add operation', async () => {
    const rootSha = await buildNestedTree();
    await expect(
      applyTreeChanges(bucket as any, rootSha, [
        { path: 'file.txt', operation: 'add' },
      ]),
    ).rejects.toThrow('SHA required');
  });

  it('adds a file in a new nested directory', async () => {
    const rootSha = await buildNestedTree();
    const blob = await storeBlob('deep');

    const newTreeSha = await applyTreeChanges(bucket as any, rootSha, [
      { path: 'new-dir/nested/deep.txt', operation: 'add', sha: blob },
    ]);

    const entry = await getEntryAtPath(bucket as any, newTreeSha, 'new-dir/nested/deep.txt');
    expect(entry).not.toBeNull();
    expect(entry!.type).toBe('blob');
  });
});
