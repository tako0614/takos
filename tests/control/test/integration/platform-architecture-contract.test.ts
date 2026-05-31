import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, assertEquals, assertStringIncludes } from "@std/assert";

const takosRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(path.join(takosRoot, relativePath), "utf8");
}

Deno.test("platform architecture contract - canonical Takos layout is single worker plus containers", () => {
  for (
    const requiredPath of [
      "src/worker",
      "src/routes/public",
      "src/contracts/git",
      "src/contracts/agent",
      "web",
      "containers/git",
      "containers/agent",
    ]
  ) {
    assert(existsSync(path.join(takosRoot, requiredPath)), `${requiredPath} must exist`);
  }

  for (const removedPath of ["app", "git", "agent", "packages/control", "packages/control-shared"]) {
    assertEquals(existsSync(path.join(takosRoot, removedPath)), false, `${removedPath} must stay removed`);
  }
});

Deno.test("platform architecture contract - Worker and container entrypoints use canonical files", () => {
  assertStringIncludes(
    read("deploy/cloudflare/wrangler.toml"),
    'main = "src/worker/index.ts"',
  );
  assertStringIncludes(
    read("deploy/cloudflare/wrangler.dispatch.toml"),
    'main = "src/worker/dispatch.ts"',
  );
  assertStringIncludes(
    read("deploy/cloudflare/wrangler.runtime-host.toml"),
    'main = "src/worker/runtime/container-hosts/runtime-host.ts"',
  );
  assertStringIncludes(
    read("deploy/cloudflare/wrangler.executor.toml"),
    'main = "src/worker/runtime/container-hosts/executor-host.ts"',
  );
  assertStringIncludes(read("containers/git/package.json"), '"dev": "bun --watch src/index.ts"');
  assertStringIncludes(read("containers/agent/Cargo.toml"), 'path = "../../../takos-agent-engine"');
});
