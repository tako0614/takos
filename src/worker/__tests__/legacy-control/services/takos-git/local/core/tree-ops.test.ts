import { MockObjectStoreBinding } from "../../../../../../test/integration/setup.ts";
import {
  applyTreeChanges,
  assertValidGitPath,
  buildTreeFromPaths,
  createEmptyTree,
  createSingleFileTree,
  createTree,
  flattenTree,
  getBlobAtPath,
  getEntryAtPath,
  getTree,
  isValidGitPath,
  listDirectory,
} from "@/application/services/takos-git/local/core/tree-ops.ts";
import {
  putBlob,
  putTree,
} from "@/application/services/takos-git/local/core/object-store.ts";
import { FILE_MODES } from "@/application/services/takos-git/local/index.ts";
import type { TreeEntry } from "@/application/services/takos-git/local/index.ts";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "@std/assert";

const enc = new TextEncoder();

let bucket: InstanceType<typeof MockObjectStoreBinding>;

// ---------------------------------------------------------------------------
// Helper: store a blob and return its sha
// ---------------------------------------------------------------------------
async function storeBlob(content: string): Promise<string> {
  return putBlob(bucket, enc.encode(content));
}

// Helper: build a simple nested tree structure
// root/
//   file-a.txt  ("aaa")
//   dir/
//     file-b.txt ("bbb")
//     sub/
//       file-c.txt ("ccc")
async function buildNestedTree(): Promise<string> {
  const blobA = await storeBlob("aaa");
  const blobB = await storeBlob("bbb");
  const blobC = await storeBlob("ccc");

  const subTree = await putTree(bucket, [
    { mode: FILE_MODES.REGULAR_FILE, name: "file-c.txt", sha: blobC },
  ]);

  const dirTree = await putTree(bucket, [
    { mode: FILE_MODES.REGULAR_FILE, name: "file-b.txt", sha: blobB },
    { mode: FILE_MODES.DIRECTORY, name: "sub", sha: subTree },
  ]);

  const rootTree = await putTree(bucket, [
    { mode: FILE_MODES.DIRECTORY, name: "dir", sha: dirTree },
    { mode: FILE_MODES.REGULAR_FILE, name: "file-a.txt", sha: blobA },
  ]);

  return rootTree;
}

// ===========================================================================
// isValidGitPath
// ===========================================================================

Deno.test("isValidGitPath - accepts simple file name", () => {
  bucket = new MockObjectStoreBinding();
  assertEquals(isValidGitPath("README.md"), true);
});

Deno.test("isValidGitPath - accepts nested path", () => {
  bucket = new MockObjectStoreBinding();
  assertEquals(isValidGitPath("src/utils/helpers.ts"), true);
});

Deno.test("isValidGitPath - rejects empty string", () => {
  bucket = new MockObjectStoreBinding();
  assertEquals(isValidGitPath(""), false);
});

Deno.test("isValidGitPath - rejects leading slash", () => {
  bucket = new MockObjectStoreBinding();
  assertEquals(isValidGitPath("/foo.txt"), false);
});

Deno.test("isValidGitPath - rejects trailing slash", () => {
  bucket = new MockObjectStoreBinding();
  assertEquals(isValidGitPath("foo/"), false);
});

Deno.test("isValidGitPath - rejects double slash", () => {
  bucket = new MockObjectStoreBinding();
  assertEquals(isValidGitPath("foo//bar"), false);
});

Deno.test("isValidGitPath - rejects backslash", () => {
  bucket = new MockObjectStoreBinding();
  assertEquals(isValidGitPath("foo\\bar"), false);
});

Deno.test('isValidGitPath - rejects "." segment', () => {
  bucket = new MockObjectStoreBinding();
  assertEquals(isValidGitPath("foo/./bar"), false);
});

Deno.test('isValidGitPath - rejects ".." segment', () => {
  bucket = new MockObjectStoreBinding();
  assertEquals(isValidGitPath("foo/../bar"), false);
});

Deno.test("isValidGitPath - rejects null byte", () => {
  bucket = new MockObjectStoreBinding();
  assertEquals(isValidGitPath("foo\0bar"), false);
});

Deno.test("isValidGitPath - rejects control characters", () => {
  bucket = new MockObjectStoreBinding();
  assertEquals(isValidGitPath("foo\x01bar"), false);
});

Deno.test("isValidGitPath - rejects path exceeding max length", () => {
  bucket = new MockObjectStoreBinding();
  const longPath = "a".repeat(4097);
  assertEquals(isValidGitPath(longPath), false);
});

Deno.test("isValidGitPath - rejects non-string input", () => {
  bucket = new MockObjectStoreBinding();
  // Test the runtime guard against nullish input without round-tripping
  // through `unknown` (a demon pattern in this codebase).
  const erased = isValidGitPath as (value: unknown) => boolean;
  assertEquals(erased(undefined), false);
  assertEquals(erased(null), false);
});

