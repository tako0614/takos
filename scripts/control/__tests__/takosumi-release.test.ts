import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";

import {
  buildTakosumiDestroyCommands,
  buildTakosumiReleaseCommands,
  ensureTakosumiSourceModule,
  ensureWorkersDevSubdomain,
  readReleaseOutputs,
} from "../takosumi-release.mjs";

const rawOutputs = {
  cloudflare_account_id: "acc_123",
  cloudflare_accounts_d1_database_id: "d1_accounts",
  cloudflare_vectorize_index_name: "takos-test-embeddings",
  worker_name: "takos-test",
  queue_bindings: {
    runs: "takos-test-runs",
    runs_dlq: "takos-test-runs-dlq",
    index_jobs: "takos-test-index-jobs",
    index_jobs_dlq: "takos-test-index-jobs-dlq",
    workflow: "takos-test-workflow-jobs",
    workflow_dlq: "takos-test-workflow-jobs-dlq",
    deployment: "takos-test-deployment-jobs",
    deployment_dlq: "takos-test-deployment-jobs-dlq",
  },
};

const wranglerConfigPath = resolve("deploy/cloudflare/wrangler.toml");

test("buildTakosumiReleaseCommands runs generic operator activation steps", () => {
  assert.deepEqual(
    buildTakosumiReleaseCommands(rawOutputs, "production", {
      zoneId: "zone_123",
      takosumiRepoDir: "../takosumi",
    }),
    [
      "'bun' 'scripts/control/render-wrangler-from-tofu.mjs' 'production' '--zone-id' 'zone_123'",
      "'bun' 'install' '--frozen-lockfile'",
      "'bun' 'install' '--cwd' '../takosumi' '--frozen-lockfile'",
      "'bun' 'install' '--cwd' '../takosumi/dashboard' '--frozen-lockfile'",
      "'bun' 'run' 'build'",
      "'bun' 'run' 'containers:build'",
      "'bunx' 'wrangler' 'd1' 'migrations' 'apply' 'DB' '--remote' '--config' 'deploy/cloudflare/wrangler.toml'",
      `'bun' 'run' '--cwd' '../takosumi' 'cli' '--' 'accounts' 'migrate-d1' '--database-id' 'TAKOSUMI_ACCOUNTS_DB' '--wrangler-config' '${wranglerConfigPath}' '--account-id' 'acc_123' '--remote'`,
      "'bun' 'scripts/control/ensure-vectorize-index.mjs' 'takos-test-embeddings' '--dimensions' '768' '--metric' 'cosine'",
      "'bunx' 'wrangler' 'deploy' '--config' 'deploy/cloudflare/wrangler.toml' '--name' 'takos-test'",
      "'bun' 'scripts/control/ensure-release-secrets.mjs' 'production' '--config' 'deploy/cloudflare/wrangler.toml'",
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
      "'bun' 'install' '--frozen-lockfile'",
      "'bun' 'install' '--cwd' '/opt/takosumi' '--frozen-lockfile'",
      "'bun' 'install' '--cwd' '/opt/takosumi/dashboard' '--frozen-lockfile'",
      "'bun' 'run' 'build' '--mode' 'staging-debug'",
      "'bun' 'run' 'containers:build'",
      "'bunx' 'wrangler' 'd1' 'migrations' 'apply' 'DB' '--remote' '--config' 'deploy/cloudflare/wrangler.toml' '--env' 'staging'",
      `'bun' 'run' '--cwd' '/opt/takosumi' 'cli' '--' 'accounts' 'migrate-d1' '--database-id' 'TAKOSUMI_ACCOUNTS_DB' '--wrangler-config' '${wranglerConfigPath}' '--account-id' 'acc_123' '--remote' '--env' 'staging'`,
      "'bun' 'scripts/control/ensure-vectorize-index.mjs' 'takos-test-embeddings' '--dimensions' '768' '--metric' 'cosine'",
      "'bunx' 'wrangler' 'deploy' '--config' 'deploy/cloudflare/wrangler.toml' '--name' 'takos-test' '--env' 'staging'",
      "'bun' 'scripts/control/ensure-release-secrets.mjs' 'staging' '--config' 'deploy/cloudflare/wrangler.toml'",
    ],
  );
});

