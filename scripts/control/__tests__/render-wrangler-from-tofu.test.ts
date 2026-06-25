import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  buildReplacements,
  parseTakosumiOutputsJson,
} from "../render-wrangler-from-tofu.mjs";

const rawOutputs = {
  cloudflare_account_id: "acc_123",
  cloudflare_d1_database_ids: {
    db: "d1_db",
    accounts: "d1_accounts",
    deploy: "d1_deploy",
  },
  cloudflare_kv_namespace_ids: {
    hostname_routing: "kv_host",
    rollout_health: "kv_rollout",
  },
};

test("buildReplacements accepts tofu output envelopes", () => {
  const envelope = Object.fromEntries(
    Object.entries(rawOutputs).map(([name, value]) => [
      name,
      { sensitive: false, type: "dynamic", value },
    ]),
  );

  assert.deepEqual(buildReplacements(envelope, "production"), {
    "replace-with-account-id": "acc_123",
    "replace-with-d1-database-id": "d1_db",
    "replace-with-accounts-d1-database-id": "d1_accounts",
    "replace-with-deploy-d1-database-id": "d1_deploy",
    "replace-with-hostname-routing-kv-namespace-id": "kv_host",
    "replace-with-rollout-health-kv-namespace-id": "kv_rollout",
  });
});

test("buildReplacements accepts Takosumi release raw outputs", () => {
  assert.deepEqual(
    buildReplacements(rawOutputs, "staging", { zoneId: "zone_123" }),
    {
      "replace-with-staging-account-id": "acc_123",
      "replace-with-staging-d1-database-id": "d1_db",
      "replace-with-staging-accounts-d1-database-id": "d1_accounts",
      "replace-with-staging-deploy-d1-database-id": "d1_deploy",
      "replace-with-staging-hostname-routing-kv-namespace-id": "kv_host",
      "replace-with-staging-rollout-health-kv-namespace-id": "kv_rollout",
      "replace-with-staging-zone-id": "zone_123",
    },
  );
});

test("parseTakosumiOutputsJson rejects non-object payloads", () => {
  assert.throws(() => parseTakosumiOutputsJson("[]"));
});