// ===========================================================================
// assertValidGitPath
// ===========================================================================

Deno.test("assertValidGitPath - returns trimmed path when valid", () => {
  bucket = new MockObjectStoreBinding();
  assertEquals(assertValidGitPath("  foo/bar.txt  "), "foo/bar.txt");
});

Deno.test("assertValidGitPath - throws on invalid path", () => {
  bucket = new MockObjectStoreBinding();
  assertThrows(() => assertValidGitPath("/invalid"), "Invalid git path");
});

// ===========================================================================
// createTree / getTree
// ===========================================================================

Deno.test("createTree / getTree - creates and retrieves a tree", async () => {
  bucket = new MockObjectStoreBinding();
  const blobSha = await storeBlob("hello");
  const entries: TreeEntry[] = [
    { mode: FILE_MODES.REGULAR_FILE, name: "hello.txt", sha: blobSha },
  ];
  const treeSha = await createTree(bucket, entries);
  assert(/^[0-9a-f]{40}$/.test(treeSha));

  const result = await getTree(bucket, treeSha);
  assertNotEquals(result, null);
  assertEquals(result!.sha, treeSha);
  assertEquals(result!.entries.length, 1);
  assertEquals(result!.entries[0].name, "hello.txt");
});

Deno.test("createTree / getTree - returns null for non-existent sha", async () => {
  bucket = new MockObjectStoreBinding();
  const result = await getTree(bucket, "a".repeat(40));
  assertEquals(result, null);
});

// ===========================================================================
// createEmptyTree
// ===========================================================================

Deno.test("createEmptyTree - creates a tree with no entries", async () => {
  bucket = new MockObjectStoreBinding();
  const sha = await createEmptyTree(bucket);
  assert(/^[0-9a-f]{40}$/.test(sha));

  const result = await getTree(bucket, sha);
  assertNotEquals(result, null);
  assertEquals(result!.entries.length, 0);
});

// ===========================================================================
// createSingleFileTree
// ===========================================================================

Deno.test("createSingleFileTree - creates a tree with one blob", async () => {
  bucket = new MockObjectStoreBinding();
  const sha = await createSingleFileTree(
    bucket,
    "readme.txt",
    enc.encode("hi"),
  );
  const result = await getTree(bucket, sha);
  assertNotEquals(result, null);
  assertEquals(result!.entries.length, 1);
  assertEquals(result!.entries[0].name, "readme.txt");
  assertEquals(result!.entries[0].mode, FILE_MODES.REGULAR_FILE);
});

// ===========================================================================
// getEntryAtPath
// ===========================================================================

Deno.test("getEntryAtPath - returns root tree for empty path", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const entry = await getEntryAtPath(bucket, rootSha, "");
  assertNotEquals(entry, null);
  assertEquals(entry!.type, "tree");
  assertEquals(entry!.sha, rootSha);
});

Deno.test("getEntryAtPath - finds a file at root level", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const entry = await getEntryAtPath(bucket, rootSha, "file-a.txt");
  assertNotEquals(entry, null);
  assertEquals(entry!.type, "blob");
  assertEquals(entry!.name, "file-a.txt");
});

Deno.test("getEntryAtPath - finds a directory", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const entry = await getEntryAtPath(bucket, rootSha, "dir");
  assertNotEquals(entry, null);
  assertEquals(entry!.type, "tree");
});

Deno.test("getEntryAtPath - finds a deeply nested file", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const entry = await getEntryAtPath(
    bucket,
    rootSha,
    "dir/sub/file-c.txt",
  );
  assertNotEquals(entry, null);
  assertEquals(entry!.type, "blob");
  assertEquals(entry!.name, "file-c.txt");
});

Deno.test("getEntryAtPath - returns null for non-existent path", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const entry = await getEntryAtPath(
    bucket,
    rootSha,
    "no-such-file.txt",
  );
  assertEquals(entry, null);
});

Deno.test("getEntryAtPath - returns null for path through a blob", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const entry = await getEntryAtPath(
    bucket,
    rootSha,
    "file-a.txt/child",
  );
  assertEquals(entry, null);
});

Deno.test("getEntryAtPath - strips leading/trailing slashes from path", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const entry = await getEntryAtPath(bucket, rootSha, "/dir/");
  assertNotEquals(entry, null);
  assertEquals(entry!.type, "tree");
});

// ===========================================================================
// listDirectory
// ===========================================================================

