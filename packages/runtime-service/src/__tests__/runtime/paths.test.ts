import * as fs from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";

import {
  getRepoPath,
  isPathWithinBase,
  resolvePathWithin,
  resolveRepoGitPath,
  verifyNoSymlinkPathComponents,
  verifyPathWithinAfterAccess,
} from "../../runtime/paths.ts";
import {
  SymlinkEscapeError,
  SymlinkNotAllowedError,
} from "../../shared/errors.ts";

import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";

Deno.test("isPathWithinBase - handles base comparisons", () => {
  assertEquals(isPathWithinBase("/base", "/base/child"), true);
  assertEquals(isPathWithinBase("/base", "/base"), true);
  assertEquals(isPathWithinBase("/base", "/base", { allowBase: false }), false);
  assertEquals(isPathWithinBase("/base", "/other/path"), false);
  assertEquals(isPathWithinBase("/base", "/base/../other"), false);
  assertEquals(
    isPathWithinBase("/tmp", "/tmp/./child", { resolveInputs: true }),
    true,
  );
});

Deno.test("resolvePathWithin - validates paths", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "takos-paths-test-"));
  try {
    assertEquals(
      resolvePathWithin(tempDir, "subdir/file.txt", "test"),
      path.resolve(tempDir, "subdir/file.txt"),
    );
    assertThrows(() => resolvePathWithin(tempDir, "", "test"));
    assertThrows(() => resolvePathWithin(tempDir, "   ", "test"));
    assertThrows(() => resolvePathWithin(tempDir, "/etc/passwd", "test"));
    assertThrows(() => resolvePathWithin(tempDir, "../etc/passwd", "test"));
    assertEquals(
      resolvePathWithin(
        tempDir,
        path.join(tempDir, "allowed"),
        "test",
        false,
        true,
      ),
      path.resolve(tempDir, "allowed"),
    );
    assertThrows(() =>
      resolvePathWithin(tempDir, "/completely/different", "test", false, true)
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

Deno.test("getRepoPath - validates repository components", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "takos-paths-test-"));
  try {
    assertEquals(
      getRepoPath("workspace1", "myrepo"),
      path.join("/repos", "workspace1", "myrepo.git"),
    );
    assertThrows(() => getRepoPath("", "myrepo"));
    assertThrows(() => getRepoPath("ws1", ""));
    assertThrows(() => getRepoPath("ws/../evil", "repo"));
    assertThrows(() => getRepoPath("ws1", "repo/../../evil"));
    assertThrows(() => getRepoPath("_ws", "repo"));
    assertThrows(() => getRepoPath("ws1", "a".repeat(129)));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

Deno.test("resolveRepoGitPath - validates repo .git paths", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "takos-paths-test-"));
  try {
    const p = "/repos/ws1/myrepo.git";
    assertEquals(resolveRepoGitPath(p), path.resolve(p));
    assertThrows(() => resolveRepoGitPath("ws1/myrepo.git"));
    assertThrows(() => resolveRepoGitPath("/repos/ws1/myrepo"));
    assertThrows(() => resolveRepoGitPath("/other/ws1/myrepo.git"));
    assertThrows(() => resolveRepoGitPath("/repos"));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

Deno.test("verifyPathWithinAfterAccess - resolves and rejects symlink escapes", async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "takos-paths-test-"));
  try {
    const child = path.join(baseDir, "child");
    await fs.mkdir(child, { recursive: true });
    assertEquals(
      await verifyPathWithinAfterAccess(baseDir, child, "test"),
      await fs.realpath(child),
    );

    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "outside-"));
    try {
      await assertRejects(
        () => verifyPathWithinAfterAccess(baseDir, outside, "test"),
        SymlinkEscapeError,
      );
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true });
  }
});

Deno.test("verifyNoSymlinkPathComponents - validates symlink-safe paths", async () => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "takos-paths-test-"));
  try {
    const child = path.join(baseDir, "a", "b");
    await fs.mkdir(child, { recursive: true });
    await verifyNoSymlinkPathComponents(baseDir, child, "test");

    const realDir = path.join(baseDir, "real");
    await fs.mkdir(realDir, { recursive: true });
    const symlinkDir = path.join(baseDir, "sym");
    await fs.symlink(realDir, symlinkDir);
    await assertRejects(
      () =>
        verifyNoSymlinkPathComponents(
          baseDir,
          path.join(symlinkDir, "file"),
          "test",
        ),
      SymlinkNotAllowedError,
    );

    await verifyNoSymlinkPathComponents(
      baseDir,
      path.join(baseDir, "nonexistent", "deep", "path"),
      "test",
    );
    await verifyNoSymlinkPathComponents(baseDir, baseDir, "test");
  } finally {
    await fs.rm(baseDir, { recursive: true, force: true });
  }
});
