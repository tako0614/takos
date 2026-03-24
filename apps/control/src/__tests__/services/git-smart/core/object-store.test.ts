import { describe, it, expect, beforeEach } from 'vitest';
import { MockR2Bucket } from '../../../../../test/integration/setup';
import {
  putBlob,
  getBlob,
  putTree,
  getTreeEntries,
  putCommit,
  getCommitData,
  putRawObject,
  getRawObject,
  getObject,
  objectExists,
  deleteObject,
  getCompressedObject,
  deflate,
  inflate,
} from '@/services/git-smart/core/object-store';
import type { TreeEntry, GitSignature } from '@/services/git-smart/types';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeSig(name = 'Test User', email = 'test@example.com'): GitSignature {
  return { name, email, timestamp: 1700000000, tzOffset: '+0900' };
}

describe('object-store', () => {
  let bucket: MockR2Bucket;

  beforeEach(() => {
    bucket = new MockR2Bucket();
  });

  // ---- 1. putBlob -> getBlob roundtrip ----
  describe('putBlob / getBlob roundtrip', () => {
    it('stores and retrieves blob content', async () => {
      const content = encoder.encode('hello world');
      const sha = await putBlob(bucket as any, content);

      expect(sha).toMatch(/^[0-9a-f]{40}$/);

      const retrieved = await getBlob(bucket as any, sha);
      expect(retrieved).not.toBeNull();
      expect(decoder.decode(retrieved!)).toBe('hello world');
    });
  });

  // ---- 2. putBlob idempotent (head check) ----
  describe('putBlob idempotency', () => {
    it('returns the same SHA for identical content and does not re-upload', async () => {
      const content = encoder.encode('duplicate');
      const sha1 = await putBlob(bucket as any, content);
      const sha2 = await putBlob(bucket as any, content);

      expect(sha1).toBe(sha2);
    });

    it('returns different SHAs for different content', async () => {
      const sha1 = await putBlob(bucket as any, encoder.encode('aaa'));
      const sha2 = await putBlob(bucket as any, encoder.encode('bbb'));

      expect(sha1).not.toBe(sha2);
    });
  });

  // ---- 3. putTree -> getTreeEntries roundtrip ----
  describe('putTree / getTreeEntries roundtrip', () => {
    it('stores and retrieves tree entries', async () => {
      const blobSha = await putBlob(bucket as any, encoder.encode('file content'));
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'README.md', sha: blobSha },
      ];

      const treeSha = await putTree(bucket as any, entries);
      expect(treeSha).toMatch(/^[0-9a-f]{40}$/);

      const retrieved = await getTreeEntries(bucket as any, treeSha);
      expect(retrieved).not.toBeNull();
      expect(retrieved).toHaveLength(1);
      expect(retrieved![0].mode).toBe('100644');
      expect(retrieved![0].name).toBe('README.md');
      expect(retrieved![0].sha).toBe(blobSha);
    });

    it('handles multiple entries', async () => {
      const sha1 = await putBlob(bucket as any, encoder.encode('a'));
      const sha2 = await putBlob(bucket as any, encoder.encode('b'));
      const entries: TreeEntry[] = [
        { mode: '100644', name: 'a.txt', sha: sha1 },
        { mode: '100755', name: 'b.sh', sha: sha2 },
      ];

      const treeSha = await putTree(bucket as any, entries);
      const retrieved = await getTreeEntries(bucket as any, treeSha);

      expect(retrieved).toHaveLength(2);
      const names = retrieved!.map((e) => e.name).sort();
      expect(names).toEqual(['a.txt', 'b.sh']);
    });
  });

  // ---- 4. putCommit -> getCommitData roundtrip ----
  describe('putCommit / getCommitData roundtrip', () => {
    it('stores and retrieves commit data', async () => {
      const blobSha = await putBlob(bucket as any, encoder.encode('init'));
      const treeSha = await putTree(bucket as any, [
        { mode: '100644', name: 'file.txt', sha: blobSha },
      ]);

      const author = makeSig('Author', 'author@test.com');
      const committer = makeSig('Committer', 'committer@test.com');

      const commitSha = await putCommit(bucket as any, {
        tree: treeSha,
        parents: [],
        author,
        committer,
        message: 'initial commit\n',
      });

      expect(commitSha).toMatch(/^[0-9a-f]{40}$/);

      const retrieved = await getCommitData(bucket as any, commitSha);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.sha).toBe(commitSha);
      expect(retrieved!.tree).toBe(treeSha);
      expect(retrieved!.parents).toEqual([]);
      expect(retrieved!.author.name).toBe('Author');
      expect(retrieved!.author.email).toBe('author@test.com');
      expect(retrieved!.committer.name).toBe('Committer');
      expect(retrieved!.message).toContain('initial commit');
    });

    it('stores commit with parents', async () => {
      const blobSha = await putBlob(bucket as any, encoder.encode('v1'));
      const treeSha = await putTree(bucket as any, [
        { mode: '100644', name: 'f.txt', sha: blobSha },
      ]);
      const sig = makeSig();

      const parent = await putCommit(bucket as any, {
        tree: treeSha,
        parents: [],
        author: sig,
        committer: sig,
        message: 'first\n',
      });

      const blobSha2 = await putBlob(bucket as any, encoder.encode('v2'));
      const treeSha2 = await putTree(bucket as any, [
        { mode: '100644', name: 'f.txt', sha: blobSha2 },
      ]);

      const child = await putCommit(bucket as any, {
        tree: treeSha2,
        parents: [parent],
        author: sig,
        committer: sig,
        message: 'second\n',
      });

      const retrieved = await getCommitData(bucket as any, child);
      expect(retrieved!.parents).toEqual([parent]);
    });
  });

  // ---- 5. putRawObject -> getRawObject roundtrip ----
  describe('putRawObject / getRawObject roundtrip', () => {
    it('stores and retrieves a raw git object', async () => {
      // Construct a raw blob object: "blob <size>\0<content>"
      const content = encoder.encode('raw content');
      const header = encoder.encode(`blob ${content.length}\0`);
      const raw = new Uint8Array(header.length + content.length);
      raw.set(header);
      raw.set(content, header.length);

      const sha = await putRawObject(bucket as any, raw);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);

      const retrieved = await getRawObject(bucket as any, sha);
      expect(retrieved).not.toBeNull();
      expect(decoder.decode(retrieved!)).toBe(`blob ${content.length}\0raw content`);
    });
  });

  // ---- 6. getObject with invalid SHA -> null ----
  describe('getObject with invalid SHA', () => {
    it('returns null for a non-hex SHA', async () => {
      const result = await getObject(bucket as any, 'not-a-valid-sha');
      expect(result).toBeNull();
    });

    it('returns null for a too-short SHA', async () => {
      const result = await getObject(bucket as any, 'abcd1234');
      expect(result).toBeNull();
    });

    it('returns null for an empty string', async () => {
      const result = await getObject(bucket as any, '');
      expect(result).toBeNull();
    });
  });

  // ---- 7. getObject with nonexistent SHA -> null ----
  describe('getObject with nonexistent SHA', () => {
    it('returns null for a valid but nonexistent SHA', async () => {
      const fakeSha = 'a'.repeat(40);
      const result = await getObject(bucket as any, fakeSha);
      expect(result).toBeNull();
    });
  });

  // ---- 8. objectExists true/false ----
  describe('objectExists', () => {
    it('returns true for an existing object', async () => {
      const sha = await putBlob(bucket as any, encoder.encode('exists'));
      expect(await objectExists(bucket as any, sha)).toBe(true);
    });

    it('returns false for a nonexistent object', async () => {
      const fakeSha = 'b'.repeat(40);
      expect(await objectExists(bucket as any, fakeSha)).toBe(false);
    });

    it('returns false for an invalid SHA', async () => {
      expect(await objectExists(bucket as any, 'invalid')).toBe(false);
    });
  });

  // ---- 9. deleteObject removes the object ----
  describe('deleteObject', () => {
    it('removes a stored object', async () => {
      const sha = await putBlob(bucket as any, encoder.encode('to-delete'));
      expect(await objectExists(bucket as any, sha)).toBe(true);

      await deleteObject(bucket as any, sha);
      expect(await objectExists(bucket as any, sha)).toBe(false);
      expect(await getBlob(bucket as any, sha)).toBeNull();
    });

    it('is a no-op for an invalid SHA', async () => {
      // Should not throw
      await deleteObject(bucket as any, 'invalid-sha');
    });
  });

  // ---- 10. getCompressedObject returns inflatable data ----
  describe('getCompressedObject', () => {
    it('returns compressed data that can be inflated back to the raw object', async () => {
      const content = encoder.encode('compress me');
      const sha = await putBlob(bucket as any, content);

      const compressed = await getCompressedObject(bucket as any, sha);
      expect(compressed).not.toBeNull();
      expect(compressed!.length).toBeGreaterThan(0);

      // Inflate and verify it produces a valid raw object
      const inflated = await inflate(compressed!);
      const text = decoder.decode(inflated);
      expect(text).toContain('blob ');
      expect(text).toContain('compress me');
    });

    it('returns null for a nonexistent SHA', async () => {
      const result = await getCompressedObject(bucket as any, 'c'.repeat(40));
      expect(result).toBeNull();
    });

    it('returns null for an invalid SHA', async () => {
      const result = await getCompressedObject(bucket as any, 'bad');
      expect(result).toBeNull();
    });
  });

  // ---- 11. deflate -> inflate roundtrip ----
  describe('deflate / inflate roundtrip', () => {
    it('roundtrips arbitrary data', async () => {
      const original = encoder.encode('The quick brown fox jumps over the lazy dog');
      const compressed = await deflate(original);

      expect(compressed.length).toBeGreaterThan(0);
      // Compressed should generally differ from original
      expect(compressed).not.toEqual(original);

      const decompressed = await inflate(compressed);
      expect(decoder.decode(decompressed)).toBe('The quick brown fox jumps over the lazy dog');
    });

    it('roundtrips empty data', async () => {
      const original = new Uint8Array(0);
      const compressed = await deflate(original);
      const decompressed = await inflate(compressed);
      expect(decompressed.length).toBe(0);
    });

    it('roundtrips binary data', async () => {
      const original = new Uint8Array([0, 1, 2, 255, 254, 128, 0, 0, 42]);
      const compressed = await deflate(original);
      const decompressed = await inflate(compressed);
      expect(decompressed).toEqual(original);
    });
  });
});
