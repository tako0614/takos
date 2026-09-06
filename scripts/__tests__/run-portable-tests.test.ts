import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverTestFiles } from "../run-portable-tests.ts";

async function git(root: string, args: readonly string[]): Promise<void> {
  const command = Bun.spawn(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(command.stdout).text(),
    new Response(command.stderr).text(),
  ]);
  if ((await command.exited) !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stderr || stdout}`);
  }
}

test("test discovery includes tracked and untracked tests but excludes ignored/non-tests", async () => {
  const root = await mkdtemp(join(tmpdir(), "takos-portable-test-discovery-"));
  try {
    await git(root, ["init", "--quiet"]);

    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "fixture"), { recursive: true });
    await writeFile(join(root, ".gitignore"), "ignored.test.ts\nnode_modules/\n");
    await writeFile(join(root, "tracked.test.ts"), "export {};");
    await writeFile(join(root, "src", "untracked.test.ts"), "export {};");
    await writeFile(join(root, "src", "helper.ts"), "export {};");
    await writeFile(join(root, "ignored.test.ts"), "export {};");
    await writeFile(
      join(root, "node_modules", "fixture", "dependency.test.ts"),
      "export {};",
    );

    await git(root, ["add", ".gitignore", "tracked.test.ts", "src/helper.ts"]);

    await expect(discoverTestFiles(root)).resolves.toEqual([
      "src/untracked.test.ts",
      "tracked.test.ts",
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
