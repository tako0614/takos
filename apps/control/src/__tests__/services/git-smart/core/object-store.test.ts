import { MockR2Bucket } from "../../../../../test/integration/setup.ts";
import {
  deflate,
  deleteObject,
  getBlob,
  getCommitData,
  getCompressedObject,
  getObject,
  getRawObject,
  getTreeEntries,
  inflate,
  objectExists,
  putBlob,
  putCommit,
  putRawObject,
  putTree,
} from "@/services/git-smart/core/object-store";
import type { GitSignature, TreeEntry } from "@/services/git-smart/types";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeSig(name = "Test User", email = "test@example.com"): GitSignature {
  return { name, email, timestamp: 1700000000, tzOffset: "+0900" };
}

let bucket: MockR2Bucket;

// ---- 1. putBlob -> getBlob roundtrip ----

Deno.test("object-store - putBlob / getBlob roundtrip - stores and retrieves blob content", async () => {
  bucket = new MockR2Bucket();
  const content = encoder.encode("hello world");
  const sha = await putBlob(bucket as any, content);

  assert(/^[0-9a-f]{40}$/.test(sha));

  const retrieved = await getBlob(bucket as any, sha);
  assertNotEquals(retrieved, null);
  assertEquals(decoder.decode(retrieved!), "hello world");
});

// ---- 2. putBlob idempotent (head check) ----

Deno.test("object-store - putBlob idempotency - returns the same SHA for identical content and does not re-upload", async () => {
  bucket = new MockR2Bucket();
  const content = encoder.encode("duplicate");
  const sha1 = await putBlob(bucket as any, content);
  const sha2 = await putBlob(bucket as any, content);

  assertEquals(sha1, sha2);
});

Deno.test("object-store - putBlob idempotency - returns different SHAs for different content", async () => {
  bucket = new MockR2Bucket();
  const sha1 = await putBlob(bucket as any, encoder.encode("aaa"));
  const sha2 = await putBlob(bucket as any, encoder.encode("bbb"));

  assertNotEquals(sha1, sha2);
});

// ---- 3. putTree -> getTreeEntries roundtrip ----

Deno.test("object-store - putTree / getTreeEntries roundtrip - stores and retrieves tree entries", async () => {
  bucket = new MockR2Bucket();
  const blobSha = await putBlob(bucket as any, encoder.encode("file content"));
  const entries: TreeEntry[] = [
    { mode: "100644", name: "README.md", sha: blobSha },
  ];

  const treeSha = await putTree(bucket as any, entries);
  assert(/^[0-9a-f]{40}$/.test(treeSha));

  const retrieved = await getTreeEntries(bucket as any, treeSha);
  assertNotEquals(retrieved, null);
  assertEquals(retrieved!.length, 1);
  assertEquals(retrieved![0].mode, "100644");
  assertEquals(retrieved![0].name, "README.md");
  assertEquals(retrieved![0].sha, blobSha);
});

Deno.test("object-store - putTree / getTreeEntries roundtrip - handles multiple entries", async () => {
  bucket = new MockR2Bucket();
  const sha1 = await putBlob(bucket as any, encoder.encode("a"));
  const sha2 = await putBlob(bucket as any, encoder.encode("b"));
  const entries: TreeEntry[] = [
    { mode: "100644", name: "a.txt", sha: sha1 },
    { mode: "100755", name: "b.sh", sha: sha2 },
  ];

  const treeSha = await putTree(bucket as any, entries);
  const retrieved = await getTreeEntries(bucket as any, treeSha);

  assertEquals(retrieved!.length, 2);
  const names = retrieved!.map((e) => e.name).sort();
  assertEquals(names, ["a.txt", "b.sh"]);
});

// ---- 4. putCommit -> getCommitData roundtrip ----

