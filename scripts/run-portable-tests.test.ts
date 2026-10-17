import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { discoverTestFiles, runTests } from "./run-portable-tests.ts";

test("portable runner executes only Git-discovered canonical paths", async () => {
  const tempParent = resolve(import.meta.dir, "../tmp/ga-sse-recovery");
  await mkdir(tempParent, { recursive: true });
  const tempRoot = await mkdtemp(join(tempParent, "portable-runner-"));
  try {
    const initialized = Bun.spawn(["git", "init", "--quiet"], {
      cwd: tempRoot,
      stdout: "ignore",
      stderr: "pipe",
    });
    const initError = await new Response(initialized.stderr).text();
    assert.equal(await initialized.exited, 0, initError);

    await writeFile(resolve(tempRoot, ".gitignore"), "tmp/copy/\n");
    await mkdir(resolve(tempRoot, "src"), { recursive: true });
    await mkdir(resolve(tempRoot, "tmp/copy/src"), { recursive: true });
    await writeFile(
      resolve(tempRoot, "src/example.test.ts"),
      `import { writeFileSync } from "node:fs";
import { test, expect } from "bun:test";
writeFileSync(new URL("../canonical-marker", import.meta.url), "ran");
test("canonical test runs", () => expect(true).toBe(true));
`,
    );
    await writeFile(
      resolve(tempRoot, "tmp/copy/src/example.test.ts"),
      `import { writeFileSync } from "node:fs";
writeFileSync(new URL("../../../poison-marker", import.meta.url), "ran");
throw new Error("ignored suffix copy executed");
`,
    );

    const selected = await discoverTestFiles(tempRoot);
    const passed = await runTests(selected, "ignore", tempRoot);
    let canonicalMarker: string | null = null;
    let poisonMarker: string | null = null;
    try {
      canonicalMarker = await readFile(
        resolve(tempRoot, "canonical-marker"),
        "utf8",
      );
    } catch {}
    try {
      poisonMarker = await readFile(resolve(tempRoot, "poison-marker"), "utf8");
    } catch {}

    console.log("portable path regression evidence", JSON.stringify({
      selected,
      passed,
      canonicalMarker,
      poisonMarker,
    }));
    assert.deepEqual(selected, ["src/example.test.ts"]);
    assert.equal(passed, true);
    assert.equal(canonicalMarker, "ran");
    assert.equal(poisonMarker, null);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
