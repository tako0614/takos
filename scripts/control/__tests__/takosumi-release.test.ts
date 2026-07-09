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
  deployManagedCompatWorker,
  ensureTakosumiSourceModule,
  ensureWorkersDevSubdomain,
  isRetryableBunInstallFailure,
  isRetryableDestroyFailure,
  normalizeReleaseContainerImages,
  preflightWranglerDeployAuth,
  pruneWranglerMigrationsForExistingWorker,
  releaseD1MigrationsWranglerConfigPath,
  releaseChildEnv,
  releaseWranglerBundleDir,
  releaseWranglerAccountId,
  releaseCommandStepName,
  readReleaseOutputs,
  removeExistingWorkerMigrationsFromToml,
  removeWranglerDurableObjectLifecycleFromToml,
  removeWranglerQueueConsumerTriggersFromToml,
  verifyReleaseDeployment,
  waitForWranglerDeployment,
  waitForWranglerDeploymentBestEffort,
  wranglerDeployEnv,
} from "../takosumi-release.mjs";
import { applyReleaseContainerImagesToToml } from "../apply-release-container-images.mjs";

const repoRoot = resolve(import.meta.dir, "../../..");

const rawOutputs = {
  cloudflare_account_id: "acc_123",
  vector_indexes: {
    vector: {
      name: "takos-test-embeddings",
      dimensions: 768,
      metric: "cosine",
    },
  },
  service_runtime_name: "takos-test",
  queues: {
    runs: "takos-test-runs",
    runs_dlq: "takos-test-runs-dlq",
    index_jobs: "takos-test-index-jobs",
    index_jobs_dlq: "takos-test-index-jobs-dlq",
    workflow: "takos-test-workflow-jobs",
    workflow_dlq: "takos-test-workflow-jobs-dlq",
    deployment: "takos-test-deployment-jobs",
    deployment_dlq: "takos-test-deployment-jobs-dlq",
  },
  object_buckets: {
    worker_bundles: "takos-test-worker-bundles",
    tenant_builds: "takos-test-tenant-builds",
    git_objects: "takos-test-git-objects",
    offload: "takos-test-offload",
  },
};

const productionWranglerConfig =
  "deploy/cloudflare/.takos-release-wrangler.production.toml";
const stagingWranglerConfig =
  "deploy/cloudflare/.takos-release-wrangler.staging.toml";
const productionD1WranglerConfig =
  "deploy/cloudflare/.takos-release-wrangler.production.d1-migrations.toml";
const stagingD1WranglerConfig =
  "deploy/cloudflare/.takos-release-wrangler.staging.d1-migrations.toml";
const runtimeImage =
  "registry.cloudflare.com/acc_123/takos-worker-runtime@sha256:1111111111111111111111111111111111111111111111111111111111111111";
const executorImage =
  "registry.cloudflare.com/acc_123/takos-agent-executor@sha256:2222222222222222222222222222222222222222222222222222222222222222";
const runtimeTaggedImage =
  "registry.cloudflare.com/acc_123/takos-worker-runtime:0.10.0-da3f231b8135";
const executorTaggedImage =
  "registry.cloudflare.com/acc_123/takos-agent-executor:0.10.0-da3f231b8135";

test("buildTakosumiReleaseCommands runs generic operator activation steps", () => {
  assert.deepEqual(
    buildTakosumiReleaseCommands(rawOutputs, "production", {
      zoneId: "zone_123",
    }),
    [
      `'bun' 'scripts/control/render-wrangler-from-tofu.mjs' 'production' '--out' '${productionWranglerConfig}' '--zone-id' 'zone_123'`,
      "'bun' 'scripts/control/ensure-vectorize-index.mjs' 'takos-test-embeddings' '--dimensions' '768' '--metric' 'cosine' '--account-id' 'acc_123'",
      "'bun' 'install' '--frozen-lockfile' '--ignore-scripts'",
      "'bun' 'run' 'build'",
      "'bun' 'run' 'containers:build'",
      `'bunx' 'wrangler' 'd1' 'migrations' 'apply' 'DB' '--remote' '--config' '${productionD1WranglerConfig}'`,
      `'bun' 'scripts/control/ensure-release-secrets.mjs' 'production' '--config' '${productionWranglerConfig}' '--secrets-file' '.takos-release-secrets.production.json'`,
      `'bunx' 'wrangler' 'deploy' '--config' '${productionWranglerConfig}' '--name' 'takos-test' '--secrets-file' '.takos-release-secrets.production.json' '--env' ''`,
    ],
  );
});

test("buildTakosumiReleaseCommands supports staging debug deploys", () => {
  assert.deepEqual(
    buildTakosumiReleaseCommands(rawOutputs, "staging", {
      debug: true,
    }),
    [
      `'bun' 'scripts/control/render-wrangler-from-tofu.mjs' 'staging' '--out' '${stagingWranglerConfig}'`,
      "'bun' 'scripts/control/ensure-vectorize-index.mjs' 'takos-test-embeddings' '--dimensions' '768' '--metric' 'cosine' '--account-id' 'acc_123'",
      "'bun' 'install' '--frozen-lockfile' '--ignore-scripts'",
      "'bun' 'run' 'build' '--mode' 'staging-debug'",
      "'bun' 'run' 'containers:build'",
      `'bunx' 'wrangler' 'd1' 'migrations' 'apply' 'DB' '--remote' '--config' '${stagingD1WranglerConfig}' '--env' 'staging'`,
      `'bun' 'scripts/control/ensure-release-secrets.mjs' 'staging' '--config' '${stagingWranglerConfig}' '--secrets-file' '.takos-release-secrets.staging.json'`,
      `'bunx' 'wrangler' 'deploy' '--config' '${stagingWranglerConfig}' '--name' 'takos-test' '--secrets-file' '.takos-release-secrets.staging.json' '--env' 'staging'`,
    ],
  );
});

test("buildTakosumiReleaseCommands supports sandbox deploys without D1 migrations", () => {
  assert.deepEqual(
    buildTakosumiReleaseCommands(rawOutputs, "staging", {
      skipD1Migrations: true,
      containersRollout: "none",
    }),
    [
      `'bun' 'scripts/control/render-wrangler-from-tofu.mjs' 'staging' '--out' '${stagingWranglerConfig}'`,
      "'bun' 'scripts/control/ensure-vectorize-index.mjs' 'takos-test-embeddings' '--dimensions' '768' '--metric' 'cosine' '--account-id' 'acc_123'",
      "'bun' 'install' '--frozen-lockfile' '--ignore-scripts'",
      "'bun' 'run' 'build'",
      "'bun' 'run' 'containers:build'",
      `'bun' 'scripts/control/ensure-release-secrets.mjs' 'staging' '--config' '${stagingWranglerConfig}' '--secrets-file' '.takos-release-secrets.staging.json'`,
      `'bunx' 'wrangler' 'deploy' '--config' '${stagingWranglerConfig}' '--name' 'takos-test' '--secrets-file' '.takos-release-secrets.staging.json' '--env' 'staging' '--containers-rollout' 'none'`,
    ],
  );
});

test("buildTakosumiReleaseCommands fails closed when operator mode requires CI images", () => {
  assert.throws(
    () =>
      buildTakosumiReleaseCommands(rawOutputs, "production", {
        requirePrebuiltContainerImages: true,
      }),
    /Generate release_container_images from the Git CI release manifest/,
  );
});

