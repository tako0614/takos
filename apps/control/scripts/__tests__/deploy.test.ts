import { assertEquals } from "jsr:@std/assert";

import { buildDeployCommands, getWranglerDeployArgs } from "../deploy.mjs";

Deno.test("getWranglerDeployArgs omits --env for production", () => {
  assertEquals(getWranglerDeployArgs("production"), []);
  assertEquals(getWranglerDeployArgs("staging"), ["--env", "staging"]);
});

Deno.test("buildDeployCommands uses the base Wrangler config for production web deploys", () => {
  assertEquals(buildDeployCommands("web", "production"), [
    "deno task build",
    "deno run -A npm:wrangler deploy",
  ]);
});

Deno.test("buildDeployCommands targets the staging overlay for non-web workers", () => {
  assertEquals(buildDeployCommands("worker", "staging"), [
    "deno run -A npm:wrangler deploy --config wrangler.worker.toml --env staging",
  ]);
});
