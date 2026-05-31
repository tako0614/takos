import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { strict as assert } from "node:assert";
import { test } from "bun:test";

const rootDir = fileURLToPath(new URL("../../../../", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}
test("worker entrypoint contract - routes every managed worker through the runtime app entrypoints", () => {
  const cases = [
    ["deploy/cloudflare/wrangler.toml", "src/worker/index.ts"],
    ["deploy/cloudflare/wrangler.dispatch.toml", "src/worker/dispatch.ts"],
    [
      "deploy/cloudflare/wrangler.runtime-host.toml",
      "src/worker/runtime/container-hosts/runtime-host.ts",
    ],
    [
      "deploy/cloudflare/wrangler.executor.toml",
      "src/worker/runtime/container-hosts/executor-host.ts",
    ],
  ] as const;

  for (const [configPath, expectedMain] of cases) {
    const contents = read(configPath);
    assert.ok(contents.includes(`main = "${expectedMain}"`));
  }
});

test("worker entrypoint contract - does not require markdown module rules on Cloudflare worker configs", () => {
  const markdownConfigs = [
    "deploy/cloudflare/wrangler.toml",
    "deploy/cloudflare/wrangler.executor.toml",
  ] as const;

  for (const configPath of markdownConfigs) {
    const contents = read(configPath);
    assert.ok(!contents.includes('type = "Text"'));
    assert.ok(!contents.includes('globs = ["**/*.md"]'));
  }
});