Deno.test("object-store - putCommit / getCommitData roundtrip - stores and retrieves commit data", async () => {
  bucket = new MockR2Bucket();
  const blobSha = await putBlob(bucket as any, encoder.encode("init"));
  const treeSha = await putTree(bucket as any, [
    { mode: "100644", name: "file.txt", sha: blobSha },
  ]);

  const author = makeSig("Author", "author@test.com");
  const committer = makeSig("Committer", "committer@test.com");

  const commitSha = await putCommit(bucket as any, {
    tree: treeSha,
    parents: [],
    author,
    committer,
    message: "initial commit\n",
  });

  assert(/^[0-9a-f]{40}$/.test(commitSha));

  const retrieved = await getCommitData(bucket as any, commitSha);
  assertNotEquals(retrieved, null);
  assertEquals(retrieved!.sha, commitSha);
  assertEquals(retrieved!.tree, treeSha);
  assertEquals(retrieved!.parents, []);
  assertEquals(retrieved!.author.name, "Author");
  assertEquals(retrieved!.author.email, "author@test.com");
  assertEquals(retrieved!.committer.name, "Committer");
  assertStringIncludes(retrieved!.message, "initial commit");
});

Deno.test("object-store - putCommit / getCommitData roundtrip - stores commit with parents", async () => {
  bucket = new MockR2Bucket();
  const blobSha = await putBlob(bucket as any, encoder.encode("v1"));
  const treeSha = await putTree(bucket as any, [
    { mode: "100644", name: "f.txt", sha: blobSha },
  ]);
  const sig = makeSig();

  const parent = await putCommit(bucket as any, {
    tree: treeSha,
    parents: [],
    author: sig,
    committer: sig,
    message: "first\n",
  });

  const blobSha2 = await putBlob(bucket as any, encoder.encode("v2"));
  const treeSha2 = await putTree(bucket as any, [
    { mode: "100644", name: "f.txt", sha: blobSha2 },
  ]);

  const child = await putCommit(bucket as any, {
    tree: treeSha2,
    parents: [parent],
    author: sig,
    committer: sig,
    message: "second\n",
  });

  const retrieved = await getCommitData(bucket as any, child);
  assertEquals(retrieved!.parents, [parent]);
});

// ---- 5. putRawObject -> getRawObject roundtrip ----

Deno.test("object-store - putRawObject / getRawObject roundtrip - stores and retrieves a raw git object", async () => {
  bucket = new MockR2Bucket();
  // Construct a raw blob object: "blob <size>\0<content>"
  const content = encoder.encode("raw content");
  const header = encoder.encode(`blob ${content.length}\0`);
  const raw = new Uint8Array(header.length + content.length);
  raw.set(header);
  raw.set(content, header.length);

  const sha = await putRawObject(bucket as any, raw);
  assert(/^[0-9a-f]{40}$/.test(sha));

  const retrieved = await getRawObject(bucket as any, sha);
  assertNotEquals(retrieved, null);
  assertEquals(
    decoder.decode(retrieved!),
    `blob ${content.length}\0raw content`,
  );
});

// ---- 6. getObject with invalid SHA -> null ----

Deno.test("object-store - getObject with invalid SHA - returns null for a non-hex SHA", async () => {
  bucket = new MockR2Bucket();
  const result = await getObject(bucket as any, "not-a-valid-sha");
  assertEquals(result, null);
});

Deno.test("object-store - getObject with invalid SHA - returns null for a too-short SHA", async () => {
  bucket = new MockR2Bucket();
  const result = await getObject(bucket as any, "abcd1234");
  assertEquals(result, null);
});

Deno.test("object-store - getObject with invalid SHA - returns null for an empty string", async () => {
  bucket = new MockR2Bucket();
  const result = await getObject(bucket as any, "");
  assertEquals(result, null);
});

// ---- 7. getObject with nonexistent SHA -> null ----

Deno.test("object-store - getObject with nonexistent SHA - returns null for a valid but nonexistent SHA", async () => {
  bucket = new MockR2Bucket();
  const fakeSha = "a".repeat(40);
  const result = await getObject(bucket as any, fakeSha);
  assertEquals(result, null);
});

