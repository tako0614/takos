import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { strict as assert } from "node:assert";
import { test } from "bun:test";

const takosRoot = fileURLToPath(new URL("../../../../", import.meta.url));

function read(relativePath: string): string {
  return readFileSync(path.join(takosRoot, relativePath), "utf8");
}

test("platform architecture contract - canonical Takos layout is single worker plus containers", () => {
  for (
    const requiredPath of [
      "src/worker",
      "src/contracts/git",
      "src/contracts/agent",
      "web",
      "containers/git",
      "containers/agent",
    ]
  ) {
    assert.ok(existsSync(path.join(takosRoot, requiredPath)), `${requiredPath} must exist`);
  }

  for (const removedPath of ["app", "git", "agent", "packages/control", "packages/control-shared"]) {
    assert.deepStrictEqual(existsSync(path.join(takosRoot, removedPath)), false, `${removedPath} must stay removed`);
  }
});

test("platform architecture contract - Worker and container entrypoints use canonical files", () => {
  assert.ok(
    read("deploy/cloudflare/wrangler.toml").includes(
      'main = "src/worker/index.ts"',
    ),
  );
  assert.ok(
    read("containers/git/package.json").includes(
      '"dev": "bun --watch src/index.ts"',
    ),
  );
  assert.ok(
    read("containers/agent/Cargo.toml").includes(
      'path = "../../../takos-agent-engine"',
    ),
  );
});