test("buildTakosumiReleaseCommands supports sandbox deploys without D1 migrations", () => {
  assert.deepEqual(
    buildTakosumiReleaseCommands(rawOutputs, "staging", {
      skipD1Migrations: true,
      takosumiRepoDir: "/opt/takosumi",
      containersRollout: "none",
    }),
    [
      "'bun' 'scripts/control/render-wrangler-from-tofu.mjs' 'staging'",
      "'bun' 'install' '--frozen-lockfile'",
      "'bun' 'install' '--cwd' '/opt/takosumi' '--frozen-lockfile'",
      "'bun' 'install' '--cwd' '/opt/takosumi/dashboard' '--frozen-lockfile'",
      "'bun' 'run' 'build'",
      "'bun' 'run' 'containers:build'",
      "'bun' 'scripts/control/ensure-vectorize-index.mjs' 'takos-test-embeddings' '--dimensions' '768' '--metric' 'cosine'",
      "'bunx' 'wrangler' 'deploy' '--config' 'deploy/cloudflare/wrangler.toml' '--name' 'takos-test' '--env' 'staging' '--containers-rollout' 'none'",
      "'bun' 'scripts/control/ensure-release-secrets.mjs' 'staging' '--config' 'deploy/cloudflare/wrangler.toml'",
    ],
  );
});

test("buildTakosumiDestroyCommands removes consumers and uploaded resources before OpenTofu destroy", () => {
  assert.deepEqual(buildTakosumiDestroyCommands(rawOutputs), [
    "'bunx' 'wrangler' 'queues' 'consumer' 'remove' 'takos-test-runs' 'takos-test'",
    "'bunx' 'wrangler' 'queues' 'consumer' 'remove' 'takos-test-runs-dlq' 'takos-test'",
    "'bunx' 'wrangler' 'queues' 'consumer' 'remove' 'takos-test-index-jobs' 'takos-test'",
    "'bunx' 'wrangler' 'queues' 'consumer' 'remove' 'takos-test-index-jobs-dlq' 'takos-test'",
    "'bunx' 'wrangler' 'queues' 'consumer' 'remove' 'takos-test-workflow-jobs' 'takos-test'",
    "'bunx' 'wrangler' 'queues' 'consumer' 'remove' 'takos-test-workflow-jobs-dlq' 'takos-test'",
    "'bunx' 'wrangler' 'queues' 'consumer' 'remove' 'takos-test-deployment-jobs' 'takos-test'",
    "'bunx' 'wrangler' 'queues' 'consumer' 'remove' 'takos-test-deployment-jobs-dlq' 'takos-test'",
    "'bunx' 'wrangler' 'delete' 'takos-test' '--force'",
    "'bunx' 'wrangler' 'vectorize' 'delete' 'takos-test-embeddings' '--force'",
  ]);
});

test("Cloudflare release template enables production workers.dev launch URLs", () => {
  const wranglerTemplate = readFileSync(
    new URL("../../../deploy/cloudflare/wrangler.toml", import.meta.url),
    "utf8",
  );
  const [productionTemplate] = wranglerTemplate.split(/\n\[env\.staging\]\n/);
  assert.match(productionTemplate, /\naccount_id\s*=\s*"replace-with-account-id"\n/);
  assert.match(productionTemplate, /\nworkers_dev\s*=\s*true\n/);
});