test("buildTakosumiReleaseCommands rejects partial prebuilt image sets", () => {
  assert.throws(
    () =>
      buildTakosumiReleaseCommands(rawOutputs, "production", {
        requirePrebuiltContainerImages: true,
        containerImages: { runtime: runtimeImage },
      }),
    /ExecutorContainerTier1, ExecutorContainerTier2, ExecutorContainerTier3/,
  );
});

test("buildTakosumiReleaseCommands uses prebuilt CI container images when supplied", () => {
  const commands = buildTakosumiReleaseCommands(rawOutputs, "production", {
    containerImages: {
      runtime: runtimeImage,
      executor: executorImage,
    },
  });

  assert.deepEqual(commands, [
    `'bun' 'scripts/control/render-wrangler-from-tofu.mjs' 'production' '--out' '${productionWranglerConfig}'`,
    `TAKOS_RELEASE_CONTAINER_IMAGES_JSON='{"TakosRuntimeContainer":"${runtimeImage}","ExecutorContainerTier1":"${executorImage}","ExecutorContainerTier2":"${executorImage}","ExecutorContainerTier3":"${executorImage}"}' 'bun' 'scripts/control/apply-release-container-images.mjs' '${productionWranglerConfig}'`,
    "'bun' 'scripts/control/ensure-vectorize-index.mjs' 'takos-test-embeddings' '--dimensions' '768' '--metric' 'cosine' '--account-id' 'acc_123'",
    "'bun' 'install' '--frozen-lockfile' '--ignore-scripts'",
    "'bun' 'run' 'build'",
    `'bunx' 'wrangler' 'd1' 'migrations' 'apply' 'DB' '--remote' '--config' '${productionD1WranglerConfig}'`,
    `'bun' 'scripts/control/ensure-release-secrets.mjs' 'production' '--config' '${productionWranglerConfig}' '--secrets-file' '.takos-release-secrets.production.json'`,
    `'bunx' 'wrangler' 'deploy' '--config' '${productionWranglerConfig}' '--name' 'takos-test' '--secrets-file' '.takos-release-secrets.production.json' '--env' ''`,
  ]);
  assert.equal(
    commands.some((command) => command.includes("containers:build")),
    false,
  );
});

test("buildTakosumiReleaseCommands activates a prebuilt Worker without source build steps", () => {
  const commands = buildTakosumiReleaseCommands(rawOutputs, "production", {
    containerImages: {
      runtime: runtimeImage,
      executor: executorImage,
    },
    workerArtifact: true,
  });

  assert.equal(
    commands.some((command) => command.includes("'bun' 'install'")),
    false,
  );
  assert.equal(
    commands.some((command) => command.includes("'bun' 'run' 'build'")),
    false,
  );
  assert.equal(
    commands.some((command) => command.includes("containers:build")),
    false,
  );
  assert.match(commands.at(-1) ?? "", /'--no-bundle'/u);
});

test("removeExistingWorkerMigrationsFromToml prunes only production migration blocks", () => {
  const input = [
    'name = "takos"',
    "",
    "[[migrations]]",
    'tag = "v1"',
    'new_classes = ["SessionDO"]',
    "",
    "[[migrations]]",
    'tag = "v2"',
    'new_classes = ["RunNotifierDO"]',
    "",
    "[[containers]]",
    'class_name = "Runtime"',
    "",
    "[env.staging]",
    'name = "takos-staging"',
  ].join("\n");

  const result = removeExistingWorkerMigrationsFromToml(input, "production");

  assert.equal(result.removed, 2);
  assert.doesNotMatch(result.toml, /\[\[migrations\]\]/);
  assert.match(result.toml, /\[\[containers\]\]/);
  assert.match(result.toml, /\[env\.staging\]/);
});

test("removeWranglerDurableObjectLifecycleFromToml creates a D1-only config without touching bindings", () => {
  const input = [
    'name = "takos"',
    "",
    "[[durable_objects.bindings]]",
    'name = "SESSION_DO"',
    'class_name = "SessionDO"',
    "",
    "[[migrations]]",
    'tag = "v1"',
    'new_classes = ["SessionDO"]',
    "",
    "[exports.SessionDO]",
    'type = "durable-object"',
    'storage = "sqlite"',
    "",
    "# BEGIN TAKOSUMI GENERATED PUBLIC ROUTE",
    "routes = [",
    '  { pattern = "takos.app.takos.jp/*", zone_name = "takos.jp" },',
    "]",
    "# END TAKOSUMI GENERATED PUBLIC ROUTE",
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    'database_name = "takos-db"',
    "",
    "[env.staging]",
    'name = "takos-staging"',
  ].join("\n");

  const result = removeWranglerDurableObjectLifecycleFromToml(input);

  assert.equal(result.removedMigrations, 1);
  assert.equal(result.removedExports, 1);
  assert.equal(result.removedRoutes, 1);
  assert.doesNotMatch(result.toml, /\[\[migrations\]\]/);
  assert.doesNotMatch(result.toml, /\[exports\./);
  assert.doesNotMatch(result.toml, /takos\.app\.takos\.jp/);
  assert.match(result.toml, /\[\[durable_objects\.bindings\]\]/);
  assert.match(result.toml, /\[\[d1_databases\]\]/);
  assert.match(result.toml, /\[env\.staging\]/);
});

test("removeWranglerQueueConsumerTriggersFromToml keeps producer bindings and removes consumer triggers", () => {
  const input = [
    'name = "takos"',
    "",
    "[[queues.producers]]",
    'queue = "takos-runs"',
    'binding = "RUN_QUEUE"',
    "",
    "[[queues.consumers]]",
    'queue = "takos-runs"',
    "max_batch_size = 1",
    'dead_letter_queue = "takos-runs-dlq"',
    "",
    "[[env.staging.queues.producers]]",
    'queue = "takos-runs-staging"',
    'binding = "RUN_QUEUE"',
    "",
    "[[env.staging.queues.consumers]]",
    'queue = "takos-runs-staging"',
    "max_batch_size = 1",
    "",
    "[[vectorize]]",
    'binding = "VECTORIZE"',
  ].join("\n");

  const result = removeWranglerQueueConsumerTriggersFromToml(input);

  assert.equal(result.removed, 2);
  assert.match(result.toml, /\[\[queues\.producers\]\]/);
  assert.match(result.toml, /\[\[env\.staging\.queues\.producers\]\]/);
  assert.doesNotMatch(
    result.toml,
    /\[\[(?:env\.[^\]]+\.)?queues\.consumers\]\]/,
  );
  assert.match(result.toml, /\[\[vectorize\]\]/);
});