// ---- 8. objectExists true/false ----

Deno.test("object-store - objectExists - returns true for an existing object", async () => {
  bucket = new MockR2Bucket();
  const sha = await putBlob(bucket as any, encoder.encode("exists"));
  assertEquals(await objectExists(bucket as any, sha), true);
});

Deno.test("object-store - objectExists - returns false for a nonexistent object", async () => {
  bucket = new MockR2Bucket();
  const fakeSha = "b".repeat(40);
  assertEquals(await objectExists(bucket as any, fakeSha), false);
});

Deno.test("object-store - objectExists - returns false for an invalid SHA", async () => {
  bucket = new MockR2Bucket();
  assertEquals(await objectExists(bucket as any, "invalid"), false);
});

// ---- 9. deleteObject removes the object ----

Deno.test("object-store - deleteObject - removes a stored object", async () => {
  bucket = new MockR2Bucket();
  const sha = await putBlob(bucket as any, encoder.encode("to-delete"));
  assertEquals(await objectExists(bucket as any, sha), true);

  await deleteObject(bucket as any, sha);
  assertEquals(await objectExists(bucket as any, sha), false);
  assertEquals(await getBlob(bucket as any, sha), null);
});

Deno.test("object-store - deleteObject - is a no-op for an invalid SHA", async () => {
  bucket = new MockR2Bucket();
  // Should not throw
  await deleteObject(bucket as any, "invalid-sha");
});

// ---- 10. getCompressedObject returns inflatable data ----

Deno.test("object-store - getCompressedObject - returns compressed data that can be inflated back to the raw object", async () => {
  bucket = new MockR2Bucket();
  const content = encoder.encode("compress me");
  const sha = await putBlob(bucket as any, content);

  const compressed = await getCompressedObject(bucket as any, sha);
  assertNotEquals(compressed, null);
  assert(compressed!.length > 0);

  // Inflate and verify it produces a valid raw object
  const inflated = await inflate(compressed!);
  const text = decoder.decode(inflated);
  assertStringIncludes(text, "blob ");
  assertStringIncludes(text, "compress me");
});

Deno.test("object-store - getCompressedObject - returns null for a nonexistent SHA", async () => {
  bucket = new MockR2Bucket();
  const result = await getCompressedObject(bucket as any, "c".repeat(40));
  assertEquals(result, null);
});

Deno.test("object-store - getCompressedObject - returns null for an invalid SHA", async () => {
  bucket = new MockR2Bucket();
  const result = await getCompressedObject(bucket as any, "bad");
  assertEquals(result, null);
});

// ---- 11. deflate -> inflate roundtrip ----

Deno.test("object-store - deflate / inflate roundtrip - roundtrips arbitrary data", async () => {
  bucket = new MockR2Bucket();
  const original = encoder.encode(
    "The quick brown fox jumps over the lazy dog",
  );
  const compressed = await deflate(original);

  assert(compressed.length > 0);
  // Compressed should generally differ from original
  assertNotEquals(compressed, original);

  const decompressed = await inflate(compressed);
  assertEquals(
    decoder.decode(decompressed),
    "The quick brown fox jumps over the lazy dog",
  );
});

Deno.test("object-store - deflate / inflate roundtrip - roundtrips empty data", async () => {
  bucket = new MockR2Bucket();
  const original = new Uint8Array(0);
  const compressed = await deflate(original);
  const decompressed = await inflate(compressed);
  assertEquals(decompressed.length, 0);
});

Deno.test("object-store - deflate / inflate roundtrip - roundtrips binary data", async () => {
  bucket = new MockR2Bucket();
  const original = new Uint8Array([0, 1, 2, 255, 254, 128, 0, 0, 42]);
  const compressed = await deflate(original);
  const decompressed = await inflate(compressed);
  assertEquals(decompressed, original);
});
