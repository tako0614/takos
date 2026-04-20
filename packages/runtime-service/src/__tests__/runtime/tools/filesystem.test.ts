import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
