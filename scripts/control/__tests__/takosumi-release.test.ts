import { test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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

test("Takos OpenTofu modules declare generic Takosumi post-apply release commands", () => {
  const rootModule = readFileSync(
    new URL("../../../deploy/opentofu/outputs.tf", import.meta.url),
    "utf8",
  );
  assert.match(rootModule, /output\s+"takosumi_release"\s*\{/);
  assert.match(rootModule, /post_apply\s*=\s*\[/);
  assert.match(rootModule, /id\s*=\s*"takos-worker-release"/);
  assert.match(rootModule, /executor\s*=\s*"operator"/);
  assert.match(
    rootModule,
    /command\s*=\s*\["bun",\s*"scripts\/control\/takosumi-release\.mjs",\s*var\.environment\]/,
  );

  const productionModule = readFileSync(
    new URL(
      "../../../deploy/opentofu/environments/cloudflare-prod/main.tf",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(productionModule, /output\s+"takosumi_release"\s*\{/);
  assert.match(productionModule, /post_apply\s*=\s*\[/);
  assert.match(productionModule, /id\s*=\s*"takos-worker-release"/);
  assert.match(productionModule, /executor\s*=\s*"operator"/);
  assert.match(
    productionModule,
    /command\s*=\s*\["bun",\s*"scripts\/control\/takosumi-release\.mjs",\s*"production"\]/,
  );
});
