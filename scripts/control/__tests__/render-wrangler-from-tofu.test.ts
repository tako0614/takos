import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  assertRenderedWorkerTarget,
  buildReplacements,
  parseTakosumiOutputsJson,
} from "../render-wrangler-from-tofu.mjs";

const rawOutputs = {
  cloudflare_account_id: "acc_123",
  worker_name: "takos-test",
  cloudflare_d1_database_ids: {
    db: "d1_db",
    accounts: "d1_accounts",
    deploy: "d1_deploy",
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
    accounts_exports: "r2_accounts_exports",
    artifacts: "r2_artifacts",
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
    "replace-with-accounts-d1-database-id": "d1_accounts",
    "replace-with-deploy-d1-database-id": "d1_deploy",
    "replace-with-hostname-routing-kv-namespace-id": "kv_host",
    "replace-with-rollout-health-kv-namespace-id": "kv_rollout",
    '"takos-accounts-exports"': '"r2_accounts_exports"',
    '"takos-artifacts"': '"r2_artifacts"',
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
      "replace-with-staging-account-id": "acc_123",
      "replace-with-staging-d1-database-id": "d1_db",
      "replace-with-staging-accounts-d1-database-id": "d1_accounts",
      "replace-with-staging-deploy-d1-database-id": "d1_deploy",
      "replace-with-staging-hostname-routing-kv-namespace-id": "kv_host",
      "replace-with-staging-rollout-health-kv-namespace-id": "kv_rollout",
      '"takos-accounts-exports-staging"': '"r2_accounts_exports"',
      '"takos-artifacts-staging"': '"r2_artifacts"',
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

test("parseTakosumiOutputsJson rejects non-object payloads", () => {
  assert.throws(() => parseTakosumiOutputsJson("[]"));
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
