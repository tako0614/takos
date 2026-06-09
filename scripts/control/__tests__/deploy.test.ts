import { test } from "bun:test";
import assert from "node:assert/strict";

import { buildDeployCommands, getWranglerDeployArgs } from "../deploy.mjs";

test("getWranglerDeployArgs omits --env for production", () => {
  assert.deepEqual(getWranglerDeployArgs("production"), []);
  assert.deepEqual(getWranglerDeployArgs("staging"), ["--env", "staging"]);
});

test("buildDeployCommands applies control-DB D1 migrations before the production worker deploy", () => {
  assert.deepEqual(buildDeployCommands("worker", "production"), [
    "bun run build",
    "bunx wrangler d1 migrations apply DB --remote --config deploy/cloudflare/wrangler.toml",
    "bunx wrangler deploy --config deploy/cloudflare/wrangler.toml",
  ]);
});

test("buildDeployCommands supports the worker staging debug build", () => {
  assert.deepEqual(buildDeployCommands("worker", "staging", { debug: true }), [
    "bun run build --mode staging-debug",
    "bunx wrangler d1 migrations apply DB --remote --config deploy/cloudflare/wrangler.toml --env staging",
    "bunx wrangler deploy --config deploy/cloudflare/wrangler.toml --env staging",
  ]);
});

test("buildDeployCommands rejects unknown services", () => {
  assert.throws(() => buildDeployCommands("dispatch", "production"));
});
