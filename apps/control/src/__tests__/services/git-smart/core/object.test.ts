import { describe, it, expect } from 'vitest';
import {
  encodeBlob,
  encodeTree,
  encodeCommit,
  decodeObject,
  decodeTree,
  decodeCommit,
  decodeObjectHeader,
  hashBlob,
} from '@/services/git-smart/core/object';
import type { TreeEntry, GitSignature } from '@/services/git-smart/types';

const enc = new TextEncoder();

const testSig: GitSignature = {
  name: 'Test User',
  email: 'test@example.com',
  timestamp: 1700000000,
  tzOffset: '+0900',
};

describe('encodeBlob / decodeObject roundtrip', () => {
  it('encodes and decodes a blob', () => {
    const content = enc.encode('hello world\n');
    const raw = encodeBlob(content);
    const decoded = decodeObject(raw);
    expect(decoded.type).toBe('blob');
    expect(decoded.content).toEqual(content);
  });
});

describe('hashBlob', () => {
  it('hashes "hello" to known SHA', async () => {
    // printf 'hello' | git hash-object --stdin → b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0
    const content = enc.encode('hello');
    const sha = await hashBlob(content);
    expect(sha).toBe('b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
  });
});

describe('encodeTree / decodeTree', () => {
  it('roundtrips a simple tree', () => {
    const entries: TreeEntry[] = [
      { mode: '100644', name: 'file.txt', sha: 'ce013625030ba8dba906f756967f9e9ca394464a' },
    ];
    const raw = encodeTree(entries);
    const decoded = decodeObject(raw);
    expect(decoded.type).toBe('tree');
    const treeEntries = decodeTree(decoded.content);
    expect(treeEntries).toHaveLength(1);
    expect(treeEntries[0].name).toBe('file.txt');
    expect(treeEntries[0].mode).toBe('100644');
    expect(treeEntries[0].sha).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('sorts entries with directory trailing-slash rule', () => {
    const entries: TreeEntry[] = [
      { mode: '100644', name: 'z-file', sha: 'a'.repeat(40) },
      { mode: '040000', name: 'a-dir', sha: 'b'.repeat(40) },
      { mode: '100644', name: 'a-dir.txt', sha: 'c'.repeat(40) },
    ];
    const raw = encodeTree(entries);
    const decoded = decodeObject(raw);
    const treeEntries = decodeTree(decoded.content);
    // a-dir/ comes before a-dir.txt (because '/' > '.')
    // But 'a-dir/' < 'a-dir.txt' since '/' (0x2F) < 't' (0x74)
    // Actually 'a-dir.' < 'a-dir/' in ASCII: '.' = 0x2E < '/' = 0x2F
    // So a-dir.txt comes first, then a-dir/
    expect(treeEntries[0].name).toBe('a-dir.txt');
    expect(treeEntries[1].name).toBe('a-dir');
    expect(treeEntries[2].name).toBe('z-file');
  });

  it('normalizes mode with leading zeros on decode', () => {
    // encodeTree strips leading zeros, decodeTree re-pads to 6
    const entries: TreeEntry[] = [
      { mode: '040000', name: 'subdir', sha: 'a'.repeat(40) },
    ];
    const raw = encodeTree(entries);
    const decoded = decodeObject(raw);
    const treeEntries = decodeTree(decoded.content);
    expect(treeEntries[0].mode).toBe('040000');
  });

  it('roundtrips multiple entries', () => {
    const entries: TreeEntry[] = [
      { mode: '100644', name: 'a.txt', sha: 'a'.repeat(40) },
      { mode: '100755', name: 'b.sh', sha: 'b'.repeat(40) },
      { mode: '040000', name: 'c-dir', sha: 'c'.repeat(40) },
    ];
    const raw = encodeTree(entries);
    const decoded = decodeObject(raw);
    const treeEntries = decodeTree(decoded.content);
    expect(treeEntries).toHaveLength(3);
    // Check all entries are present (sorted order)
    const names = treeEntries.map(e => e.name);
    expect(names).toContain('a.txt');
    expect(names).toContain('b.sh');
    expect(names).toContain('c-dir');
  });
});

describe('encodeCommit / decodeCommit', () => {
  it('roundtrips a commit with 0 parents', () => {
    const commit = {
      tree: 'a'.repeat(40),
      parents: [],
      author: testSig,
      committer: testSig,
      message: 'initial commit',
    };
    const raw = encodeCommit(commit);
    const decoded = decodeObject(raw);
    expect(decoded.type).toBe('commit');
    const parsed = decodeCommit(decoded.content);
    expect(parsed.tree).toBe(commit.tree);
    expect(parsed.parents).toEqual([]);
    expect(parsed.author.name).toBe('Test User');
    expect(parsed.author.email).toBe('test@example.com');
    expect(parsed.author.timestamp).toBe(1700000000);
    expect(parsed.author.tzOffset).toBe('+0900');
    expect(parsed.message).toBe('initial commit');
  });

  it('roundtrips a commit with 1 parent', () => {
    const commit = {
      tree: 'a'.repeat(40),
      parents: ['b'.repeat(40)],
      author: testSig,
      committer: testSig,
      message: 'second commit\n\nwith body',
    };
    const raw = encodeCommit(commit);
    const decoded = decodeObject(raw);
    const parsed = decodeCommit(decoded.content);
    expect(parsed.parents).toEqual(['b'.repeat(40)]);
    expect(parsed.message).toBe('second commit\n\nwith body');
  });

  it('roundtrips a commit with multiple parents (merge)', () => {
    const commit = {
      tree: 'a'.repeat(40),
      parents: ['b'.repeat(40), 'c'.repeat(40)],
      author: testSig,
      committer: testSig,
      message: 'merge commit',
    };
    const raw = encodeCommit(commit);
    const decoded = decodeObject(raw);
    const parsed = decodeCommit(decoded.content);
    expect(parsed.parents).toEqual(['b'.repeat(40), 'c'.repeat(40)]);
  });
});

describe('decodeObjectHeader', () => {
  it('parses blob header', () => {
    const raw = enc.encode('blob 12\0hello world\n');
    const header = decodeObjectHeader(raw);
    expect(header.type).toBe('blob');
    expect(header.size).toBe(12);
    expect(header.contentOffset).toBe(8); // "blob 12\0" = 8 bytes
  });

  it('throws on missing null byte', () => {
    const raw = enc.encode('blob 12');
    expect(() => decodeObjectHeader(raw)).toThrow('no null byte');
  });

  it('throws on missing space in header', () => {
    const raw = enc.encode('blob\0content');
    expect(() => decodeObjectHeader(raw)).toThrow('Invalid git object header');
  });
});

describe('decodeCommit error cases', () => {
  it('throws on missing required fields', () => {
    const content = enc.encode('tree ' + 'a'.repeat(40) + '\n\nmessage');
    expect(() => decodeCommit(content)).toThrow('missing required fields');
  });

  it('throws on completely empty content', () => {
    const content = enc.encode('');
    expect(() => decodeCommit(content)).toThrow('missing required fields');
  });
});
