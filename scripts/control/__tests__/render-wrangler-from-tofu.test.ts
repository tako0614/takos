import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  assertRenderedWorkerTarget,
  buildReplacements,
  containerApplicationName,
  parseArgs,
  parseTakosumiOutputsJson,
  renderContainerApplicationNames,
} from "../render-wrangler-from-tofu.mjs";

const rawOutputs = {
  cloudflare_account_id: "acc_123",
  worker_name: "takos-test",
  cloudflare_d1_database_ids: {
    db: "d1_db",
  },
  cloudflare_kv_namespace_ids: {
    hostname_routing: "kv_host",
    rollout_health: "kv_rollout",
  },
  object_storage_buckets: {
    worker_bundles: "r2_worker_bundles",
    tenant_builds: "r2_tenant_builds",
    tenant_source: "r2_tenant_source",
    git_objects: "r2_git_objects",
    offload: "r2_offload",
  },
  queue_bindings: {
    runs: "q_runs",
    runs_dlq: "q_runs_dlq",
    index_jobs: "q_index",
    index_jobs_dlq: "q_index_dlq",
    workflow: "q_workflow",
    workflow_dlq: "q_workflow_dlq",
    deployment: "q_deploy",
    deployment_dlq: "q_deploy_dlq",
  },
  cloudflare_vectorize_index_name: "vec_takos",
};

test("buildReplacements accepts tofu output envelopes", () => {
  const envelope = Object.fromEntries(
    Object.entries(rawOutputs).map(([name, value]) => [
      name,
      { sensitive: false, type: "dynamic", value },
    ]),
  );

  assert.deepEqual(buildReplacements(envelope, "production"), {
    '"takos"': '"takos-test"',
    "replace-with-account-id": "acc_123",
    "replace-with-d1-database-id": "d1_db",
    "replace-with-hostname-routing-kv-namespace-id": "kv_host",
    "replace-with-rollout-health-kv-namespace-id": "kv_rollout",
    '"takos-worker-bundles"': '"r2_worker_bundles"',
    '"takos-tenant-builds"': '"r2_tenant_builds"',
    '"takos-tenant-source"': '"r2_tenant_source"',
    '"takos-git-objects"': '"r2_git_objects"',
    '"takos-offload"': '"r2_offload"',
    '"takos-runs"': '"q_runs"',
    '"takos-runs-dlq"': '"q_runs_dlq"',
    '"takos-index-jobs"': '"q_index"',
    '"takos-index-jobs-dlq"': '"q_index_dlq"',
    '"takos-workflow-jobs"': '"q_workflow"',
    '"takos-workflow-jobs-dlq"': '"q_workflow_dlq"',
    '"takos-deployment-jobs"': '"q_deploy"',
    '"takos-deployment-jobs-dlq"': '"q_deploy_dlq"',
    '"takos-embeddings"': '"vec_takos"',
  });
});

test("buildReplacements accepts Takosumi release raw outputs", () => {
  assert.deepEqual(
    buildReplacements(rawOutputs, "staging", { zoneId: "zone_123" }),
    {
      '"takos-staging"': '"takos-test"',
      "replace-with-account-id": "acc_123",
      "replace-with-staging-account-id": "acc_123",
      "replace-with-staging-d1-database-id": "d1_db",
      "replace-with-staging-hostname-routing-kv-namespace-id": "kv_host",
      "replace-with-staging-rollout-health-kv-namespace-id": "kv_rollout",
      '"takos-worker-bundles-staging"': '"r2_worker_bundles"',
      '"takos-tenant-builds-staging"': '"r2_tenant_builds"',
      '"takos-tenant-source-staging"': '"r2_tenant_source"',
      '"takos-git-objects-staging"': '"r2_git_objects"',
      '"takos-offload-staging"': '"r2_offload"',
      '"takos-runs-staging"': '"q_runs"',
      '"takos-runs-dlq-staging"': '"q_runs_dlq"',
      '"takos-index-jobs-staging"': '"q_index"',
      '"takos-index-jobs-dlq-staging"': '"q_index_dlq"',
      '"takos-workflow-jobs-staging"': '"q_workflow"',
      '"takos-workflow-jobs-dlq-staging"': '"q_workflow_dlq"',
      '"takos-deployment-jobs-staging"': '"q_deploy"',
      '"takos-deployment-jobs-dlq-staging"': '"q_deploy_dlq"',
      '"takos-embeddings-staging"': '"vec_takos"',
      "replace-with-staging-zone-id": "zone_123",
    },
  );
});

test("buildReplacements can render a Wrangler-only account override", () => {
  assert.equal(
    buildReplacements(rawOutputs, "production", {
      accountIdOverride: "backend_acc",
    })["replace-with-account-id"],
    "backend_acc",
  );
  assert.equal(rawOutputs.cloudflare_account_id, "acc_123");
});

test("buildReplacements projects app_url into public Takos worker env placeholders", () => {
  assert.deepEqual(
    buildReplacements(
      {
        ...rawOutputs,
        app_url: "https://takos-test.app.takos.jp",
      },
      "production",
    )["app.your-domain.example"],
    "takos-test.app.takos.jp",
  );
  assert.equal(
    buildReplacements(
      {
        ...rawOutputs,
        launch_url: "https://takos-test.app-staging.takos.jp",
      },
      "staging",
    )["staging-admin.example.com"],
    "takos-test.app-staging.takos.jp",
  );
  assert.equal(
    buildReplacements(
      {
        ...rawOutputs,
        launch_url: "https://takos-test.app-staging.takos.jp",
      },
      "staging",
    )["staging-app.example.com"],
    "takos-test.app-staging.takos.jp",
  );
});