test("ensureWorkersDevSubdomain enables launch URL scripts without logging tokens", async () => {
  const requests = [];
  const result = await ensureWorkersDevSubdomain(
    {
      worker_name: "takos-test",
      cloudflare_account_id: "acc_123",
      launch_url: "https://takos-test.example-subdomain.workers.dev",
    },
    { CLOUDFLARE_API_TOKEN: "token_123" },
    async (url, init) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify({
          success: true,
          result: { enabled: true, previews_enabled: false },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );

  assert.deepEqual(result, {
    skipped: false,
    result: { enabled: true, previews_enabled: false },
  });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/scripts/takos-test/subdomain",
  );
  assert.equal(requests[0].init.method, "POST");
  assert.equal(
    requests[0].init.headers.authorization,
    "Bearer token_123",
  );
  assert.equal(requests[0].init.body, JSON.stringify({ enabled: true }));
});

test("ensureWorkersDevSubdomain skips non-workers.dev releases", async () => {
  let called = false;
  const result = await ensureWorkersDevSubdomain(
    {
      worker_name: "takos-test",
      cloudflare_account_id: "acc_123",
      launch_url: "https://app.example.com",
    },
    {},
    async () => {
      called = true;
      return new Response("{}");
    },
  );

  assert.deepEqual(result, {
    skipped: true,
    reason: "no_workers_dev_launch_url",
  });
  assert.equal(called, false);
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

test("ensureTakosumiSourceModule links an existing checkout beside restored source", () => {
  const root = mkdtempSync(resolve(tmpdir(), "takos-release-source-"));
  const runDir = resolve(root, "run");
  const sourceDir = resolve(runDir, "source");
  const takosumiSource = resolve(root, "takosumi-source");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(takosumiSource, { recursive: true });
  const previousCwd = process.cwd();
  try {
    process.chdir(sourceDir);
    ensureTakosumiSourceModule(takosumiSource, {
      repoUrl: "",
      ref: "",
    });
    const linked = lstatSync(resolve(runDir, "takosumi"));
    assert.equal(linked.isSymbolicLink(), true);
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("Takos OpenTofu modules declare generic Takosumi post-apply release commands", () => {
  const rootModule = readFileSync(
    new URL("../../../deploy/opentofu/outputs.tf", import.meta.url),
    "utf8",
  );
  const rootVariables = readFileSync(
    new URL("../../../deploy/opentofu/variables.tf", import.meta.url),
    "utf8",
  );
  assert.match(rootModule, /output\s+"takosumi_release"\s*\{/);
  assert.match(rootVariables, /variable\s+"takosumi_source_repo_url"\s*\{/);
  assert.match(rootVariables, /variable\s+"takosumi_source_ref"\s*\{/);
  assert.match(rootModule, /post_apply\s*=\s*\[/);
  assert.match(rootModule, /pre_destroy\s*=\s*\[/);
  assert.match(rootModule, /id\s*=\s*"takos-worker-release"/);
  assert.match(rootModule, /id\s*=\s*"takos-worker-destroy"/);
  assert.match(rootModule, /executor\s*=\s*"runner"/);
  assert.match(rootModule, /env\s*=\s*\{/);
  assert.match(
    rootModule,
    /TAKOS_RELEASE_TAKOSUMI_REPO_URL\s*=\s*var\.takosumi_source_repo_url/,
  );
  assert.match(
    rootModule,
    /TAKOS_RELEASE_TAKOSUMI_REF\s*=\s*var\.takosumi_source_ref/,
  );
  assert.match(rootVariables, /variable\s+"release_working_directory"\s*\{/);
  assert.match(
    rootModule,
    /working_directory\s*=\s*var\.release_working_directory/,
  );
  assert.match(
    rootModule,
    /command\s*=\s*\["bun",\s*"scripts\/control\/takosumi-release\.mjs",\s*var\.environment\]/,
  );
  assert.match(
    rootModule,
    /command\s*=\s*\["bun",\s*"scripts\/control\/takosumi-release\.mjs",\s*var\.environment,\s*"--destroy"\]/,
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
  assert.match(productionModule, /pre_destroy\s*=\s*\[/);
  assert.match(productionModule, /id\s*=\s*"takos-worker-release"/);
  assert.match(productionModule, /id\s*=\s*"takos-worker-destroy"/);
  assert.match(productionModule, /executor\s*=\s*"runner"/);
  assert.match(productionModule, /variable\s+"release_working_directory"\s*\{/);
  assert.match(productionModule, /variable\s+"takosumi_source_repo_url"\s*\{/);
  assert.match(productionModule, /variable\s+"takosumi_source_ref"\s*\{/);
  assert.match(
    productionModule,
    /TAKOS_RELEASE_TAKOSUMI_REPO_URL\s*=\s*var\.takosumi_source_repo_url/,
  );
  assert.match(
    productionModule,
    /TAKOS_RELEASE_TAKOSUMI_REF\s*=\s*var\.takosumi_source_ref/,
  );
  assert.match(
    productionModule,
    /working_directory\s*=\s*var\.release_working_directory/,
  );
  assert.match(
    productionModule,
    /command\s*=\s*\["bun",\s*"scripts\/control\/takosumi-release\.mjs",\s*"production"\]/,
  );
  assert.match(
    productionModule,
    /command\s*=\s*\["bun",\s*"scripts\/control\/takosumi-release\.mjs",\s*"production",\s*"--destroy"\]/,
  );
});
