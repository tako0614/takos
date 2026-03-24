import { describe, it, expect, beforeEach } from 'vitest';
import { MockR2Bucket } from '../../../../../test/integration/setup';
import { mergeTrees3Way } from '@/services/git-smart/core/merge';
import { buildTreeFromPaths, flattenTree, createEmptyTree } from '@/services/git-smart/core/tree-ops';
import { putBlob } from '@/services/git-smart/core/object-store';

const enc = new TextEncoder();

async function storeBlob(bucket: MockR2Bucket, content: string): Promise<string> {
  return putBlob(bucket as any, enc.encode(content));
}

async function buildTree(
  bucket: MockR2Bucket,
  files: Record<string, string>,
): Promise<string> {
  const entries: Array<{ path: string; sha: string; mode: string }> = [];
  for (const [path, content] of Object.entries(files)) {
    const sha = await storeBlob(bucket, content);
    entries.push({ path, sha, mode: '100644' });
  }
  return buildTreeFromPaths(bucket as any, entries);
}

describe('mergeTrees3Way', () => {
  let bucket: MockR2Bucket;

  beforeEach(() => {
    bucket = new MockR2Bucket();
  });

  // -------------------------------------------------------------------------
  // 1. No conflicts — disjoint changes
  // -------------------------------------------------------------------------
  describe('no conflicts (disjoint changes)', () => {
    it('merges when local adds file A and upstream adds file B', async () => {
      const baseSha = await buildTree(bucket, { 'shared.txt': 'base' });
      const localSha = await buildTree(bucket, { 'shared.txt': 'base', 'local-new.txt': 'local content' });
      const upstreamSha = await buildTree(bucket, { 'shared.txt': 'base', 'upstream-new.txt': 'upstream content' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path).sort();
      expect(paths).toEqual(['local-new.txt', 'shared.txt', 'upstream-new.txt']);
    });

    it('merges when local modifies file A and upstream modifies file B', async () => {
      const baseSha = await buildTree(bucket, { 'a.txt': 'original-a', 'b.txt': 'original-b' });
      const localSha = await buildTree(bucket, { 'a.txt': 'modified-a', 'b.txt': 'original-b' });
      const upstreamSha = await buildTree(bucket, { 'a.txt': 'original-a', 'b.txt': 'modified-b' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const fileMap = new Map(merged.map(f => [f.path, f.sha]));

      // Verify each side's changes are present
      const localA = await flattenTree(bucket as any, localSha);
      const upstreamB = await flattenTree(bucket as any, upstreamSha);
      expect(fileMap.get('a.txt')).toBe(localA.find(f => f.path === 'a.txt')!.sha);
      expect(fileMap.get('b.txt')).toBe(upstreamB.find(f => f.path === 'b.txt')!.sha);
    });

    it('merges when both sides make the same change to a file', async () => {
      const baseSha = await buildTree(bucket, { 'a.txt': 'original' });
      const sameSha = await buildTree(bucket, { 'a.txt': 'same-change' });

      const result = await mergeTrees3Way(bucket as any, baseSha, sameSha, sameSha);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      expect(merged).toHaveLength(1);
      expect(merged[0].path).toBe('a.txt');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Conflict detection — both sides modify the same file
  // -------------------------------------------------------------------------
  describe('conflict detection', () => {
    it('detects content conflict when both sides modify the same file differently', async () => {
      const baseSha = await buildTree(bucket, { 'file.txt': 'base content' });
      const localSha = await buildTree(bucket, { 'file.txt': 'local change' });
      const upstreamSha = await buildTree(bucket, { 'file.txt': 'upstream change' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      expect(result.tree_sha).toBeNull();
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toEqual({ path: 'file.txt', type: 'content' });
    });

    it('detects add-add conflict when both sides add the same path with different content', async () => {
      const baseSha = await buildTree(bucket, { 'existing.txt': 'base' });
      const localSha = await buildTree(bucket, { 'existing.txt': 'base', 'new.txt': 'local version' });
      const upstreamSha = await buildTree(bucket, { 'existing.txt': 'base', 'new.txt': 'upstream version' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      expect(result.tree_sha).toBeNull();
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toEqual({ path: 'new.txt', type: 'add-add' });
    });

    it('detects delete-modify conflict when local deletes and upstream modifies', async () => {
      const baseSha = await buildTree(bucket, { 'file.txt': 'base content', 'keep.txt': 'keep' });
      const localSha = await buildTree(bucket, { 'keep.txt': 'keep' }); // deleted file.txt
      const upstreamSha = await buildTree(bucket, { 'file.txt': 'modified content', 'keep.txt': 'keep' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      expect(result.tree_sha).toBeNull();
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toEqual({ path: 'file.txt', type: 'delete-modify' });
    });

    it('detects delete-modify conflict when upstream deletes and local modifies', async () => {
      const baseSha = await buildTree(bucket, { 'file.txt': 'base content', 'keep.txt': 'keep' });
      const localSha = await buildTree(bucket, { 'file.txt': 'local modified', 'keep.txt': 'keep' });
      const upstreamSha = await buildTree(bucket, { 'keep.txt': 'keep' }); // deleted file.txt

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      expect(result.tree_sha).toBeNull();
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toEqual({ path: 'file.txt', type: 'delete-modify' });
    });

    it('reports multiple conflicts sorted by path', async () => {
      const baseSha = await buildTree(bucket, { 'b.txt': 'base-b', 'a.txt': 'base-a' });
      const localSha = await buildTree(bucket, { 'b.txt': 'local-b', 'a.txt': 'local-a' });
      const upstreamSha = await buildTree(bucket, { 'b.txt': 'upstream-b', 'a.txt': 'upstream-a' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      expect(result.tree_sha).toBeNull();
      expect(result.conflicts).toHaveLength(2);
      expect(result.conflicts[0].path).toBe('a.txt');
      expect(result.conflicts[1].path).toBe('b.txt');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Added and deleted files
  // -------------------------------------------------------------------------
  describe('added and deleted files', () => {
    it('accepts local-only file addition', async () => {
      const baseSha = await buildTree(bucket, { 'base.txt': 'base' });
      const localSha = await buildTree(bucket, { 'base.txt': 'base', 'added.txt': 'new file' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, baseSha);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path).sort();
      expect(paths).toEqual(['added.txt', 'base.txt']);
    });

    it('accepts upstream-only file addition', async () => {
      const baseSha = await buildTree(bucket, { 'base.txt': 'base' });
      const upstreamSha = await buildTree(bucket, { 'base.txt': 'base', 'added.txt': 'new file' });

      const result = await mergeTrees3Way(bucket as any, baseSha, baseSha, upstreamSha);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path).sort();
      expect(paths).toEqual(['added.txt', 'base.txt']);
    });

    it('accepts local-only file deletion', async () => {
      const baseSha = await buildTree(bucket, { 'keep.txt': 'keep', 'remove.txt': 'gone' });
      const localSha = await buildTree(bucket, { 'keep.txt': 'keep' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, baseSha);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path);
      expect(paths).toEqual(['keep.txt']);
    });

    it('accepts upstream-only file deletion', async () => {
      const baseSha = await buildTree(bucket, { 'keep.txt': 'keep', 'remove.txt': 'gone' });
      const upstreamSha = await buildTree(bucket, { 'keep.txt': 'keep' });

      const result = await mergeTrees3Way(bucket as any, baseSha, baseSha, upstreamSha);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path);
      expect(paths).toEqual(['keep.txt']);
    });

    it('accepts when both sides delete the same file', async () => {
      const baseSha = await buildTree(bucket, { 'keep.txt': 'keep', 'remove.txt': 'gone' });
      const bothSha = await buildTree(bucket, { 'keep.txt': 'keep' });

      const result = await mergeTrees3Way(bucket as any, baseSha, bothSha, bothSha);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path);
      expect(paths).toEqual(['keep.txt']);
    });

    it('accepts when both sides add the same file with identical content', async () => {
      const baseSha = await buildTree(bucket, { 'base.txt': 'base' });
      const withNew = await buildTree(bucket, { 'base.txt': 'base', 'new.txt': 'identical' });

      const result = await mergeTrees3Way(bucket as any, baseSha, withNew, withNew);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path).sort();
      expect(paths).toEqual(['base.txt', 'new.txt']);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('merges identical trees with no changes', async () => {
      const treeSha = await buildTree(bucket, { 'file.txt': 'content' });

      const result = await mergeTrees3Way(bucket as any, treeSha, treeSha, treeSha);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      expect(merged).toHaveLength(1);
      expect(merged[0].path).toBe('file.txt');
    });

    it('merges three empty trees', async () => {
      const emptySha = await createEmptyTree(bucket as any);

      const result = await mergeTrees3Way(bucket as any, emptySha, emptySha, emptySha);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      expect(merged).toEqual([]);
    });

    it('merges when local adds files to an empty base', async () => {
      const emptySha = await createEmptyTree(bucket as any);
      const localSha = await buildTree(bucket, { 'new.txt': 'local file' });

      const result = await mergeTrees3Way(bucket as any, emptySha, localSha, emptySha);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      expect(merged).toHaveLength(1);
      expect(merged[0].path).toBe('new.txt');
    });

    it('merges nested directory trees with disjoint changes', async () => {
      const baseSha = await buildTree(bucket, { 'dir/a.txt': 'a', 'dir/b.txt': 'b' });
      const localSha = await buildTree(bucket, { 'dir/a.txt': 'a-modified', 'dir/b.txt': 'b' });
      const upstreamSha = await buildTree(bucket, { 'dir/a.txt': 'a', 'dir/b.txt': 'b-modified' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const fileMap = new Map(merged.map(f => [f.path, f.sha]));

      const localFiles = await flattenTree(bucket as any, localSha);
      const upstreamFiles = await flattenTree(bucket as any, upstreamSha);
      expect(fileMap.get('dir/a.txt')).toBe(localFiles.find(f => f.path === 'dir/a.txt')!.sha);
      expect(fileMap.get('dir/b.txt')).toBe(upstreamFiles.find(f => f.path === 'dir/b.txt')!.sha);
    });

    it('detects conflict on nested paths', async () => {
      const baseSha = await buildTree(bucket, { 'src/main.ts': 'base' });
      const localSha = await buildTree(bucket, { 'src/main.ts': 'local' });
      const upstreamSha = await buildTree(bucket, { 'src/main.ts': 'upstream' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      expect(result.tree_sha).toBeNull();
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]).toEqual({ path: 'src/main.ts', type: 'content' });
    });

    it('handles mode change as a modification', async () => {
      const blobSha = await storeBlob(bucket, 'script');
      const baseSha = await buildTreeFromPaths(bucket as any, [
        { path: 'run.sh', sha: blobSha, mode: '100644' },
      ]);
      const localSha = await buildTreeFromPaths(bucket as any, [
        { path: 'run.sh', sha: blobSha, mode: '100755' },
      ]);

      // local changes mode, upstream unchanged -> local wins
      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, baseSha);

      expect(result.conflicts).toEqual([]);
      expect(result.tree_sha).not.toBeNull();

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      expect(merged[0].mode).toBe('100755');
    });
  });
});