Deno.test("listDirectory - lists root directory entries", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const entries = await listDirectory(bucket, rootSha);
  assertNotEquals(entries, null);
  assertEquals(entries!.length, 2);
  const names = entries!.map((e) => e.name).sort();
  assertEquals(names, ["dir", "file-a.txt"]);
});

Deno.test("listDirectory - lists a subdirectory", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const entries = await listDirectory(bucket, rootSha, "dir");
  assertNotEquals(entries, null);
  assertEquals(entries!.length, 2);
  const names = entries!.map((e) => e.name).sort();
  assertEquals(names, ["file-b.txt", "sub"]);
});

Deno.test("listDirectory - returns null when path is a blob", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const entries = await listDirectory(bucket, rootSha, "file-a.txt");
  assertEquals(entries, null);
});

Deno.test("listDirectory - returns null for non-existent path", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const entries = await listDirectory(bucket, rootSha, "nope");
  assertEquals(entries, null);
});

// ===========================================================================
// getBlobAtPath
// ===========================================================================

Deno.test("getBlobAtPath - returns blob content for a file", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const content = await getBlobAtPath(bucket, rootSha, "file-a.txt");
  assertNotEquals(content, null);
  assertEquals(new TextDecoder().decode(content!), "aaa");
});

Deno.test("getBlobAtPath - returns blob for nested file", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const content = await getBlobAtPath(
    bucket,
    rootSha,
    "dir/sub/file-c.txt",
  );
  assertNotEquals(content, null);
  assertEquals(new TextDecoder().decode(content!), "ccc");
});

Deno.test("getBlobAtPath - returns null for a directory path", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const content = await getBlobAtPath(bucket, rootSha, "dir");
  assertEquals(content, null);
});

Deno.test("getBlobAtPath - returns null for non-existent path", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const content = await getBlobAtPath(bucket, rootSha, "missing.txt");
  assertEquals(content, null);
});

// ===========================================================================
// flattenTree
// ===========================================================================

Deno.test("flattenTree - flattens a nested tree into file paths", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const files = await flattenTree(bucket, rootSha);
  assertEquals(files.length, 3);
  const paths = files.map((f) => f.path).sort();
  assertEquals(paths, ["dir/file-b.txt", "dir/sub/file-c.txt", "file-a.txt"]);
});

Deno.test("flattenTree - returns empty array for empty tree", async () => {
  bucket = new MockObjectStoreBinding();
  const sha = await createEmptyTree(bucket);
  const files = await flattenTree(bucket, sha);
  assertEquals(files.length, 0);
});

Deno.test("flattenTree - respects basePath prefix", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const files = await flattenTree(bucket, rootSha, "root");
  const paths = files.map((f) => f.path).sort();
  assertEquals(paths, [
    "root/dir/file-b.txt",
    "root/dir/sub/file-c.txt",
    "root/file-a.txt",
  ]);
});

Deno.test("flattenTree - throws on depth limit exceeded", async () => {
  bucket = new MockObjectStoreBinding();
  // Build a deeply nested single-entry chain: d1/d2/d3/file.txt at depth 3
  const blob = await storeBlob("deep");
  let currentTree = await putTree(bucket, [
    { mode: FILE_MODES.REGULAR_FILE, name: "file.txt", sha: blob },
  ]);
  for (let i = 0; i < 3; i++) {
    currentTree = await putTree(bucket, [
      { mode: FILE_MODES.DIRECTORY, name: `d${i}`, sha: currentTree },
    ]);
  }
  await assertRejects(async () => {
    await flattenTree(bucket, currentTree, "", { maxDepth: 2 });
  }, "depth limit exceeded");
});

Deno.test("flattenTree - throws on entry limit exceeded", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  await assertRejects(async () => {
    await flattenTree(bucket, rootSha, "", { maxEntries: 1 });
  }, "entry limit exceeded");
});

Deno.test("flattenTree - throws on symlink by default", async () => {
  bucket = new MockObjectStoreBinding();
  const blob = await storeBlob("target");
  const treeSha = await putTree(bucket, [
    { mode: FILE_MODES.SYMLINK, name: "link", sha: blob },
  ]);
  await assertRejects(async () => {
    await flattenTree(bucket, treeSha);
  }, "Symlink");
});

Deno.test("flattenTree - skips symlinks when skipSymlinks option is set", async () => {
  bucket = new MockObjectStoreBinding();
  const blob = await storeBlob("target");
  const realBlob = await storeBlob("real");
  const treeSha = await putTree(bucket, [
    { mode: FILE_MODES.SYMLINK, name: "link", sha: blob },
    { mode: FILE_MODES.REGULAR_FILE, name: "real.txt", sha: realBlob },
  ]);
  const files = await flattenTree(bucket, treeSha, "", {
    skipSymlinks: true,
  });
  assertEquals(files.length, 1);
  assertEquals(files[0].path, "real.txt");
});

