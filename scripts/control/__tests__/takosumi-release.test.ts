import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";

import {
  buildTakosumiDestroyCommands,
  buildTakosumiReleaseCommands,
  ensureTakosumiSourceModule,
  ensureWorkersDevSubdomain,
  isRetryableDestroyFailure,
  releaseChildEnv,
  readReleaseOutputs,
  verifyReleaseDeployment,
} from "../takosumi-release.mjs";

const rawOutputs = {
  cloudflare_account_id: "acc_123",
  cloudflare_accounts_d1_database_id: "d1_accounts",
  cloudflare_vectorize_index_name: "takos-test-embeddings",
  cloudflare_vectorize_index_dimensions: 768,
  cloudflare_vectorize_index_metric: "cosine",
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

const productionWranglerConfig = "deploy/cloudflare/.takos-release-wrangler.production.toml";
const stagingWranglerConfig = "deploy/cloudflare/.takos-release-wrangler.staging.toml";
const productionWranglerConfigPath = resolve(productionWranglerConfig);
const stagingWranglerConfigPath = resolve(stagingWranglerConfig);

test("buildTakosumiReleaseCommands runs generic operator activation steps", () => {
  assert.deepEqual(
    buildTakosumiReleaseCommands(rawOutputs, "production", {
      zoneId: "zone_123",
      takosumiRepoDir: "../takosumi",
    }),
    [
      `'bun' 'scripts/control/render-wrangler-from-tofu.mjs' 'production' '--out' '${productionWranglerConfig}' '--zone-id' 'zone_123'`,
      "'bun' 'scripts/control/ensure-vectorize-index.mjs' 'takos-test-embeddings' '--dimensions' '768' '--metric' 'cosine' '--account-id' 'acc_123'",
      "'bun' 'install' '--frozen-lockfile'",
      "'bun' 'install' '--cwd' '../takosumi' '--frozen-lockfile'",
      "'bun' 'install' '--cwd' '../takosumi/dashboard' '--frozen-lockfile'",
      "'bun' 'run' 'build'",
      "'bun' 'run' 'containers:build'",
      `'bunx' 'wrangler' 'd1' 'migrations' 'apply' 'DB' '--remote' '--config' '${productionWranglerConfig}' '--env='`,
      `'bun' 'run' '--cwd' '../takosumi' 'cli' '--' 'accounts' 'migrate-d1' '--database-id' 'TAKOSUMI_ACCOUNTS_DB' '--wrangler-config' '${productionWranglerConfigPath}' '--account-id' 'acc_123' '--remote' '--env='`,
      `'bun' 'scripts/control/ensure-release-secrets.mjs' 'production' '--config' '${productionWranglerConfig}' '--secrets-file' '.takos-release-secrets.production.json'`,
      `'bunx' 'wrangler' 'deploy' '--config' '${productionWranglerConfig}' '--name' 'takos-test' '--secrets-file' '.takos-release-secrets.production.json' '--env='`,
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
      `'bun' 'scripts/control/render-wrangler-from-tofu.mjs' 'staging' '--out' '${stagingWranglerConfig}'`,
      "'bun' 'scripts/control/ensure-vectorize-index.mjs' 'takos-test-embeddings' '--dimensions' '768' '--metric' 'cosine' '--account-id' 'acc_123'",
      "'bun' 'install' '--frozen-lockfile'",
      "'bun' 'install' '--cwd' '/opt/takosumi' '--frozen-lockfile'",
      "'bun' 'install' '--cwd' '/opt/takosumi/dashboard' '--frozen-lockfile'",
      "'bun' 'run' 'build' '--mode' 'staging-debug'",
      "'bun' 'run' 'containers:build'",
      `'bunx' 'wrangler' 'd1' 'migrations' 'apply' 'DB' '--remote' '--config' '${stagingWranglerConfig}' '--env' 'staging'`,
      `'bun' 'run' '--cwd' '/opt/takosumi' 'cli' '--' 'accounts' 'migrate-d1' '--database-id' 'TAKOSUMI_ACCOUNTS_DB' '--wrangler-config' '${stagingWranglerConfigPath}' '--account-id' 'acc_123' '--remote' '--env' 'staging'`,
      `'bun' 'scripts/control/ensure-release-secrets.mjs' 'staging' '--config' '${stagingWranglerConfig}' '--secrets-file' '.takos-release-secrets.staging.json'`,
      `'bunx' 'wrangler' 'deploy' '--config' '${stagingWranglerConfig}' '--name' 'takos-test' '--secrets-file' '.takos-release-secrets.staging.json' '--env' 'staging'`,
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
      `'bun' 'scripts/control/render-wrangler-from-tofu.mjs' 'staging' '--out' '${stagingWranglerConfig}'`,
      "'bun' 'scripts/control/ensure-vectorize-index.mjs' 'takos-test-embeddings' '--dimensions' '768' '--metric' 'cosine' '--account-id' 'acc_123'",
      "'bun' 'install' '--frozen-lockfile'",
      "'bun' 'install' '--cwd' '/opt/takosumi' '--frozen-lockfile'",
      "'bun' 'install' '--cwd' '/opt/takosumi/dashboard' '--frozen-lockfile'",
      "'bun' 'run' 'build'",
      "'bun' 'run' 'containers:build'",
      `'bun' 'scripts/control/ensure-release-secrets.mjs' 'staging' '--config' '${stagingWranglerConfig}' '--secrets-file' '.takos-release-secrets.staging.json'`,
      `'bunx' 'wrangler' 'deploy' '--config' '${stagingWranglerConfig}' '--name' 'takos-test' '--secrets-file' '.takos-release-secrets.staging.json' '--env' 'staging' '--containers-rollout' 'none'`,
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

test("destroy retry classifier matches transient Wrangler network failures", () => {
  assert.equal(
    isRetryableDestroyFailure(
      "'bunx' 'wrangler' 'queues' 'consumer' 'remove' 'takos-test-runs' 'takos-test'",
      `
▲ [WARNING] A fetch request failed, likely due to a connectivity issue.

✘ [ERROR] fetch failed
`,
    ),
    true,
  );
  assert.equal(
    isRetryableDestroyFailure(
      "'bunx' 'wrangler' 'delete' 'takos-test' '--force'",
      "Cloudflare API failed: HTTP 500 Internal error",
    ),
    true,
  );
  assert.equal(
    isRetryableDestroyFailure(
      "'bunx' 'wrangler' 'vectorize' 'delete' 'takos-test-embeddings' '--force'",
      "No such Worker exists",
    ),
    false,
  );
});

test("destroy commands are idempotent when queue resources already disappeared", async () => {
  const { main } = await import("../takosumi-release.mjs");
  const previousCwd = process.cwd();
  const root = mkdtempSync(resolve(tmpdir(), "takos-release-destroy-"));
  const bin = resolve(root, "bin");
  const log = resolve(root, "commands.log");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    resolve(bin, "bunx"),
    `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$*" in
  *"takos-test-runs-dlq takos-test"*)
    echo 'Queue "takos-test-runs-dlq" does not exist. To create it, run: wrangler queues create takos-test-runs-dlq' >&2
    exit 1
    ;;
  *)
    exit 0
    ;;
esac
`,
  );
  chmodSync(resolve(bin, "bunx"), 0o755);
  try {
    process.chdir(root);
    await main(["production", "--destroy"], {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TAKOSUMI_OUTPUTS_JSON: JSON.stringify(rawOutputs),
      TAKOS_RELEASE_DESTROY_RETRY_INTERVAL_MS: "0",
    });
    const commands = readFileSync(log, "utf8");
    assert.match(commands, /queues consumer remove takos-test-runs-dlq takos-test/);
    assert.match(commands, /wrangler delete takos-test --force/);
    assert.match(commands, /vectorize delete takos-test-embeddings --force/);
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("releaseChildEnv normalizes Cloudflare auth aliases for Wrangler", () => {
  assert.deepEqual(
    releaseChildEnv(
      { cloudflare_account_id: "acc_from_outputs" },
      {
        PATH: "/bin",
        CF_API_TOKEN: "token_from_cf_alias",
        CF_ACCOUNT_ID: "acc_from_cf_alias",
      },
    ),
    {
      PATH: "/bin",
      CF_API_TOKEN: "token_from_cf_alias",
      CF_ACCOUNT_ID: "acc_from_outputs",
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      CLOUDFLARE_API_TOKEN: "token_from_cf_alias",
      CLOUDFLARE_ACCOUNT_ID: "acc_from_outputs",
    },
  );
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

test("ensureWorkersDevSubdomain waits until the uploaded Worker is visible", async () => {
  const requests = [];
  const result = await ensureWorkersDevSubdomain(
    {
      worker_name: "takos-test",
      cloudflare_account_id: "acc_123",
      launch_url: "https://takos-test.example-subdomain.workers.dev",
    },
    {
      CLOUDFLARE_API_TOKEN: "token_123",
      TAKOS_RELEASE_WORKER_API_ATTEMPTS: "2",
      TAKOS_RELEASE_WORKER_API_INTERVAL_MS: "0",
    },
    async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10007, message: "This Worker does not exist" }],
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          result: { enabled: true, previews_enabled: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );

  assert.equal(requests.length, 2);
  assert.deepEqual(result, {
    skipped: false,
    result: { enabled: true, previews_enabled: true },
  });
});

test("verifyReleaseDeployment rejects Cloudflare secret-update stubs", async () => {
  const requests = [];
  await assert.rejects(
    verifyReleaseDeployment(
      {
        ...rawOutputs,
        launch_url: "https://takos-test.example-subdomain.workers.dev",
      },
      "production",
      {
        CLOUDFLARE_API_TOKEN: "token_123",
        TAKOS_RELEASE_MIN_WORKER_CONTENT_BYTES: "0",
        TAKOS_RELEASE_HEALTH_ATTEMPTS: "1",
      },
      async (url, init) => {
        requests.push({ url, init });
        return new Response("export default { fetch() {} }", { status: 200 });
      },
    ),
    /secret-update stub/,
  );
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/services/takos-test/environments/production/content",
  );
  assert.equal(requests[0].init.headers.authorization, "Bearer token_123");
});

test("verifyReleaseDeployment waits until Worker content is visible", async () => {
  const requests = [];
  const result = await verifyReleaseDeployment(
    {
      ...rawOutputs,
      launch_url: "https://takos-test.example-subdomain.workers.dev",
    },
    "production",
    {
      CLOUDFLARE_API_TOKEN: "token_123",
      TAKOS_RELEASE_WORKER_API_ATTEMPTS: "2",
      TAKOS_RELEASE_WORKER_API_INTERVAL_MS: "0",
      TAKOS_RELEASE_HEALTH_ATTEMPTS: "1",
    },
    async (url, init) => {
      requests.push({ url, init });
      if (String(url).includes("/content") && requests.length === 1) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10007, message: "This Worker does not exist" }],
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      }
      if (String(url).includes("/content")) {
        return new Response("/* real worker */\n".repeat(128), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    },
  );

  assert.equal(result.artifact.workerName, "takos-test");
  assert.equal(result.health.status, 200);
  assert.deepEqual(
    requests.map((request) => String(request.url)),
    [
      "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/services/takos-test/environments/production/content",
      "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/services/takos-test/environments/production/content",
      "https://takos-test.example-subdomain.workers.dev/health",
    ],
  );
});

test("verifyReleaseDeployment checks uploaded artifact and public health", async () => {
  const requests = [];
  const result = await verifyReleaseDeployment(
    {
      ...rawOutputs,
      launch_url: "https://takos-test.example-subdomain.workers.dev",
    },
    "production",
    {
      CLOUDFLARE_API_TOKEN: "token_123",
      TAKOS_RELEASE_HEALTH_ATTEMPTS: "1",
    },
    async (url, init) => {
      requests.push({ url, init });
      if (String(url).includes("/content")) {
        return new Response("/* real worker */\n".repeat(128), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    },
  );

  assert.equal(result.artifact.workerName, "takos-test");
  assert.equal(result.health.status, 200);
  assert.deepEqual(
    requests.map((request) => String(request.url)),
    [
      "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/services/takos-test/environments/production/content",
      "https://takos-test.example-subdomain.workers.dev/health",
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
  assert.match(rootVariables, /variable\s+"release_containers_rollout"\s*\{/);
  assert.match(rootVariables, /variable\s+"release_executor"\s*\{/);
  assert.match(rootVariables, /contains\(\["runner",\s*"operator"\],\s*var\.release_executor\)/);
  assert.match(rootModule, /post_apply\s*=\s*\[/);
  assert.match(rootModule, /pre_destroy\s*=\s*\[/);
  assert.match(rootModule, /id\s*=\s*"takos-worker-release"/);
  assert.match(rootModule, /id\s*=\s*"takos-worker-destroy"/);
  assert.match(rootModule, /executor\s*=\s*var\.release_executor/);
  assert.match(rootModule, /timeout_seconds\s*=\s*1200/);
  assert.match(rootModule, /timeout_seconds\s*=\s*600/);
  assert.match(rootModule, /env\s*=\s*\{/);
  assert.match(
    rootModule,
    /TAKOS_RELEASE_TAKOSUMI_REPO_URL\s*=\s*var\.takosumi_source_repo_url/,
  );
  assert.match(
    rootModule,
    /TAKOS_RELEASE_TAKOSUMI_REF\s*=\s*var\.takosumi_source_ref/,
  );
  assert.match(
    rootModule,
    /TAKOS_WRANGLER_CONTAINERS_ROLLOUT\s*=\s*var\.release_containers_rollout/,
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
  assert.match(productionModule, /executor\s*=\s*var\.release_executor/);
  assert.match(productionModule, /timeout_seconds\s*=\s*1200/);
  assert.match(productionModule, /timeout_seconds\s*=\s*600/);
  assert.match(productionModule, /variable\s+"release_working_directory"\s*\{/);
  assert.match(productionModule, /variable\s+"takosumi_source_repo_url"\s*\{/);
  assert.match(productionModule, /variable\s+"takosumi_source_ref"\s*\{/);
  assert.match(productionModule, /variable\s+"release_containers_rollout"\s*\{/);
  assert.match(productionModule, /variable\s+"release_executor"\s*\{/);
  assert.match(productionModule, /contains\(\["runner",\s*"operator"\],\s*var\.release_executor\)/);
  assert.match(
    productionModule,
    /TAKOS_WRANGLER_CONTAINERS_ROLLOUT\s*=\s*var\.release_containers_rollout/,
  );
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