test("buildReplacements rejects non-https public launch URLs", () => {
  assert.throws(
    () =>
      buildReplacements(
        {
          ...rawOutputs,
          launch_url: "http://takos-test.example.com",
        },
        "production",
      ),
    /must be an https URL/,
  );
});

test("parseTakosumiOutputsJson rejects non-object payloads", () => {
  assert.throws(() => parseTakosumiOutputsJson("[]"));
});

test("parseArgs accepts generated wrangler output path", () => {
  assert.deepEqual(
    parseArgs([
      "production",
      "--out",
      "deploy/cloudflare/.takos-release-wrangler.production.toml",
      "--zone-id",
      "zone_123",
    ]),
    {
      env: "production",
      zoneId: "zone_123",
      outPath: "deploy/cloudflare/.takos-release-wrangler.production.toml",
      dryRun: false,
    },
  );
});

test("containerApplicationName uses worker-scoped stable names", () => {
  assert.equal(
    containerApplicationName("takos-test", "TakosRuntimeContainer"),
    "takos-test-runtime",
  );
  assert.equal(
    containerApplicationName("takos-test", "ExecutorContainerTier1"),
    "takos-test-executor-tier1",
  );
  assert.equal(
    containerApplicationName("takos-test", "UnknownContainer"),
    undefined,
  );
});

test("renderContainerApplicationNames fills only the selected environment", () => {
  const toml = [
    'name = "takos-prod"',
    "",
    "[[containers]]",
    'class_name = "TakosRuntimeContainer"',
    'image = "../../containers/runtime/Dockerfile"',
    "",
    "[[containers]]",
    'class_name = "ExecutorContainerTier1"',
    'image = "../../containers/executor/Dockerfile"',
    "",
    "[env.staging]",
    'name = "takos-stage"',
    "",
    "[[env.staging.containers]]",
    'class_name = "TakosRuntimeContainer"',
    'image = "../../containers/runtime/Dockerfile"',
    "",
  ].join("\n");

  const production = renderContainerApplicationNames(
    toml,
    "production",
    "takos-prod",
  );
  assert.match(
    production,
    /class_name = "TakosRuntimeContainer"\nname = "takos-prod-runtime"/,
  );
  assert.match(
    production,
    /class_name = "ExecutorContainerTier1"\nname = "takos-prod-executor-tier1"/,
  );
  assert.doesNotMatch(production, /takos-stage-runtime/);

  const staging = renderContainerApplicationNames(
    toml,
    "staging",
    "takos-stage",
  );
  assert.match(
    staging,
    /class_name = "TakosRuntimeContainer"\nname = "takos-stage-runtime"/,
  );
  assert.doesNotMatch(staging, /takos-prod-runtime/);
});

test("renderContainerApplicationNames replaces stale generated names", () => {
  const toml = [
    'name = "takos-prod"',
    "",
    "[[containers]]",
    'class_name = "TakosRuntimeContainer"',
    'name = "takos-takosruntimecontainer"',
    'image = "registry.cloudflare.com/example/old:tag"',
    "",
  ].join("\n");

  const rendered = renderContainerApplicationNames(
    toml,
    "production",
    "takos-prod",
  );
  assert.match(rendered, /name = "takos-prod-runtime"/);
  assert.doesNotMatch(rendered, /takos-takosruntimecontainer/);
});

test("assertRenderedWorkerTarget verifies rendered container application names", () => {
  const toml = renderContainerApplicationNames(
    [
      'name = "takos-prod"',
      "",
      "[[services]]",
      'binding = "TAKOS_EGRESS"',
      'service = "takos-prod"',
      "",
      "[[containers]]",
      'class_name = "TakosRuntimeContainer"',
      'image = "registry.cloudflare.com/example/runtime:tag"',
      "",
      "[[containers]]",
      'class_name = "ExecutorContainerTier1"',
      'image = "registry.cloudflare.com/example/executor:tag"',
      "",
    ].join("\n"),
    "production",
    "takos-prod",
  );

  assert.doesNotThrow(() =>
    assertRenderedWorkerTarget(toml, "production", "takos-prod"),
  );

  assert.throws(
    () =>
      assertRenderedWorkerTarget(
        toml.replace('name = "takos-prod-executor-tier1"', 'name = "stale"'),
        "production",
        "takos-prod",
      ),
    /container ExecutorContainerTier1 name mismatch/,
  );
});

test("assertRenderedWorkerTarget rejects stale rendered worker names", () => {
  const toml = [
    'name = "old-worker"',
    "",
    "[[services]]",
    'binding = "TAKOS_EGRESS"',
    'service = "old-worker"',
    "",
    "[env.staging]",
    'name = "old-worker-staging"',
    "",
    "[[env.staging.services]]",
    'binding = "TAKOS_EGRESS"',
    'service = "old-worker-staging"',
    "",
  ].join("\n");

  assert.throws(
    () => assertRenderedWorkerTarget(toml, "production", "takos-test"),
    /worker name mismatch/,
  );
  assert.throws(
    () => assertRenderedWorkerTarget(toml, "staging", "takos-test-staging"),
    /worker name mismatch/,
  );
});

test("assertRenderedWorkerTarget accepts matching worker target and self-service", () => {
  const toml = [
    'name = "takos-test"',
    "",
    "[[services]]",
    'binding = "TAKOS_EGRESS"',
    'service = "takos-test"',
    "",
    "[env.staging]",
    'name = "takos-test-staging"',
    "",
    "[[env.staging.services]]",
    'binding = "TAKOS_EGRESS"',
    'service = "takos-test-staging"',
    "",
  ].join("\n");

  assert.doesNotThrow(() =>
    assertRenderedWorkerTarget(toml, "production", "takos-test"),
  );
  assert.doesNotThrow(() =>
    assertRenderedWorkerTarget(toml, "staging", "takos-test-staging"),
  );
});
