import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  buildBootstrapPlan,
  formatPlan,
  parseBootstrapArgs,
} from "../selfhost-bootstrap.mjs";

function phaseIds(phases: Array<{ id: string }>) {
  return phases.map((phase) => phase.id);
}

test("parseBootstrapArgs defaults to production and parses flags", () => {
  assert.deepEqual(
    parseBootstrapArgs([
      "--account-id",
      "acc_1",
      "--zone-id",
      "zone_1",
      "--dry-run",
    ]),
    {
      environment: "production",
      accountId: "acc_1",
      zoneId: "zone_1",
      vectorizeIndex: undefined,
      vectorizeDimensions: "768",
      vectorizeMetric: "cosine",
      takosumiRepoDir: "../takosumi",
      skipProvision: false,
      skipMigrations: false,
      skipSecrets: false,
      dryRun: true,
    },
  );
});

test("buildBootstrapPlan emits the full ordered self-host runbook", () => {
  const phases = buildBootstrapPlan({
    environment: "production",
    accountId: "acc_1",
    zoneId: "zone_1",
  });
  assert.deepEqual(phaseIds(phases), [
    "provision",
    "render-wrangler",
    "vectorize",
    "build",
    "migrate",
    "secrets",
    "deploy",
  ]);
  // tofu apply carries the account id; render runs from the module dir.
  const provision = phases[0];
  assert.equal(provision.cwd, "deploy/opentofu");
  assert.ok(
    provision.commands.some((c: string) =>
      c.includes('cloudflare={account_id="acc_1"}'),
    ),
  );
  const render = phases[1];
  assert.equal(render.cwd, "deploy/opentofu");
  assert.ok(
    render.commands[0].includes(
      "render-wrangler-from-tofu.mjs' 'production' '--zone-id' 'zone_1'",
    ),
  );
  // Deploy is always last and uploads the artifact.
  assert.equal(phases.at(-1)?.id, "deploy");
  assert.ok(phases.at(-1)?.commands[0].includes("wrangler' 'deploy'"));
});

test("buildBootstrapPlan honors staging overlay and default index", () => {
  const phases = buildBootstrapPlan({
    environment: "staging",
    accountId: "acc_1",
  });
  const vectorize = phases.find((p) => p.id === "vectorize");
  assert.ok(vectorize?.commands[0].includes("takos-embeddings-staging"));
  const deploy = phases.find((p) => p.id === "deploy");
  assert.ok(deploy?.commands[0].includes("'--env' 'staging'"));
});

test("buildBootstrapPlan can skip provision/migrations/secrets", () => {
  const phases = buildBootstrapPlan({
    environment: "production",
    accountId: "acc_1",
    skipProvision: true,
    skipMigrations: true,
    skipSecrets: true,
  });
  assert.deepEqual(phaseIds(phases), ["vectorize", "build", "deploy"]);
});

test("buildBootstrapPlan substitutes an account-id placeholder for preview", () => {
  const phases = buildBootstrapPlan({ environment: "production" });
  const provision = phases[0];
  assert.ok(
    provision.commands.some((c: string) =>
      c.includes('cloudflare={account_id="<account-id>"}'),
    ),
  );
});

test("formatPlan numbers every command and renders working dirs", () => {
  const phases = buildBootstrapPlan({
    environment: "production",
    accountId: "acc_1",
  });
  const text = formatPlan(phases);
  assert.ok(text.includes("cd deploy/opentofu && tofu init"));
  assert.ok(text.includes("[1]"));
  // Each phase title is present.
  assert.ok(text.includes("Deploy the Worker artifact"));
});
