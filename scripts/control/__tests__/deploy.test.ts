import { test } from "bun:test";
import assert from "node:assert/strict";

import { buildDeployCommands, getWranglerDeployArgs } from "../deploy.mjs";

test("getWranglerDeployArgs omits --env for production", () => {
  assert.deepEqual(getWranglerDeployArgs("production"), []);
  assert.deepEqual(getWranglerDeployArgs("staging"), ["--env", "staging"]);
});

test("buildDeployCommands uses the unified Wrangler config for production worker deploys", () => {
  assert.deepEqual(buildDeployCommands("worker", "production"), [
    "bun run build",
    "bunx wrangler deploy --config deploy/cloudflare/wrangler.toml",
  ]);
});

test("buildDeployCommands targets the staging overlay for dispatch workers", () => {
  assert.deepEqual(buildDeployCommands("dispatch", "staging"), [
    "bunx wrangler deploy --config deploy/cloudflare/wrangler.dispatch.toml --env staging",
  ]);
});

test("buildDeployCommands supports the worker staging debug build", () => {
  assert.deepEqual(buildDeployCommands("worker", "staging", { debug: true }), [
    "bun run build --mode staging-debug",
    "bunx wrangler deploy --config deploy/cloudflare/wrangler.toml --env staging",
  ]);
});