test("ensure-queue-consumers skips existing Worker consumers and adds missing ones", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "takos-release-queues-"));
  const bin = resolve(root, "bin");
  const log = resolve(root, "commands.log");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    resolve(bin, "bunx"),
    `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$*" in
  *"consumer list takos-test-runs "*)
    printf 'Resolving dependencies\\n'
    printf 'Resolved, downloaded and extracted [2]\\n'
    printf '[{"script_name":"takos-test"}]\\n'
    ;;
  *"consumer list "*)
    printf '[]\\n'
    ;;
  *"consumer add "*)
    ;;
  *)
    echo "unexpected command: $*" >&2
    exit 1
    ;;
esac
`,
  );
  chmodSync(resolve(bin, "bunx"), 0o755);
  try {
    const proc = Bun.spawn(
      [
        "bun",
        "scripts/control/ensure-queue-consumers.mjs",
        "production",
        "--config",
        productionWranglerConfig,
      ],
      {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          TAKOSUMI_OUTPUTS_JSON: JSON.stringify(rawOutputs),
        },
      },
    );
    const [status, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    assert.equal(status, 0, `${stdout}\n${stderr}`.trim());
    const commands = readFileSync(log, "utf8");
    assert.match(
      commands,
      /queues consumer list takos-test-runs --json --config/,
    );
    assert.doesNotMatch(
      commands,
      /queues consumer add takos-test-runs takos-test/,
    );
    assert.match(
      commands,
      /queues consumer add takos-test-index-jobs takos-test --batch-size 5 --batch-timeout 60 --config/,
    );
    assert.match(
      commands,
      /--message-retries 2 --dead-letter-queue takos-test-index-jobs-dlq/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("releaseD1MigrationsWranglerConfigPath is isolated from the deploy config", () => {
  assert.equal(
    releaseD1MigrationsWranglerConfigPath("production"),
    productionD1WranglerConfig,
  );
});

test("pruneWranglerMigrationsForExistingWorker keeps bootstrap migrations for new workers", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "takos-release-migrations-"));
  const oldCwd = process.cwd();
  try {
    process.chdir(dir);
    mkdirSync("deploy/cloudflare", { recursive: true });
    const path = productionWranglerConfig;
    writeFileSync(
      path,
      [
        'name = "takos-test"',
        "",
        "[[migrations]]",
        'tag = "v1"',
        'new_classes = ["SessionDO"]',
        "",
      ].join("\n"),
    );

    const result = await pruneWranglerMigrationsForExistingWorker(
      rawOutputs,
      "production",
      {
        CLOUDFLARE_API_TOKEN: "token",
        CLOUDFLARE_ACCOUNT_ID: "acc_123",
      },
      async (url, init) => {
        assert.equal(
          String(url),
          "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/scripts/takos-test",
        );
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer token",
        );
        return new Response("not found", { status: 404 });
      },
    );

    assert.deepEqual(result, {
      skipped: true,
      reason: "worker_not_found",
      status: 404,
    });
    assert.match(readFileSync(path, "utf8"), /\[\[migrations\]\]/);
  } finally {
    process.chdir(oldCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pruneWranglerMigrationsForExistingWorker removes bootstrap migrations for existing workers", async () => {
  const dir = mkdtempSync(resolve(tmpdir(), "takos-release-migrations-"));
  const oldCwd = process.cwd();
  try {
    process.chdir(dir);
    mkdirSync("deploy/cloudflare", { recursive: true });
    const path = productionWranglerConfig;
    writeFileSync(
      path,
      [
        'name = "takos-test"',
        "",
        "[[migrations]]",
        'tag = "v1"',
        'new_classes = ["SessionDO"]',
        "",
        "[[containers]]",
        'class_name = "Runtime"',
        "",
      ].join("\n"),
    );

    const result = await pruneWranglerMigrationsForExistingWorker(
      rawOutputs,
      "production",
      {
        CLOUDFLARE_API_TOKEN: "token",
        CLOUDFLARE_ACCOUNT_ID: "acc_123",
      },
      async (url, init) => {
        assert.equal(
          String(url),
          "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/scripts/takos-test",
        );
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer token",
        );
        return new Response("ok", { status: 200 });
      },
    );

    assert.deepEqual(result, { skipped: false, status: 200, removed: 1 });
    const next = readFileSync(path, "utf8");
    assert.doesNotMatch(next, /\[\[migrations\]\]/);
    assert.match(next, /\[\[containers\]\]/);
  } finally {
    process.chdir(oldCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("base wrangler Durable Object migrations do not convert existing app classes to SQLite", () => {
  const toml = readFileSync("deploy/cloudflare/wrangler.toml", "utf8");

  assert.match(toml, /new_classes = \["SessionDO"\]/);
  assert.match(toml, /new_classes = \["RunNotifierDO"\]/);
  assert.match(toml, /new_classes = \["NotificationNotifierDO"\]/);
  assert.match(toml, /new_classes = \["RateLimiterDO"\]/);
  assert.match(toml, /new_classes = \["RoutingDO"\]/);
  assert.doesNotMatch(toml, /new_sqlite_classes = \[[^\]]*"SessionDO"/s);
  assert.match(
    toml,
    /new_sqlite_classes = \[[^\]]*"TakosRuntimeContainer"[^\]]*"ExecutorContainerTier1"[^\]]*"ExecutorContainerTier2"[^\]]*"ExecutorContainerTier3"/s,
  );
});

test("normalizeReleaseContainerImages accepts aliases and supported registry refs", () => {
  assert.deepEqual(
    normalizeReleaseContainerImages({
      runtime: runtimeImage,
      executor: executorImage,
    }),
    {
      TakosRuntimeContainer: runtimeImage,
      ExecutorContainerTier1: executorImage,
      ExecutorContainerTier2: executorImage,
      ExecutorContainerTier3: executorImage,
    },
  );
  assert.deepEqual(
    normalizeReleaseContainerImages({
      runtime: runtimeTaggedImage,
      executor: executorTaggedImage,
    }),
    {
      TakosRuntimeContainer: runtimeTaggedImage,
      ExecutorContainerTier1: executorTaggedImage,
      ExecutorContainerTier2: executorTaggedImage,
      ExecutorContainerTier3: executorTaggedImage,
    },
  );
  assert.throws(
    () =>
      normalizeReleaseContainerImages({
        executor:
          "registry.cloudflare.com/acc_123/takos-agent-executor:bad tag",
      }),
    /Cloudflare Containers-supported registry ref/,
  );
  assert.throws(
    () =>
      normalizeReleaseContainerImages({
        runtime:
          "ghcr.io/takos/runtime@sha256:1111111111111111111111111111111111111111111111111111111111111111",
      }),
    /Cloudflare Containers-supported registry ref/,
  );
});

