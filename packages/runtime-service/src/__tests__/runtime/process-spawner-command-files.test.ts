import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { assertEquals } from "jsr:@std/assert";

import {
  parseKeyValueFile,
  parsePathFile,
} from "../../runtime/actions/file-parsers.ts";

async function loadProcessSpawner() {
  Deno.env.set("TAKOS_API_URL", "https://takos.example.test");
  return await import("../../runtime/actions/process-spawner.ts");
}

type TestSpawnContext = {
  env: Record<string, string>;
  logs: string[];
  outputs: Record<string, string>;
  workspacePath: string;
  parseWorkflowCommands: (text: string) => void;
  parseKeyValueFile: (content: string) => Record<string, string>;
  parsePathFile: (content: string) => string[];
};

function createContext(
  workspacePath: string,
  initialEnv: Record<string, string>,
): TestSpawnContext {
  return {
    env: { ...initialEnv },
    logs: [],
    outputs: {},
    workspacePath,
    parseWorkflowCommands: () => {},
    parseKeyValueFile,
    parsePathFile,
  };
}

async function createPreparedCommandFiles(workspacePath: string) {
  const commandDir = path.join(workspacePath, ".runner", "commands");
  await fs.mkdir(commandDir, { recursive: true });
  const files = {
    output: path.join(commandDir, "output.txt"),
    env: path.join(commandDir, "env.txt"),
    path: path.join(commandDir, "path.txt"),
    summary: path.join(commandDir, "summary.md"),
  };
  await Promise.all(Object.values(files).map((file) => fs.writeFile(file, "")));
  return { envVars: {}, files };
}

Deno.test("applyCommandFiles filters env and PATH boundary escape inputs", async () => {
  const workspacePath = await fs.mkdtemp(
    path.join(os.tmpdir(), "takos-command-files-"),
  );
  try {
    const { applyCommandFiles } = await loadProcessSpawner();
    const safeBin = path.join(workspacePath, "bin");
    await fs.mkdir(safeBin);
    const prepared = await createPreparedCommandFiles(workspacePath);

    await fs.writeFile(
      prepared.files.output,
      "safe-output=ok\nconstructor=blocked\n",
    );
    await fs.writeFile(
      prepared.files.env,
      [
        "SAFE_ENV=ok",
        "BASH_ENV=/tmp/payload.sh",
        "GITHUB_ENV=/tmp/evil",
        "NODE_OPTIONS=--require /tmp/payload.js",
        "PATH=/tmp/evil",
        "INVALID-KEY=bad",
      ].join("\n"),
    );
    await fs.writeFile(
      prepared.files.path,
      [
        safeBin,
        "relative-bin",
        `${safeBin}${path.delimiter}/tmp/evil`,
        path.join(workspacePath, "missing"),
      ].join("\n"),
    );

    const ctx = createContext(workspacePath, { PATH: "/usr/bin" });
    await applyCommandFiles(prepared, ctx);

    assertEquals(ctx.outputs["safe-output"], "ok");
    assertEquals(Object.hasOwn(ctx.outputs, "constructor"), false);
    assertEquals(ctx.env.SAFE_ENV, "ok");
    assertEquals(ctx.env.BASH_ENV, undefined);
    assertEquals(ctx.env.GITHUB_ENV, undefined);
    assertEquals(ctx.env.NODE_OPTIONS, undefined);
    assertEquals(ctx.env["INVALID-KEY"], undefined);
    assertEquals(ctx.env.PATH, `/usr/bin${path.delimiter}${safeBin}`);
  } finally {
    await fs.rm(workspacePath, { recursive: true, force: true });
  }
});

Deno.test("applyCommandFiles skips command files replaced with symlinks", async () => {
  if (Deno.build.os === "windows") {
    return;
  }

  const workspacePath = await fs.mkdtemp(
    path.join(os.tmpdir(), "takos-command-files-"),
  );
  try {
    const { applyCommandFiles } = await loadProcessSpawner();
    const prepared = await createPreparedCommandFiles(workspacePath);
    const outside = path.join(workspacePath, "outside-env.txt");
    await fs.writeFile(outside, "SECRET_ENV=leaked\n");
    await fs.rm(prepared.files.env);
    await fs.symlink(outside, prepared.files.env);

    const ctx = createContext(workspacePath, {});
    await applyCommandFiles(prepared, ctx);

    assertEquals(ctx.env.SECRET_ENV, undefined);
  } finally {
    await fs.rm(workspacePath, { recursive: true, force: true });
  }
});