// ===========================================================================
// buildTreeFromPaths
// ===========================================================================

Deno.test("buildTreeFromPaths - builds a tree from flat paths", async () => {
  bucket = new MockObjectStoreBinding();
  const blobA = await storeBlob("a");
  const blobB = await storeBlob("b");

  const treeSha = await buildTreeFromPaths(bucket, [
    { path: "file-a.txt", sha: blobA },
    { path: "dir/file-b.txt", sha: blobB },
  ]);

  const files = await flattenTree(bucket, treeSha);
  const paths = files.map((f) => f.path).sort();
  assertEquals(paths, ["dir/file-b.txt", "file-a.txt"]);
});

Deno.test("buildTreeFromPaths - uses custom file mode", async () => {
  bucket = new MockObjectStoreBinding();
  const blob = await storeBlob("#!/bin/sh");
  const treeSha = await buildTreeFromPaths(bucket, [
    { path: "run.sh", sha: blob, mode: FILE_MODES.EXECUTABLE },
  ]);
  const tree = await getTree(bucket, treeSha);
  assertEquals(tree!.entries[0].mode, FILE_MODES.EXECUTABLE);
});

Deno.test("buildTreeFromPaths - throws on path conflict (file where directory expected)", async () => {
  bucket = new MockObjectStoreBinding();
  const blob = await storeBlob("x");
  await assertRejects(async () => {
    await buildTreeFromPaths(bucket, [
      { path: "a", sha: blob },
      { path: "a/b.txt", sha: blob },
    ]);
  }, "Path conflict");
});

Deno.test("buildTreeFromPaths - throws on invalid path", async () => {
  bucket = new MockObjectStoreBinding();
  const blob = await storeBlob("x");
  await assertRejects(async () => {
    await buildTreeFromPaths(bucket, [{ path: "/bad", sha: blob }]);
  }, "Invalid git path");
});

// ===========================================================================
// applyTreeChanges
// ===========================================================================

Deno.test("applyTreeChanges - adds a new file to existing tree", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const newBlob = await storeBlob("new content");

  const newTreeSha = await applyTreeChanges(bucket, rootSha, [
    { path: "new-file.txt", operation: "add", sha: newBlob },
  ]);

  const files = await flattenTree(bucket, newTreeSha);
  const paths = files.map((f) => f.path).sort();
  assert(paths.includes("new-file.txt"));
  assertEquals(paths.length, 4);
});

Deno.test("applyTreeChanges - deletes a file from existing tree", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();

  const newTreeSha = await applyTreeChanges(bucket, rootSha, [
    { path: "file-a.txt", operation: "delete" },
  ]);

  const files = await flattenTree(bucket, newTreeSha);
  const paths = files.map((f) => f.path);
  assert(!paths.includes("file-a.txt"));
  assertEquals(files.length, 2);
});

Deno.test("applyTreeChanges - modifies an existing file", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const updatedBlob = await storeBlob("updated aaa");

  const newTreeSha = await applyTreeChanges(bucket, rootSha, [
    { path: "file-a.txt", operation: "modify", sha: updatedBlob },
  ]);

  const content = await getBlobAtPath(bucket, newTreeSha, "file-a.txt");
  assertEquals(new TextDecoder().decode(content!), "updated aaa");
});

Deno.test("applyTreeChanges - handles multiple changes at once", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const newBlob = await storeBlob("added");

  const newTreeSha = await applyTreeChanges(bucket, rootSha, [
    { path: "file-a.txt", operation: "delete" },
    { path: "new.txt", operation: "add", sha: newBlob },
    { path: "dir/file-b.txt", operation: "modify", sha: newBlob },
  ]);

  const files = await flattenTree(bucket, newTreeSha);
  const paths = files.map((f) => f.path).sort();
  assertEquals(paths, ["dir/file-b.txt", "dir/sub/file-c.txt", "new.txt"]);
});

Deno.test("applyTreeChanges - throws when sha is missing for add operation", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  await assertRejects(async () => {
    await applyTreeChanges(bucket, rootSha, [
      { path: "file.txt", operation: "add" },
    ]);
  }, "SHA required");
});

Deno.test("applyTreeChanges - adds a file in a new nested directory", async () => {
  bucket = new MockObjectStoreBinding();
  const rootSha = await buildNestedTree();
  const blob = await storeBlob("deep");

  const newTreeSha = await applyTreeChanges(bucket, rootSha, [
    { path: "new-dir/nested/deep.txt", operation: "add", sha: blob },
  ]);

  const entry = await getEntryAtPath(
    bucket,
    newTreeSha,
    "new-dir/nested/deep.txt",
  );
  assertNotEquals(entry, null);
  assertEquals(entry!.type, "blob");
});
