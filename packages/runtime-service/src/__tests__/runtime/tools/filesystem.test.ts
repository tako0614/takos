import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { assertEquals, assertRejects } from "jsr:@std/assert";

import { createSandboxFilesystem } from "../../../runtime/tools/filesystem.ts";

Deno.test("execute-tool worker message forwards filePermission", async () => {
  const originalTakosApiUrl = Deno.env.get("TAKOS_API_URL");
  Deno.env.set("TAKOS_API_URL", "https://takos.example.test");

  try {
    const { buildToolWorkerMessage } = await import(
      "../../../routes/runtime/tools.ts"
    );
    const message = buildToolWorkerMessage(
      {
        code: "module.exports = {}",
        toolName: "tool",
        parameters: {},
        secrets: {},
        config: {},
        permissions: {
          allowedDomains: ["example.com"],
          filePermission: "write",
        },
      },
      1_000,
    );

    assertEquals(message.filePermission, "write");
    assertEquals(message.allowedDomains, ["example.com"]);
  } finally {
    if (originalTakosApiUrl === undefined) {
      Deno.env.delete("TAKOS_API_URL");
    } else {
      Deno.env.set("TAKOS_API_URL", originalTakosApiUrl);
    }
  }
});

Deno.test("sandbox filesystem enforces read, write, and none permissions", async () => {
  const baseDir = await mkdtemp(path.join(tmpdir(), "takos-runtime-tool-"));
  const readableFile = path.join(baseDir, "notes.txt");
  await writeFile(readableFile, "hello", "utf-8");

  try {
    const readFs = createSandboxFilesystem("read", baseDir);
    assertEquals(await readFs.readFile("notes.txt"), "hello");
    await assertRejects(
      () => readFs.writeFile("notes.txt", "world"),
      Error,
      "Filesystem access denied",
    );
    await assertRejects(
      () => readFs.rm("notes.txt"),
      Error,
      "Filesystem access denied",
    );

    const writeFs = createSandboxFilesystem("write", baseDir);
    await writeFs.writeFile("nested/output.txt", "updated");
    assertEquals(
      await readFile(path.join(baseDir, "nested/output.txt"), "utf-8"),
      "updated",
    );
    assertEquals(await writeFs.readFile("nested/output.txt"), "updated");

    const noneFs = createSandboxFilesystem("none", baseDir);
    await assertRejects(
      () => noneFs.readFile("notes.txt"),
      Error,
      "Filesystem access denied",
    );

    await assertRejects(
      () => writeFs.readFile("../outside.txt"),
      Error,
      "Invalid file path",
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

Deno.test("sandbox filesystem rejects symlink escapes", async () => {
  const baseDir = await mkdtemp(path.join(tmpdir(), "takos-runtime-tool-"));
  const outsideDir = await mkdtemp(
    path.join(tmpdir(), "takos-runtime-outside-"),
  );
  const outsideFile = path.join(outsideDir, "secret.txt");
  await writeFile(outsideFile, "secret", "utf-8");

  try {
    await symlink(outsideFile, path.join(baseDir, "escape.txt"));
    await symlink(outsideDir, path.join(baseDir, "escape-dir"));

    const readFs = createSandboxFilesystem("read", baseDir);
    await assertRejects(
      () => readFs.readFile("escape.txt"),
      Error,
      "Symlink escape detected in file path",
    );

    const writeFs = createSandboxFilesystem("write", baseDir);
    await assertRejects(
      () => writeFs.writeFile("escape-dir/pwned.txt", "pwned"),
      Error,
      "Symlink escape detected in file path",
    );
    await assertRejects(
      () => writeFs.rm("escape.txt"),
      Error,
      "Symlink escape detected in target path",
    );

    await mkdir(path.join(baseDir, "safe-dir"));
    await writeFs.writeFile("safe-dir/notes.txt", "safe");
    assertEquals(
      await readFile(path.join(baseDir, "safe-dir/notes.txt"), "utf-8"),
      "safe",
    );
    assertEquals(await readFile(outsideFile, "utf-8"), "secret");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});