test("applyReleaseContainerImagesToToml rewrites container images and removes build contexts", () => {
  const rendered = applyReleaseContainerImagesToToml(
    [
      "[[containers]]",
      'class_name = "TakosRuntimeContainer"',
      'image = "../../containers/runtime/Dockerfile"',
      'image_build_context = "../../containers/runtime"',
      'instance_type = "standard-2"',
      "",
      "[[containers]]",
      'class_name = "ExecutorContainerTier1"',
      'image = "../../containers/executor/Dockerfile"',
      'image_build_context = "../../containers/executor"',
      'instance_type = "lite"',
      "",
    ].join("\n"),
    {
      TakosRuntimeContainer: runtimeImage,
      ExecutorContainerTier1: executorImage,
    },
  );

  assert.ok(rendered.includes(`image = "${runtimeImage}"`));
  assert.ok(rendered.includes(`image = "${executorImage}"`));
  assert.doesNotMatch(rendered, /image_build_context/);
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
    assert.match(
      commands,
      /queues consumer remove takos-test-runs-dlq takos-test/,
    );
    assert.match(commands, /wrangler delete takos-test --force/);
    assert.match(commands, /vectorize delete takos-test-embeddings --force/);
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("release timing summary is written for operator destroy commands", async () => {
  const { main } = await import("../takosumi-release.mjs");
  const previousCwd = process.cwd();
  const root = mkdtempSync(resolve(tmpdir(), "takos-release-timing-"));
  const bin = resolve(root, "bin");
  const timingFile = resolve(root, "timings", "release.json");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    resolve(bin, "bunx"),
    `#!/bin/sh
exit 0
`,
  );
  chmodSync(resolve(bin, "bunx"), 0o755);
  try {
    process.chdir(root);
    await main(["production", "--destroy"], {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TAKOSUMI_OUTPUTS_JSON: JSON.stringify(rawOutputs),
      TAKOS_RELEASE_TIMINGS_FILE: timingFile,
      TAKOS_RELEASE_DESTROY_RETRY_INTERVAL_MS: "0",
    });
    const summary = JSON.parse(readFileSync(timingFile, "utf8"));
    assert.equal(summary.kind, "takos.release-activation-timings@v1");
    assert.equal(summary.operation, "destroy");
    assert.equal(summary.status, "succeeded");
    assert.ok(summary.totalDurationMs >= 0);
    assert.deepEqual(
      summary.steps.map((step) => step.step),
      [
        "destroy-queue-consumer",
        "destroy-queue-consumer",
        "destroy-queue-consumer",
        "destroy-queue-consumer",
        "destroy-queue-consumer",
        "destroy-queue-consumer",
        "destroy-queue-consumer",
        "destroy-queue-consumer",
        "destroy-worker",
        "destroy-vectorize-index",
      ],
    );
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("releaseCommandStepName classifies activation bottleneck steps", () => {
  assert.equal(
    releaseCommandStepName(
      "'bun' 'scripts/control/render-wrangler-from-tofu.mjs' 'production'",
    ),
    "render-wrangler-config",
  );
  assert.equal(
    releaseCommandStepName("'bun' 'install' '--frozen-lockfile'"),
    "bun-install",
  );
  assert.equal(
    releaseCommandStepName("'bun' 'run' 'containers:build'"),
    "build-containers",
  );
  assert.equal(
    releaseCommandStepName("'bunx' 'wrangler' 'd1' 'migrations' 'apply' 'DB'"),
    "d1-migrations-apply",
  );
});

test("bun install retry classifier only retries transient install failures", () => {
  assert.equal(
    isRetryableBunInstallFailure(
      "error: Fail extracting tarball from @rolldown/binding-linux-x64-gnu",
    ),
    true,
  );
  assert.equal(
    isRetryableBunInstallFailure(
      "error: lockfile had changes, but lockfile is frozen",
    ),
    false,
  );
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
      TAKOS_CLOUDFLARE_WRANGLER_ACCOUNT_ID: "acc_from_outputs",
      CLOUDFLARE_ACCOUNT_ID: "acc_from_outputs",
    },
  );
});

test("releaseChildEnv prefers the native Containers token for release helpers", () => {
  assert.deepEqual(
    releaseChildEnv(
      { cloudflare_account_id: "acc_from_outputs" },
      {
        PATH: "/bin",
        CLOUDFLARE_API_TOKEN: "provider-token",
        CLOUDFLARE_CONTAINERS_API_TOKEN: "native-token",
      },
    ),
    {
      PATH: "/bin",
      CLOUDFLARE_API_TOKEN: "native-token",
      CLOUDFLARE_CONTAINERS_API_TOKEN: "native-token",
      CF_API_TOKEN: "native-token",
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      TAKOS_CLOUDFLARE_WRANGLER_ACCOUNT_ID: "acc_from_outputs",
      CLOUDFLARE_ACCOUNT_ID: "acc_from_outputs",
      CF_ACCOUNT_ID: "acc_from_outputs",
    },
  );
});

test("wranglerDeployEnv uses provider token for real Cloudflare deploys", () => {
  const env = wranglerDeployEnv({
    PATH: "/bin",
    CLOUDFLARE_API_TOKEN: "provider-token",
    CF_API_TOKEN: "provider-token",
    CLOUDFLARE_CONTAINERS_API_TOKEN: "containers-token",
    CLOUDFLARE_ACCOUNT_ID: "acc_123",
  });

  assert.equal(env.CLOUDFLARE_API_TOKEN, "provider-token");
  assert.equal(env.CF_API_TOKEN, "provider-token");
  assert.equal(env.CLOUDFLARE_CONTAINERS_API_TOKEN, "containers-token");
  assert.equal(env.CLOUDFLARE_ACCOUNT_ID, "acc_123");
  assert.equal(env.CLOUDFLARE_API_BASE_URL, undefined);
  assert.equal(env.TAKOS_CLOUDFLARE_API_BASE_URL, undefined);
  assert.equal(env.CF_API_BASE_URL, undefined);
  assert.equal(env.CLOUDFLARE_BASE_URL, undefined);
});

test("wranglerDeployEnv prefers explicit Takos deploy token over containers alias", () => {
  const env = wranglerDeployEnv({
    PATH: "/bin",
    CLOUDFLARE_API_TOKEN: "provider-token",
    CLOUDFLARE_CONTAINERS_API_TOKEN: "containers-token",
    TAKOS_CLOUDFLARE_WRANGLER_DEPLOY_API_TOKEN: "deploy-token",
  });

  assert.equal(env.CLOUDFLARE_API_TOKEN, "deploy-token");
  assert.equal(env.CF_API_TOKEN, "deploy-token");
});

test("wranglerDeployEnv strips Cloudflare API base overrides from native release helpers", () => {
  const compatBase = "https://compat.example.test/client/v4";
  const input = {
    PATH: "/bin",
    CLOUDFLARE_API_TOKEN: "provider-token",
    CF_API_TOKEN: "provider-token",
    TAKOS_CLOUDFLARE_API_BASE_URL: compatBase,
    CLOUDFLARE_API_BASE_URL: compatBase,
  };

  assert.deepEqual(wranglerDeployEnv(input), {
    PATH: "/bin",
    CLOUDFLARE_API_TOKEN: "provider-token",
    CF_API_TOKEN: "provider-token",
  });
});

test("wranglerDeployEnv keeps provider auth while ignoring custom Cloudflare API bases", () => {
  const apiBase = "https://compat.example.test/client/v4";
  const env = wranglerDeployEnv({
    PATH: "/bin",
    CLOUDFLARE_API_TOKEN: "provider-token",
    CF_API_TOKEN: "provider-token",
    CLOUDFLARE_CONTAINERS_API_TOKEN: "containers-token",
    TAKOS_CLOUDFLARE_API_BASE_URL: apiBase,
    CLOUDFLARE_API_BASE_URL: apiBase,
  });

  assert.equal(env.CLOUDFLARE_API_TOKEN, "provider-token");
  assert.equal(env.CF_API_TOKEN, "provider-token");
  assert.equal(env.CLOUDFLARE_CONTAINERS_API_TOKEN, "containers-token");
  assert.equal(env.TAKOS_CLOUDFLARE_API_BASE_URL, undefined);
  assert.equal(env.CLOUDFLARE_API_BASE_URL, undefined);
  assert.equal(env.CF_API_BASE_URL, undefined);
  assert.equal(env.CLOUDFLARE_BASE_URL, undefined);
});

test("preflightWranglerDeployAuth skips when no deploy token is configured", async () => {
  let called = false;
  const result = await preflightWranglerDeployAuth(rawOutputs, {}, async () => {
    called = true;
    return new Response("{}");
  });

  assert.deepEqual(result, {
    skipped: true,
    reason: "deploy_token_not_configured",
  });
  assert.equal(called, false);
});

test("preflightWranglerDeployAuth accepts Worker service 404 as an authorized token", async () => {
  const requests = [];
  const result = await preflightWranglerDeployAuth(
    rawOutputs,
    {
      CLOUDFLARE_CONTAINERS_API_TOKEN: "deploy-token",
      CLOUDFLARE_ACCOUNT_ID: "acc_123",
    },
    async (url, init) => {
      requests.push({ url, init });
      if (url.includes("/workers/services/")) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [
              {
                code: 10090,
                message: "This Worker does not exist on this account.",
              },
            ],
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          result: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );

  assert.equal(result.skipped, false);
  assert.deepEqual(result.checks, [
    {
      name: "Workers Services",
      status: 404,
      success: false,
    },
    {
      name: "R2 Buckets",
      status: 200,
      success: true,
    },
    {
      name: "D1 Databases",
      status: 200,
      success: true,
    },
    {
      name: "KV Namespaces",
      status: 200,
      success: true,
    },
    {
      name: "Queues",
      status: 200,
      success: true,
    },
    {
      name: "Vectorize Indexes",
      status: 200,
      success: true,
    },
    {
      name: "R2 Bucket worker_bundles",
      status: 200,
      success: true,
    },
    {
      name: "R2 Bucket tenant_builds",
      status: 200,
      success: true,
    },
    {
      name: "R2 Bucket git_objects",
      status: 200,
      success: true,
    },
    {
      name: "R2 Bucket offload",
      status: 200,
      success: true,
    },
  ]);
  assert.equal(requests.length, 10);
  assert.equal(
    requests[0].url,
    "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/services/takos-test",
  );
  assert.equal(
    requests.every(
      (request) => request.init.headers.authorization === "Bearer deploy-token",
    ),
    true,
  );
});

test("preflightWranglerDeployAuth fails fast on a token without resource API access", async () => {
  await assert.rejects(
    () =>
      preflightWranglerDeployAuth(
        rawOutputs,
        {
          CLOUDFLARE_CONTAINERS_API_TOKEN: "containers-only-token",
          CLOUDFLARE_ACCOUNT_ID: "acc_123",
        },
        async (url) => {
          if (url.includes("/r2/buckets")) {
            return new Response(
              JSON.stringify({
                success: false,
                errors: [{ code: 10000, message: "Authentication error" }],
              }),
              { status: 403, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(JSON.stringify({ success: true, result: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      ),
    new RegExp(
      "R2 Buckets.*single Cloudflare API token that can deploy Workers scripts/assets, read/update KV, R2, D1, Queues, Vectorize, and roll out Cloudflare Containers",
    ),
  );
});

test("preflightWranglerDeployAuth checks individual R2 bucket access used by wrangler deploy", async () => {
  await assert.rejects(
    () =>
      preflightWranglerDeployAuth(
        rawOutputs,
        {
          CLOUDFLARE_CONTAINERS_API_TOKEN: "containers-only-token",
          CLOUDFLARE_ACCOUNT_ID: "acc_123",
        },
        async (url) => {
          if (url.endsWith("/r2/buckets/takos-test-worker-bundles")) {
            return new Response(
              JSON.stringify({
                success: false,
                errors: [{ code: 10000, message: "Authentication error" }],
              }),
              { status: 403, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(JSON.stringify({ success: true, result: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      ),
    /R2 Bucket worker_bundles.*single Cloudflare API token/,
  );
});

test("releaseChildEnv preserves Takosumi Cloud compat API base for managed targets", () => {
  const containerImages = JSON.stringify({
    runtime: "registry.cloudflare.com/backend_acc/takos-worker-runtime:0.10.0",
    executor: "registry.cloudflare.com/backend_acc/takos-agent-executor:0.10.0",
  });

  assert.deepEqual(
    releaseChildEnv(
      { cloudflare_account_id: "ts_acc_takosumi_cloud" },
      {
        PATH: "/bin",
        CLOUDFLARE_API_TOKEN: "token",
        TAKOS_CLOUDFLARE_API_BASE_URL: "https://compat.example.test/client/v4",
        TAKOS_RELEASE_CONTAINER_IMAGES_JSON: containerImages,
      },
    ),
    {
      PATH: "/bin",
      CLOUDFLARE_API_TOKEN: "token",
      TAKOS_CLOUDFLARE_API_BASE_URL: "https://compat.example.test/client/v4",
      CLOUDFLARE_API_BASE_URL: "https://compat.example.test/client/v4",
      CF_API_BASE_URL: "https://compat.example.test/client/v4",
      CLOUDFLARE_BASE_URL: "https://compat.example.test/client/v4",
      TAKOS_RELEASE_CONTAINER_IMAGES_JSON: containerImages,
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      TAKOS_CLOUDFLARE_TARGET_MODE: "managed_compat",
      CF_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "ts_acc_takosumi_cloud",
      CF_ACCOUNT_ID: "ts_acc_takosumi_cloud",
    },
  );
});

test("releaseWranglerAccountId can derive a native account for explicit native helper operations", () => {
  const containerImages = JSON.stringify({
    runtime:
      "registry.cloudflare.com/backend_acc/takos-worker-runtime@sha256:1111111111111111111111111111111111111111111111111111111111111111",
    executor:
      "registry.cloudflare.com/backend_acc/takos-agent-executor@sha256:2222222222222222222222222222222222222222222222222222222222222222",
  });

  assert.equal(
    releaseWranglerAccountId(
      { cloudflare_account_id: "ts_acc_takosumi_cloud" },
      {
        TAKOS_CLOUDFLARE_API_BASE_URL: "https://compat.example.test/client/v4",
        TAKOS_RELEASE_CONTAINER_IMAGES_JSON: containerImages,
      },
    ),
    "backend_acc",
  );
  assert.deepEqual(
    releaseChildEnv(
      { cloudflare_account_id: "ts_acc_takosumi_cloud" },
      {
        PATH: "/bin",
        CLOUDFLARE_API_TOKEN: "token",
        TAKOS_CLOUDFLARE_API_BASE_URL: "https://compat.example.test/client/v4",
        TAKOS_RELEASE_CONTAINER_IMAGES_JSON: containerImages,
      },
    ),
    {
      PATH: "/bin",
      CLOUDFLARE_API_TOKEN: "token",
      TAKOS_CLOUDFLARE_API_BASE_URL: "https://compat.example.test/client/v4",
      CLOUDFLARE_API_BASE_URL: "https://compat.example.test/client/v4",
      CF_API_BASE_URL: "https://compat.example.test/client/v4",
      CLOUDFLARE_BASE_URL: "https://compat.example.test/client/v4",
      TAKOS_RELEASE_CONTAINER_IMAGES_JSON: containerImages,
      CI: "true",
      WRANGLER_SEND_METRICS: "false",
      TAKOS_CLOUDFLARE_TARGET_MODE: "managed_compat",
      CF_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "ts_acc_takosumi_cloud",
      CF_ACCOUNT_ID: "ts_acc_takosumi_cloud",
    },
  );
});

test("buildTakosumiReleaseCommands uses the native Wrangler account for Vectorize", () => {
  const commands = buildTakosumiReleaseCommands(
    {
      ...rawOutputs,
      cloudflare_account_id: "ts_acc_takosumi_cloud",
    },
    "production",
    {
      wranglerAccountId: "backend_acc",
    },
  );

  assert.equal(
    commands[1],
    "'bun' 'scripts/control/ensure-vectorize-index.mjs' 'takos-test-embeddings' '--dimensions' '768' '--metric' 'cosine' '--account-id' 'backend_acc'",
  );
});

test("buildTakosumiReleaseCommands bundles instead of uploading through Wrangler for managed targets", () => {
  const commands = buildTakosumiReleaseCommands(
    {
      ...rawOutputs,
      cloudflare_account_id: "ts_acc_takosumi_cloud",
    },
    "production",
    {
      containersRollout: "none",
    },
  );

  assert.equal(
    commands.at(-1),
    `'bunx' 'wrangler' 'deploy' '--config' '${productionWranglerConfig}' '--name' 'takos-test' '--secrets-file' '.takos-release-secrets.production.json' '--env' '' '--containers-rollout' 'none' '--dry-run' '--outdir' '${releaseWranglerBundleDir("production")}'`,
  );
});

test("releaseChildEnv requires a compat API base for virtual Cloudflare outputs", () => {
  assert.throws(
    () =>
      releaseChildEnv(
        { cloudflare_account_id: "ts_acc_takosumi_cloud" },
        {
          PATH: "/bin",
          CLOUDFLARE_API_TOKEN: "token",
        },
      ),
    /require TAKOS_CLOUDFLARE_API_BASE_URL or CLOUDFLARE_API_BASE_URL/,
  );
});

test("Cloudflare release template enables production workers.dev launch URLs", () => {
  const wranglerTemplate = readFileSync(
    new URL("../../../deploy/cloudflare/wrangler.toml", import.meta.url),
    "utf8",
  );
  const [productionTemplate] = wranglerTemplate.split(/\n\[env\.staging\]\n/);
  assert.match(
    productionTemplate,
    /\naccount_id\s*=\s*"replace-with-account-id"\n/,
  );
  assert.match(productionTemplate, /\nworkers_dev\s*=\s*true\n/);
  assert.match(productionTemplate, /\n\[alias\]\n/);
  assert.match(
    productionTemplate,
    /\n"node:sqlite"\s*=\s*"\.\.\/\.\.\/src\/worker\/cloudflare\/node-sqlite-unavailable\.ts"\n/,
  );
});

test("ensureWorkersDevSubdomain enables launch URL scripts without logging tokens", async () => {
  const requests = [];
  const result = await ensureWorkersDevSubdomain(
    {
      service_runtime_name: "takos-test",
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
  assert.equal(requests[0].init.headers.authorization, "Bearer token_123");
  assert.equal(requests[0].init.body, JSON.stringify({ enabled: true }));
});

test("ensureWorkersDevSubdomain derives workers.dev URL from subdomain outputs", async () => {
  const requests = [];
  const result = await ensureWorkersDevSubdomain(
    {
      service_runtime_name: "takos-test",
      cloudflare_account_id: "acc_123",
      cloudflare_workers_subdomain: "example-subdomain",
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

  assert.equal(result.skipped, false);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/scripts/takos-test/subdomain",
  );
});

test("ensureWorkersDevSubdomain uses Cloudflare-compatible API base for managed targets", async () => {
  const requests = [];
  const result = await ensureWorkersDevSubdomain(
    {
      service_runtime_name: "takos-test",
      cloudflare_account_id: "ts_acc_takosumi_cloud",
      launch_url: "https://takos-test.example-subdomain.workers.dev",
    },
    {
      CLOUDFLARE_API_TOKEN: "token_123",
      TAKOS_CLOUDFLARE_API_BASE_URL: "https://compat.example.test/client/v4/",
    },
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
    "https://compat.example.test/client/v4/accounts/ts_acc_takosumi_cloud/workers/scripts/takos-test/subdomain",
  );
});

test("ensureWorkersDevSubdomain skips non-workers.dev releases", async () => {
  let called = false;
  const result = await ensureWorkersDevSubdomain(
    {
      service_runtime_name: "takos-test",
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

test("ensureWorkersDevSubdomain skips API enablement without Cloudflare API token", async () => {
  let called = false;
  const result = await ensureWorkersDevSubdomain(
    {
      service_runtime_name: "takos-test",
      cloudflare_account_id: "acc_123",
      launch_url: "https://takos-test.example-subdomain.workers.dev",
    },
    {},
    async () => {
      called = true;
      return new Response("{}");
    },
  );

  assert.deepEqual(result, {
    skipped: true,
    reason: "api_token_unavailable",
  });
  assert.equal(called, false);
});

test("ensureWorkersDevSubdomain waits until the uploaded Worker is visible", async () => {
  const requests = [];
  const result = await ensureWorkersDevSubdomain(
    {
      service_runtime_name: "takos-test",
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

test("ensureWorkersDevSubdomain skips API enablement when Wrangler-owned Worker is not yet visible", async () => {
  const requests = [];
  const result = await ensureWorkersDevSubdomain(
    {
      service_runtime_name: "takos-test",
      cloudflare_account_id: "acc_123",
      launch_url: "https://takos-test.example-subdomain.workers.dev",
    },
    {
      CLOUDFLARE_API_TOKEN: "token_123",
      TAKOS_RELEASE_WORKER_API_ATTEMPTS: "1",
      TAKOS_RELEASE_WORKER_API_INTERVAL_MS: "0",
    },
    async (url, init) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify({
          success: false,
          errors: [
            {
              code: 10007,
              message: "This Worker does not exist on your account.",
            },
          ],
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    },
  );

  assert.deepEqual(result, {
    skipped: true,
    reason: "workers_dev_api_unavailable",
  });
  assert.equal(requests.length, 1);
});

test("deployManagedCompatWorker uploads Wrangler bundle and assets through the compatibility API", async () => {
  const previousCwd = process.cwd();
  const root = mkdtempSync(resolve(tmpdir(), "takos-managed-upload-"));
  const requests: {
    url: string;
    method: string;
    authorization: string | null;
    assetAuthorization: string | null;
    metadata?: Record<string, unknown>;
    manifest?: Record<string, { hash: string; size: number }>;
    assetHashes?: string[];
  }[] = [];
  try {
    process.chdir(root);
    mkdirSync("deploy/cloudflare", { recursive: true });
    mkdirSync("dist/assets", { recursive: true });
    mkdirSync(releaseWranglerBundleDir("production"), { recursive: true });
    writeFileSync("dist/index.html", "<main>Takos</main>");
    writeFileSync("dist/assets/app.js", "console.log('takos');");
    writeFileSync(
      resolve(releaseWranglerBundleDir("production"), "index.js"),
      "export default { fetch() { return new Response('ok'); } };",
    );
    writeFileSync(
      productionWranglerConfig,
      [
        'name = "takos-test"',
        'main = "../../src/worker/index.ts"',
        'compatibility_date = "2026-04-01"',
        'compatibility_flags = ["nodejs_compat"]',
        "",
        "[vars]",
        'ADMIN_DOMAIN = "takos-test.app.takos.jp"',
        "",
        "[assets]",
        'directory = "../../dist"',
        'binding = "ASSETS"',
        "run_worker_first = true",
        "",
        "[[kv_namespaces]]",
        'binding = "HOSTNAME_ROUTING"',
        'id = "kv_hostname"',
        "",
        "[[durable_objects.bindings]]",
        'name = "RUNTIME_CONTAINER"',
        'class_name = "TakosRuntimeContainer"',
        "",
        "[[migrations]]",
        'tag = "v1"',
        'new_sqlite_classes = ["TakosRuntimeContainer"]',
        "",
        "[[containers]]",
        'class_name = "TakosRuntimeContainer"',
        "",
        "[[r2_buckets]]",
        'binding = "WORKER_BUNDLES"',
        'bucket_name = "takos-test-worker-bundles"',
        "",
        "[[queues.producers]]",
        'binding = "RUN_QUEUE"',
        'queue = "takos-test-runs"',
        "",
        "[[d1_databases]]",
        'binding = "DB"',
        'database_id = "d1_db"',
        "",
        "[[vectorize]]",
        'binding = "VECTORIZE"',
        'index_name = "takos-test-embeddings"',
        "",
        "[ai]",
        'binding = "AI"',
        "",
        "[[services]]",
        'binding = "TAKOS_EGRESS"',
        'service = "takos-test"',
        "",
      ].join("\n"),
    );

    const result = await deployManagedCompatWorker(
      {
        ...rawOutputs,
        cloudflare_account_id: "ts_acc_takosumi_cloud",
      },
      "production",
      {
        CLOUDFLARE_API_TOKEN: "compat-token",
        TAKOS_CLOUDFLARE_API_BASE_URL: "https://compat.example.test/client/v4",
      },
      async (url, init) => {
        const request = new Request(url, init);
        const entry = {
          url: request.url,
          method: request.method,
          authorization: request.headers.get("authorization"),
          assetAuthorization: request.headers.get(
            "x-takosumi-cloudflare-assets-authorization",
          ),
        };
        requests.push(entry);
        if (request.url.endsWith("/assets-upload-session")) {
          const body = await request.json();
          entry.manifest = body.manifest;
          return new Response(
            JSON.stringify({
              success: true,
              result: {
                buckets: [
                  Object.values(body.manifest).map((item) => item.hash),
                ],
                jwt: "assets-session-jwt",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (request.url.endsWith("/workers/assets/upload?base64=true")) {
          const form = await request.formData();
          entry.assetHashes = [...form.keys()];
          return new Response(
            JSON.stringify({
              success: true,
              result: { jwt: "assets-complete-jwt" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (request.url.endsWith("/workers/scripts/takos-test")) {
          const form = await request.formData();
          const metadata = JSON.parse(
            await (form.get("metadata") as Blob).text(),
          );
          entry.metadata = metadata;
          assert.equal(
            await (form.get("index.js") as Blob).text(),
            "export default { fetch() { return new Response('ok'); } };",
          );
          return new Response(
            JSON.stringify({
              success: true,
              result: { id: "takos-test", script_name: "takos-test" },
            }),
            { status: 201, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ success: false }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      },
    );

    assert.equal(result.workerName, "takos-test");
    assert.equal(result.assets?.manifestEntries, 2);
    assert.equal(requests.length, 3);
    assert.equal(
      requests.every(
        (request) => request.authorization === "Bearer compat-token",
      ),
      true,
    );
    assert.equal(requests[1].assetAuthorization, "Bearer assets-session-jwt");
    assert.deepEqual(Object.keys(requests[0].manifest ?? {}).sort(), [
      "/assets/app.js",
      "/index.html",
    ]);
    assert.deepEqual(
      requests[1].assetHashes?.sort(),
      Object.values(requests[0].manifest ?? {})
        .map((entry) => entry.hash)
        .sort(),
    );
    const metadata = requests[2].metadata ?? {};
    assert.equal(metadata.main_module, "index.js");
    assert.deepEqual(metadata.assets, {
      jwt: "assets-complete-jwt",
      config: { run_worker_first: true },
    });
    assert.deepEqual(metadata.containers, [
      { class_name: "TakosRuntimeContainer" },
    ]);
    assert.deepEqual(metadata.migrations, {
      new_tag: "v1",
      steps: [{ new_sqlite_classes: ["TakosRuntimeContainer"] }],
    });
    assert.deepEqual(
      (metadata.bindings as Array<Record<string, unknown>>).map((binding) => [
        binding.name,
        binding.type,
      ]),
      [
        ["ADMIN_DOMAIN", "plain_text"],
        ["HOSTNAME_ROUTING", "kv_namespace"],
        ["RUNTIME_CONTAINER", "durable_object_namespace"],
        ["RUN_QUEUE", "queue"],
        ["WORKER_BUNDLES", "r2_bucket"],
        ["DB", "d1"],
        ["VECTORIZE", "vectorize"],
        ["TAKOS_EGRESS", "service"],
        ["AI", "ai"],
        ["ASSETS", "assets"],
      ],
    );
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("waitForWranglerDeployment retries until Wrangler reports an active version", async () => {
  const previousCwd = process.cwd();
  const root = mkdtempSync(resolve(tmpdir(), "takos-release-deployment-"));
  const bin = resolve(root, "bin");
  const state = resolve(root, "state");
  const log = resolve(root, "commands.log");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    resolve(bin, "bunx"),
    `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
count=0
if [ -f '${state}' ]; then
  count=$(cat '${state}')
fi
count=$((count + 1))
printf '%s' "$count" > '${state}'
if [ "$count" = "1" ]; then
  echo 'This Worker does not exist on your account. [code: 10007]' >&2
  exit 1
fi
cat <<'JSON'
{"id":"dep_123","versions":[{"version_id":"ver_123","percentage":100}]}
JSON
`,
  );
  chmodSync(resolve(bin, "bunx"), 0o755);
  try {
    process.chdir(root);
    const status = await waitForWranglerDeployment(rawOutputs, "production", {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TAKOS_RELEASE_WORKER_API_ATTEMPTS: "2",
      TAKOS_RELEASE_WORKER_API_INTERVAL_MS: "0",
    });
    assert.equal(status.id, "dep_123");
    assert.equal(status.versions[0].version_id, "ver_123");
    const commands = readFileSync(log, "utf8");
    assert.match(commands, /wrangler deployments status/);
    assert.match(commands, /--name takos-test/);
    assert.match(commands, /--json/);
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("waitForWranglerDeployment treats empty successful Wrangler JSON as retryable", async () => {
  const previousCwd = process.cwd();
  const root = mkdtempSync(
    resolve(tmpdir(), "takos-release-deployment-empty-"),
  );
  const bin = resolve(root, "bin");
  const state = resolve(root, "state");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    resolve(bin, "bunx"),
    `#!/bin/sh
count=0
if [ -f '${state}' ]; then
  count=$(cat '${state}')
fi
count=$((count + 1))
printf '%s' "$count" > '${state}'
if [ "$count" = "1" ]; then
  exit 0
fi
cat <<'JSON'
{"id":"dep_456","versions":[{"version_id":"ver_456","percentage":100}]}
JSON
`,
  );
  chmodSync(resolve(bin, "bunx"), 0o755);
  try {
    process.chdir(root);
    const status = await waitForWranglerDeployment(rawOutputs, "production", {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      TAKOS_RELEASE_WORKER_API_ATTEMPTS: "2",
      TAKOS_RELEASE_WORKER_API_INTERVAL_MS: "0",
    });
    assert.equal(status.id, "dep_456");
  } finally {
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
});

test("waitForWranglerDeploymentBestEffort does not fail release on empty Wrangler status", async () => {
  const previousCwd = process.cwd();
  const root = mkdtempSync(
    resolve(tmpdir(), "takos-release-deployment-best-effort-"),
  );
  const bin = resolve(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    resolve(bin, "bunx"),
    `#!/bin/sh
exit 0
`,
  );
  chmodSync(resolve(bin, "bunx"), 0o755);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => {
    warnings.push(String(message));
  };
  try {
    process.chdir(root);
    const result = await waitForWranglerDeploymentBestEffort(
      rawOutputs,
      "production",
      {
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        TAKOS_RELEASE_WORKER_API_ATTEMPTS: "1",
        TAKOS_RELEASE_WORKER_API_INTERVAL_MS: "0",
      },
    );
    assert.deepEqual(result, {
      skipped: true,
      reason: "wrangler_deployment_status_unavailable",
      message:
        "Wrangler deployment for takos-test was not visible after 1 attempt(s): wrangler deployments status returned no JSON output",
    });
    assert.equal(warnings.length, 1);
    assert.match(
      warnings[0],
      /Skipping Wrangler deployment status verification/,
    );
  } finally {
    console.warn = originalWarn;
    process.chdir(previousCwd);
    rmSync(root, { recursive: true, force: true });
  }
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
    "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/scripts/takos-test/content",
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
      "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/scripts/takos-test/content",
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
      "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/scripts/takos-test/content",
      "https://takos-test.example-subdomain.workers.dev/health",
    ],
  );
});

test("verifyReleaseDeployment uses Cloudflare-compatible API base for managed targets", async () => {
  const requests = [];
  const result = await verifyReleaseDeployment(
    {
      ...rawOutputs,
      cloudflare_account_id: "ts_acc_takosumi_cloud",
      launch_url: "https://takos-test.app.takos.jp",
    },
    "production",
    {
      CLOUDFLARE_API_TOKEN: "token_123",
      TAKOS_CLOUDFLARE_API_BASE_URL: "https://compat.example.test/client/v4/",
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
      "https://compat.example.test/client/v4/accounts/ts_acc_takosumi_cloud/workers/scripts/takos-test/content",
      "https://takos-test.app.takos.jp/health",
    ],
  );
  assert.equal(requests[0].init.headers.authorization, "Bearer token_123");
});

test("verifyReleaseDeployment derives health URL from workers subdomain outputs", async () => {
  const requests = [];
  const result = await verifyReleaseDeployment(
    {
      ...rawOutputs,
      cloudflare_workers_subdomain: "example-subdomain",
    },
    "production",
    {
      CLOUDFLARE_API_TOKEN: "token_123",
      TAKOS_RELEASE_HEALTH_ATTEMPTS: "1",
    },
    async (url) => {
      requests.push(String(url));
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
  assert.deepEqual(requests, [
    "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/scripts/takos-test/content",
    "https://takos-test.example-subdomain.workers.dev/health",
  ]);
});

test("verifyReleaseDeployment falls back to health when Cloudflare API token is unavailable", async () => {
  const requests = [];
  const result = await verifyReleaseDeployment(
    {
      ...rawOutputs,
      launch_url: "https://takos-test.example-subdomain.workers.dev",
    },
    "production",
    {
      TAKOS_RELEASE_HEALTH_ATTEMPTS: "1",
    },
    async (url) => {
      requests.push(String(url));
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    },
  );

  assert.deepEqual(result.artifact, {
    workerName: "takos-test",
    skipped: true,
    reason: "api_token_unavailable",
  });
  assert.equal(result.health.status, 200);
  assert.deepEqual(requests, [
    "https://takos-test.example-subdomain.workers.dev/health",
  ]);
});

test("verifyReleaseDeployment falls back to health when Worker content API is unavailable", async () => {
  const requests = [];
  const result = await verifyReleaseDeployment(
    {
      ...rawOutputs,
      launch_url: "https://takos-test.example-subdomain.workers.dev",
    },
    "production",
    {
      CLOUDFLARE_API_TOKEN: "token_123",
      TAKOS_RELEASE_WORKER_API_ATTEMPTS: "1",
      TAKOS_RELEASE_HEALTH_ATTEMPTS: "1",
    },
    async (url, init) => {
      requests.push({ url, init });
      const value = String(url);
      if (value.includes("/workers/scripts/")) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [
              {
                code: 10405,
                message: "Method not allowed for this authentication scheme",
              },
            ],
            result: null,
          }),
          { status: 405, headers: { "content-type": "application/json" } },
        );
      }
      if (value.includes("/workers/services/")) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [
              {
                code: 10092,
                message: "This environment does not exist on this Worker.",
              },
            ],
            result: null,
          }),
          { status: 404, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    },
  );

  assert.deepEqual(result.artifact, {
    workerName: "takos-test",
    skipped: true,
    reason: "content_api_unavailable",
  });
  assert.equal(result.health.status, 200);
  assert.deepEqual(
    requests.map((request) => String(request.url)),
    [
      "https://api.cloudflare.com/client/v4/accounts/acc_123/workers/scripts/takos-test/content",
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
  const rootMain = readFileSync(
    new URL("../../../deploy/opentofu/main.tf", import.meta.url),
    "utf8",
  );
  const rootVariables = readFileSync(
    new URL("../../../deploy/opentofu/variables.tf", import.meta.url),
    "utf8",
  );
  assert.match(rootModule, /output\s+"takosumi_release"\s*\{/);
  assert.match(rootMain, /public_url\s*=\s*var\.public_url/);
  assert.match(rootVariables, /variable\s+"takosumi_source_repo_url"\s*\{/);
  assert.match(rootVariables, /variable\s+"takosumi_source_ref"\s*\{/);
  assert.match(rootVariables, /variable\s+"release_containers_rollout"\s*\{/);
  assert.match(rootVariables, /variable\s+"release_container_images"\s*\{/);
  assert.match(rootVariables, /variable\s+"build_from_source"\s*\{/);
  assert.match(rootVariables, /variable\s+"worker_release_tag"\s*\{/);
  assert.match(rootVariables, /variable\s+"release_executor"\s*\{/);
  assert.match(rootVariables, /variable\s+"public_url"\s*\{/);
  assert.match(rootVariables, /default\s*=\s*"operator"/);
  assert.match(
    rootVariables,
    /contains\(\["runner",\s*"operator"\],\s*var\.release_executor\)/,
  );
  assert.match(rootModule, /post_apply\s*=\s*\[/);
  assert.match(rootModule, /pre_destroy\s*=\s*\[/);
  assert.match(rootModule, /output\s+"public_url"\s*\{/);
  assert.match(rootModule, /id\s*=\s*"takos-worker-release"/);
  assert.match(rootModule, /id\s*=\s*"takos-worker-destroy"/);
  assert.match(rootModule, /executor\s*=\s*var\.release_executor/);
  assert.match(rootModule, /timeout_seconds\s*=\s*1200/);
  assert.match(rootModule, /timeout_seconds\s*=\s*600/);
  assert.match(rootModule, /env\s*=\s*merge\(/);
  assert.match(
    rootModule,
    /TAKOS_RELEASE_TAKOSUMI_REPO_URL\s*=\s*var\.takosumi_source_repo_url/,
  );
  assert.match(
    rootModule,
    /TAKOS_RELEASE_TAKOSUMI_REF\s*=\s*var\.takosumi_source_ref/,
  );
  assert.doesNotMatch(
    rootModule,
    /TAKOS_RELEASE_PRUNE_EXISTING_WORKER_MIGRATIONS/,
  );
  assert.match(
    rootModule,
    /TAKOS_WRANGLER_CONTAINERS_ROLLOUT\s*=\s*var\.release_containers_rollout/,
  );
  assert.match(rootModule, /TAKOS_REQUIRE_PREBUILT_CONTAINER_IMAGES\s*=\s*"1"/);
  assert.match(
    rootModule,
    /TAKOS_RELEASE_CONTAINER_IMAGES_JSON\s*=\s*jsonencode\(local\.release_container_images\)/,
  );
  assert.match(
    rootModule,
    /TAKOS_RELEASE_WORKER_ARTIFACT_URL\s*=\s*local\.worker_release_artifact_url/,
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
});
