import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, assertStringIncludes } from "jsr:@std/assert";

const rootDir = fileURLToPath(new URL("../..", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}
Deno.test("worker entrypoint contract - routes every first-party worker through the runtime app entrypoints", () => {
  const cases = [
    ["wrangler.toml", "src/web.ts"],
    ["wrangler.dispatch.toml", "src/dispatch.ts"],
    ["wrangler.worker.toml", "src/worker.ts"],
    ["wrangler.runtime-host.toml", "src/runtime-host.ts"],
    ["wrangler.executor.toml", "src/executor-host.ts"],
    ["wrangler.browser-host.toml", "src/browser-host.ts"],
  ] as const;

  for (const [configPath, expectedMain] of cases) {
    const contents = read(configPath);
    assertStringIncludes(contents, `main = "${expectedMain}"`);
  }
});

Deno.test("worker entrypoint contract - does not require markdown module rules on Cloudflare worker configs", () => {
  const markdownConfigs = [
    "wrangler.toml",
    "wrangler.worker.toml",
    "wrangler.executor.toml",
  ] as const;

  for (const configPath of markdownConfigs) {
    const contents = read(configPath);
    assert(!contents.includes('type = "Text"'));
    assert(!contents.includes('globs = ["**/*.md"]'));
  }
});
