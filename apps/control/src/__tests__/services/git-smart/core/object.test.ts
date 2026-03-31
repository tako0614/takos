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

import { assertEquals, assertThrows, assertStringIncludes } from 'jsr:@std/assert';

const enc = new TextEncoder();

const testSig: GitSignature = {
  name: 'Test User',
  email: 'test@example.com',
  timestamp: 1700000000,
  tzOffset: '+0900',
};


  Deno.test('encodeBlob / decodeObject roundtrip - encodes and decodes a blob', () => {
  const content = enc.encode('hello world\n');
    const raw = encodeBlob(content);
    const decoded = decodeObject(raw);
    assertEquals(decoded.type, 'blob');
    assertEquals(decoded.content, content);
})



  Deno.test('hashBlob - hashes "hello" to known SHA', async () => {
  // printf 'hello' | git hash-object --stdin → b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0
    const content = enc.encode('hello');
    const sha = await hashBlob(content);
    assertEquals(sha, 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0');
})



  Deno.test('encodeTree / decodeTree - roundtrips a simple tree', () => {
  const entries: TreeEntry[] = [
      { mode: '100644', name: 'file.txt', sha: 'ce013625030ba8dba906f756967f9e9ca394464a' },
    ];
    const raw = encodeTree(entries);
    const decoded = decodeObject(raw);
    assertEquals(decoded.type, 'tree');
    const treeEntries = decodeTree(decoded.content);
    assertEquals(treeEntries.length, 1);
    assertEquals(treeEntries[0].name, 'file.txt');
    assertEquals(treeEntries[0].mode, '100644');
    assertEquals(treeEntries[0].sha, 'ce013625030ba8dba906f756967f9e9ca394464a');
})

  Deno.test('encodeTree / decodeTree - sorts entries with directory trailing-slash rule', () => {
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
    assertEquals(treeEntries[0].name, 'a-dir.txt');
    assertEquals(treeEntries[1].name, 'a-dir');
    assertEquals(treeEntries[2].name, 'z-file');
})

  Deno.test('encodeTree / decodeTree - normalizes mode with leading zeros on decode', () => {
  // encodeTree strips leading zeros, decodeTree re-pads to 6
    const entries: TreeEntry[] = [
      { mode: '040000', name: 'subdir', sha: 'a'.repeat(40) },
    ];
    const raw = encodeTree(entries);
    const decoded = decodeObject(raw);
    const treeEntries = decodeTree(decoded.content);
    assertEquals(treeEntries[0].mode, '040000');
})

  Deno.test('encodeTree / decodeTree - roundtrips multiple entries', () => {
  const entries: TreeEntry[] = [
      { mode: '100644', name: 'a.txt', sha: 'a'.repeat(40) },
      { mode: '100755', name: 'b.sh', sha: 'b'.repeat(40) },
      { mode: '040000', name: 'c-dir', sha: 'c'.repeat(40) },
    ];
    const raw = encodeTree(entries);
    const decoded = decodeObject(raw);
    const treeEntries = decodeTree(decoded.content);
    assertEquals(treeEntries.length, 3);
    // Check all entries are present (sorted order)
    const names = treeEntries.map(e => e.name);
    assertStringIncludes(names, 'a.txt');
    assertStringIncludes(names, 'b.sh');
    assertStringIncludes(names, 'c-dir');
})



  Deno.test('encodeCommit / decodeCommit - roundtrips a commit with 0 parents', () => {
  const commit = {
      tree: 'a'.repeat(40),
      parents: [],
      author: testSig,
      committer: testSig,
      message: 'initial commit',
    };
    const raw = encodeCommit(commit);
    const decoded = decodeObject(raw);
    assertEquals(decoded.type, 'commit');
    const parsed = decodeCommit(decoded.content);
    assertEquals(parsed.tree, commit.tree);
    assertEquals(parsed.parents, []);
    assertEquals(parsed.author.name, 'Test User');
    assertEquals(parsed.author.email, 'test@example.com');
    assertEquals(parsed.author.timestamp, 1700000000);
    assertEquals(parsed.author.tzOffset, '+0900');
    assertEquals(parsed.message, 'initial commit');
})

  Deno.test('encodeCommit / decodeCommit - roundtrips a commit with 1 parent', () => {
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
    assertEquals(parsed.parents, ['b'.repeat(40)]);
    assertEquals(parsed.message, 'second commit\n\nwith body');
})

  Deno.test('encodeCommit / decodeCommit - roundtrips a commit with multiple parents (merge)', () => {
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
    assertEquals(parsed.parents, ['b'.repeat(40), 'c'.repeat(40)]);
})



  Deno.test('decodeObjectHeader - parses blob header', () => {
  const raw = enc.encode('blob 12\0hello world\n');
    const header = decodeObjectHeader(raw);
    assertEquals(header.type, 'blob');
    assertEquals(header.size, 12);
    assertEquals(header.contentOffset, 8); // "blob 12\0" = 8 bytes
})

  Deno.test('decodeObjectHeader - throws on missing null byte', () => {
  const raw = enc.encode('blob 12');
    assertThrows(() => { () => decodeObjectHeader(raw); }, 'no null byte');
})

  Deno.test('decodeObjectHeader - throws on missing space in header', () => {
  const raw = enc.encode('blob\0content');
    assertThrows(() => { () => decodeObjectHeader(raw); }, 'Invalid git object header');
})



  Deno.test('decodeCommit error cases - throws on missing required fields', () => {
  const content = enc.encode('tree ' + 'a'.repeat(40) + '\n\nmessage');
    assertThrows(() => { () => decodeCommit(content); }, 'missing required fields');
})

  Deno.test('decodeCommit error cases - throws on completely empty content', () => {
  const content = enc.encode('');
    assertThrows(() => { () => decodeCommit(content); }, 'missing required fields');
})

