import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, assertStringIncludes } from "jsr:@std/assert";

function assertSourceMatches(source: string, pattern: RegExp): void {
  assert(
    pattern.test(source),
    `Expected source to match ${pattern}`,
  );
}

Deno.test("runtime app shell - uses the workspace package in ts mode and the built service artifact in js mode", async () => {
  const testDir = path.dirname(fileURLToPath(import.meta.url));
  const source = await readFile(
    path.resolve(testDir, "../src/index.ts"),
    "utf8",
  );

  assertSourceMatches(source, /const pkg = ["']takos-runtime-service["'];/);
  assertStringIncludes(source, "await import(pkg)");
  assertStringIncludes(
    source,
    "../../../packages/runtime-service/dist/index.js",
  );
});
