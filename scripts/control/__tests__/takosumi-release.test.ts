import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  buildTakosumiReleaseCommands,
  readReleaseOutputs,
} from "../takosumi-release.mjs";

const rawOutputs = {
  cloudflare_account_id: "acc_123",
  cloudflare_accounts_d1_database_id: "d1_accounts",
};

test("buildTakosumiReleaseCommands runs generic operator activation steps", () => {
  assert.deepEqual(
    buildTakosumiReleaseCommands(rawOutputs, "production", {
      zoneId: "zone_123",
      takosumiRepoDir: "../takosumi",
    }),
    [
      "'bun' 'scripts/control/render-wrangler-from-tofu.mjs' 'production' '--zone-id' 'zone_123'",
      "'bun' 'run' 'build'",
      "'bunx' 'wrangler' 'd1' 'migrations' 'apply' 'DB' '--remote' '--config' 'deploy/cloudflare/wrangler.toml'",
      "'bun' '--cwd' '../takosumi' 'run' 'cli' '--' 'accounts' 'migrate-d1' '--database-id' 'd1_accounts' '--account-id' 'acc_123' '--remote'",
      "'bunx' 'wrangler' 'deploy' '--config' 'deploy/cloudflare/wrangler.toml'",
    ],
  );
});

test("buildTakosumiReleaseCommands supports staging debug deploys", () => {
  assert.deepEqual(
    buildTakosumiReleaseCommands(rawOutputs, "staging", {
      debug: true,
      takosumiRepoDir: "/opt/takosumi",
    }),
    [
      "'bun' 'scripts/control/render-wrangler-from-tofu.mjs' 'staging'",
      "'bun' 'run' 'build' '--mode' 'staging-debug'",
      "'bunx' 'wrangler' 'd1' 'migrations' 'apply' 'DB' '--remote' '--config' 'deploy/cloudflare/wrangler.toml' '--env' 'staging'",
      "'bun' '--cwd' '/opt/takosumi' 'run' 'cli' '--' 'accounts' 'migrate-d1' '--database-id' 'd1_accounts' '--account-id' 'acc_123' '--remote'",
      "'bunx' 'wrangler' 'deploy' '--config' 'deploy/cloudflare/wrangler.toml' '--env' 'staging'",
    ],
  );
});

test("readReleaseOutputs requires Takosumi non-sensitive outputs", () => {
  assert.deepEqual(
    readReleaseOutputs({
      TAKOSUMI_OUTPUTS_JSON: JSON.stringify(rawOutputs),
    }),
    rawOutputs,
  );
  assert.throws(() => readReleaseOutputs({}));
});
