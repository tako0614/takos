import { MockR2Bucket } from '../../../../../test/integration/setup.ts';
import { mergeTrees3Way } from '@/services/git-smart/core/merge';
import { buildTreeFromPaths, flattenTree, createEmptyTree } from '@/services/git-smart/core/tree-ops';
import { putBlob } from '@/services/git-smart/core/object-store';

import { assertEquals, assertNotEquals } from 'jsr:@std/assert';

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


  let bucket: MockR2Bucket;

  // -------------------------------------------------------------------------
  // 1. No conflicts — disjoint changes
  // -------------------------------------------------------------------------
  
    Deno.test('mergeTrees3Way - no conflicts (disjoint changes) - merges when local adds file A and upstream adds file B', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'shared.txt': 'base' });
      const localSha = await buildTree(bucket, { 'shared.txt': 'base', 'local-new.txt': 'local content' });
      const upstreamSha = await buildTree(bucket, { 'shared.txt': 'base', 'upstream-new.txt': 'upstream content' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path).sort();
      assertEquals(paths, ['local-new.txt', 'shared.txt', 'upstream-new.txt']);
})

    Deno.test('mergeTrees3Way - no conflicts (disjoint changes) - merges when local modifies file A and upstream modifies file B', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'a.txt': 'original-a', 'b.txt': 'original-b' });
      const localSha = await buildTree(bucket, { 'a.txt': 'modified-a', 'b.txt': 'original-b' });
      const upstreamSha = await buildTree(bucket, { 'a.txt': 'original-a', 'b.txt': 'modified-b' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const fileMap = new Map(merged.map(f => [f.path, f.sha]));

      // Verify each side's changes are present
      const localA = await flattenTree(bucket as any, localSha);
      const upstreamB = await flattenTree(bucket as any, upstreamSha);
      assertEquals(fileMap.get('a.txt'), localA.find(f => f.path === 'a.txt')!.sha);
      assertEquals(fileMap.get('b.txt'), upstreamB.find(f => f.path === 'b.txt')!.sha);
})

    Deno.test('mergeTrees3Way - no conflicts (disjoint changes) - merges when both sides make the same change to a file', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'a.txt': 'original' });
      const sameSha = await buildTree(bucket, { 'a.txt': 'same-change' });

      const result = await mergeTrees3Way(bucket as any, baseSha, sameSha, sameSha);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      assertEquals(merged.length, 1);
      assertEquals(merged[0].path, 'a.txt');
})
  

  // -------------------------------------------------------------------------
  // 2. Conflict detection — both sides modify the same file
  // -------------------------------------------------------------------------
  
    Deno.test('mergeTrees3Way - conflict detection - detects content conflict when both sides modify the same file differently', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'file.txt': 'base content' });
      const localSha = await buildTree(bucket, { 'file.txt': 'local change' });
      const upstreamSha = await buildTree(bucket, { 'file.txt': 'upstream change' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      assertEquals(result.tree_sha, null);
      assertEquals(result.conflicts.length, 1);
      assertEquals(result.conflicts[0], { path: 'file.txt', type: 'content' });
})

    Deno.test('mergeTrees3Way - conflict detection - detects add-add conflict when both sides add the same path with different content', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'existing.txt': 'base' });
      const localSha = await buildTree(bucket, { 'existing.txt': 'base', 'new.txt': 'local version' });
      const upstreamSha = await buildTree(bucket, { 'existing.txt': 'base', 'new.txt': 'upstream version' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      assertEquals(result.tree_sha, null);
      assertEquals(result.conflicts.length, 1);
      assertEquals(result.conflicts[0], { path: 'new.txt', type: 'add-add' });
})

    Deno.test('mergeTrees3Way - conflict detection - detects delete-modify conflict when local deletes and upstream modifies', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'file.txt': 'base content', 'keep.txt': 'keep' });
      const localSha = await buildTree(bucket, { 'keep.txt': 'keep' }); // deleted file.txt
      const upstreamSha = await buildTree(bucket, { 'file.txt': 'modified content', 'keep.txt': 'keep' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      assertEquals(result.tree_sha, null);
      assertEquals(result.conflicts.length, 1);
      assertEquals(result.conflicts[0], { path: 'file.txt', type: 'delete-modify' });
})

    Deno.test('mergeTrees3Way - conflict detection - detects delete-modify conflict when upstream deletes and local modifies', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'file.txt': 'base content', 'keep.txt': 'keep' });
      const localSha = await buildTree(bucket, { 'file.txt': 'local modified', 'keep.txt': 'keep' });
      const upstreamSha = await buildTree(bucket, { 'keep.txt': 'keep' }); // deleted file.txt

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      assertEquals(result.tree_sha, null);
      assertEquals(result.conflicts.length, 1);
      assertEquals(result.conflicts[0], { path: 'file.txt', type: 'delete-modify' });
})

    Deno.test('mergeTrees3Way - conflict detection - reports multiple conflicts sorted by path', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'b.txt': 'base-b', 'a.txt': 'base-a' });
      const localSha = await buildTree(bucket, { 'b.txt': 'local-b', 'a.txt': 'local-a' });
      const upstreamSha = await buildTree(bucket, { 'b.txt': 'upstream-b', 'a.txt': 'upstream-a' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      assertEquals(result.tree_sha, null);
      assertEquals(result.conflicts.length, 2);
      assertEquals(result.conflicts[0].path, 'a.txt');
      assertEquals(result.conflicts[1].path, 'b.txt');
})
  

  // -------------------------------------------------------------------------
  // 3. Added and deleted files
  // -------------------------------------------------------------------------
  
    Deno.test('mergeTrees3Way - added and deleted files - accepts local-only file addition', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'base.txt': 'base' });
      const localSha = await buildTree(bucket, { 'base.txt': 'base', 'added.txt': 'new file' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, baseSha);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path).sort();
      assertEquals(paths, ['added.txt', 'base.txt']);
})

    Deno.test('mergeTrees3Way - added and deleted files - accepts upstream-only file addition', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'base.txt': 'base' });
      const upstreamSha = await buildTree(bucket, { 'base.txt': 'base', 'added.txt': 'new file' });

      const result = await mergeTrees3Way(bucket as any, baseSha, baseSha, upstreamSha);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path).sort();
      assertEquals(paths, ['added.txt', 'base.txt']);
})

    Deno.test('mergeTrees3Way - added and deleted files - accepts local-only file deletion', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'keep.txt': 'keep', 'remove.txt': 'gone' });
      const localSha = await buildTree(bucket, { 'keep.txt': 'keep' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, baseSha);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path);
      assertEquals(paths, ['keep.txt']);
})

    Deno.test('mergeTrees3Way - added and deleted files - accepts upstream-only file deletion', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'keep.txt': 'keep', 'remove.txt': 'gone' });
      const upstreamSha = await buildTree(bucket, { 'keep.txt': 'keep' });

      const result = await mergeTrees3Way(bucket as any, baseSha, baseSha, upstreamSha);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path);
      assertEquals(paths, ['keep.txt']);
})

    Deno.test('mergeTrees3Way - added and deleted files - accepts when both sides delete the same file', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'keep.txt': 'keep', 'remove.txt': 'gone' });
      const bothSha = await buildTree(bucket, { 'keep.txt': 'keep' });

      const result = await mergeTrees3Way(bucket as any, baseSha, bothSha, bothSha);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path);
      assertEquals(paths, ['keep.txt']);
})

    Deno.test('mergeTrees3Way - added and deleted files - accepts when both sides add the same file with identical content', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'base.txt': 'base' });
      const withNew = await buildTree(bucket, { 'base.txt': 'base', 'new.txt': 'identical' });

      const result = await mergeTrees3Way(bucket as any, baseSha, withNew, withNew);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const paths = merged.map(f => f.path).sort();
      assertEquals(paths, ['base.txt', 'new.txt']);
})
  

  // -------------------------------------------------------------------------
  // 4. Edge cases
  // -------------------------------------------------------------------------
  
    Deno.test('mergeTrees3Way - edge cases - merges identical trees with no changes', async () => {
  bucket = new MockR2Bucket();
  const treeSha = await buildTree(bucket, { 'file.txt': 'content' });

      const result = await mergeTrees3Way(bucket as any, treeSha, treeSha, treeSha);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      assertEquals(merged.length, 1);
      assertEquals(merged[0].path, 'file.txt');
})

    Deno.test('mergeTrees3Way - edge cases - merges three empty trees', async () => {
  bucket = new MockR2Bucket();
  const emptySha = await createEmptyTree(bucket as any);

      const result = await mergeTrees3Way(bucket as any, emptySha, emptySha, emptySha);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      assertEquals(merged, []);
})

    Deno.test('mergeTrees3Way - edge cases - merges when local adds files to an empty base', async () => {
  bucket = new MockR2Bucket();
  const emptySha = await createEmptyTree(bucket as any);
      const localSha = await buildTree(bucket, { 'new.txt': 'local file' });

      const result = await mergeTrees3Way(bucket as any, emptySha, localSha, emptySha);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      assertEquals(merged.length, 1);
      assertEquals(merged[0].path, 'new.txt');
})

    Deno.test('mergeTrees3Way - edge cases - merges nested directory trees with disjoint changes', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'dir/a.txt': 'a', 'dir/b.txt': 'b' });
      const localSha = await buildTree(bucket, { 'dir/a.txt': 'a-modified', 'dir/b.txt': 'b' });
      const upstreamSha = await buildTree(bucket, { 'dir/a.txt': 'a', 'dir/b.txt': 'b-modified' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      const fileMap = new Map(merged.map(f => [f.path, f.sha]));

      const localFiles = await flattenTree(bucket as any, localSha);
      const upstreamFiles = await flattenTree(bucket as any, upstreamSha);
      assertEquals(fileMap.get('dir/a.txt'), localFiles.find(f => f.path === 'dir/a.txt')!.sha);
      assertEquals(fileMap.get('dir/b.txt'), upstreamFiles.find(f => f.path === 'dir/b.txt')!.sha);
})

    Deno.test('mergeTrees3Way - edge cases - detects conflict on nested paths', async () => {
  bucket = new MockR2Bucket();
  const baseSha = await buildTree(bucket, { 'src/main.ts': 'base' });
      const localSha = await buildTree(bucket, { 'src/main.ts': 'local' });
      const upstreamSha = await buildTree(bucket, { 'src/main.ts': 'upstream' });

      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, upstreamSha);

      assertEquals(result.tree_sha, null);
      assertEquals(result.conflicts.length, 1);
      assertEquals(result.conflicts[0], { path: 'src/main.ts', type: 'content' });
})

    Deno.test('mergeTrees3Way - edge cases - handles mode change as a modification', async () => {
  bucket = new MockR2Bucket();
  const blobSha = await storeBlob(bucket, 'script');
      const baseSha = await buildTreeFromPaths(bucket as any, [
        { path: 'run.sh', sha: blobSha, mode: '100644' },
      ]);
      const localSha = await buildTreeFromPaths(bucket as any, [
        { path: 'run.sh', sha: blobSha, mode: '100755' },
      ]);

      // local changes mode, upstream unchanged -> local wins
      const result = await mergeTrees3Way(bucket as any, baseSha, localSha, baseSha);

      assertEquals(result.conflicts, []);
      assertNotEquals(result.tree_sha, null);

      const merged = await flattenTree(bucket as any, result.tree_sha!);
      assertEquals(merged[0].mode, '100755');
})
  

