import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { strict as assert } from "node:assert";
import { test } from "bun:test";

const appRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const baselineSql = readFileSync(
  resolve(appRoot, "db/migrations-control/migrations/0001_baseline.sql"),
  "utf8",
);
const resetDbScript = readFileSync(
  resolve(appRoot, "scripts/control/reset-db.js"),
  "utf8",
);
const resetDbShellScript = readFileSync(
  resolve(appRoot, "scripts/control/reset-db.sh"),
  "utf8",
);
const defaultAppDistributionSql = readFileSync(
  resolve(appRoot, "db/migrations-control/migrations/0054_default_app_distribution_entries.sql"),
  "utf8",
);
const offloadBackfillScript = readFileSync(
  resolve(appRoot, "scripts/control/offload-backfill.ts"),
  "utf8",
);
const fixWorkerBindingsScript = readFileSync(
  resolve(appRoot, "scripts/control/fix-worker-bindings.js"),
  "utf8",
);
const dropAllSql = readFileSync(resolve(appRoot, "db/drop_all.sql"), "utf8");
const packageConfig = JSON.parse(
  readFileSync(resolve(appRoot, "package.json"), "utf8"),
) as {
  scripts?: Record<string, string>;
};

function assertSourceMatches(source: string, pattern: RegExp): void {
  assert.ok(
    pattern.test(source),
    `Expected source to match ${pattern}`,
  );
}
const scripts = packageConfig.scripts ?? {};

const postBaselineMigrationTables = [
  "app_usage_events",
  "app_usage_rollups",
  "ap_delivery_queue",
  "ap_followers",
  "groups",
  "memory_claim_edges",
  "memory_claims",
  "memory_evidence",
  "memory_paths",
  "publications",
  "repo_grants",
  "repo_push_activities",
  "service_bindings",
  "service_common_env_links",
  "service_consumes",
  "service_env_vars",
  "service_mcp_endpoints",
  "service_runtime_flags",
  "service_runtime_limits",
  "service_runtime_settings",
  "service_runtimes",
  "services",
  "store_inventory_items",
  "store_registry",
  "store_registry_updates",
  "tenant_workflow_instances",
  "tool_operations",
];

const contractedBaselineTables = [
  "auth_services",
  "billing_accounts",
  "billing_plan_features",
  "billing_plan_quotas",
  "billing_plan_rates",
  "billing_plans",
  "billing_transactions",
  "oauth_audit_logs",
  "oauth_authorization_codes",
  "oauth_clients",
  "oauth_consents",
  "oauth_device_codes",
  "oauth_states",
  "oauth_tokens",
  "personal_access_tokens",
  "managed_takos_tokens",
  "resource_access_tokens",
  "service_tokens",
  "usage_events",
  "usage_rollups",
];

function parseBaselineTables(source: string): string[] {
  return [
    ...new Set(
      [...source.matchAll(
        /CREATE TABLE(?: IF NOT EXISTS)?\s+"?([a-z0-9_]+)"?/g,
      )].map((match) => match[1]),
    ),
  ].sort();
}

function parseQuotedArray(source: string, constName: string): string[] {
  const match = source.match(
    new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\n\\];`),
  );
  if (!match) {
    throw new Error(`Could not find ${constName}`);
  }

  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((arrayMatch) =>
    arrayMatch[1]
  );
}

function parseDropTables(source: string): string[] {
  return [...source.matchAll(/DROP TABLE IF EXISTS ([a-z0-9_]+);/g)].map((
    match,
  ) => match[1]);
}
function currentCanonicalTables(): string[] {
  const tables = new Set([
    ...parseBaselineTables(baselineSql),
    ...parseBaselineTables(defaultAppDistributionSql),
    ...postBaselineMigrationTables,
  ]);
  for (const table of contractedBaselineTables) {
    tables.delete(table);
  }
  return [...tables].sort();
}

test("reset DB inventory - keeps reset-db.js aligned with the canonical current SQL table inventory", () => {
  const baselineTables = currentCanonicalTables();
  const resetTables = parseQuotedArray(resetDbScript, "TABLES");

  assert.ok(/const ACCOUNT_TABLE = ["']accounts["'];/.test(resetDbScript));
  assert.ok(!resetTables.includes("accounts"));
  assert.deepStrictEqual(resetTables.length, new Set(resetTables).size);

  const fullInventory = [...resetTables, "accounts"].sort();
  assert.deepStrictEqual(fullInventory, baselineTables);
});
test("reset DB inventory - documents contracted legacy baseline tables", () => {
  const baselineTables = [
    ...new Set([
      ...parseBaselineTables(baselineSql),
    ]),
  ];
  for (const table of contractedBaselineTables) {
    assert.ok(baselineTables.includes(table));
    assert.ok(!parseQuotedArray(resetDbScript, "TABLES").includes(table));
  }
});

test("reset DB inventory - preserves accounts and login identities by default", () => {
  assert.ok(
    resetDbScript.includes(
      "This will DELETE all data except accounts and login identity rows.",
    ),
  );
  assert.ok(
    resetDbScript.includes("PRESERVED_WITH_ACCOUNTS = new Set"),
  );
  assert.ok(resetDbScript.includes('"auth_identities"'));
  assert.ok(!resetDbScript.includes("users"));
  assert.ok(!resetDbScript.includes("principals"));
});

test("reset DB inventory - keeps remote reset script-driven instead of hiding it behind shorthand tasks", () => {
  assert.deepStrictEqual(scripts["db:reset"], undefined);
  assert.deepStrictEqual(scripts["db:reset:local"], undefined);
  assert.deepStrictEqual(scripts["db:reset:staging"], undefined);
  assert.deepStrictEqual(scripts["db:reset:prod"], undefined);
  assert.deepStrictEqual(
    scripts["db:migrate"],
    undefined,
  );

  assert.ok(
    resetDbScript.includes(
      "Usage: node scripts/reset-db.js --env <staging|production> [--include-accounts]",
    ),
  );
  assert.ok(
    resetDbScript.includes(
      "For local reset, use the local stack/bootstrap flow (`bun run local:up`); this script is for staging/production only.",
    ),
  );
  assert.ok(
    resetDbShellScript.includes('node "$SCRIPT_DIR/reset-db.js" "$@"'),
  );
});

test("reset DB inventory - requires explicit remote environment selection for maintenance helpers", () => {
  assert.ok(
    offloadBackfillScript.includes(
      "--remote requires --env staging|production",
    ),
  );
  assertSourceMatches(offloadBackfillScript, /const D1_TARGET = ["']DB["'];/);
  assert.ok(!offloadBackfillScript.includes("takos-control-db"));
  assert.ok(fixWorkerBindingsScript.includes("--env staging|production"));
  assertSourceMatches(fixWorkerBindingsScript, /["']DB["']/);
  assert.ok(!fixWorkerBindingsScript.includes("takos-control-db"));
});

test("reset DB inventory - keeps drop_all.sql aligned with the canonical current SQL table inventory", () => {
  const baselineTables = currentCanonicalTables();
  const dropTables = parseDropTables(dropAllSql);

  assert.deepStrictEqual(dropTables.length, new Set(dropTables).size);
  assert.ok(dropTables.includes("d1_migrations"));

  const dropTablesWithoutMigrations = dropTables
    .filter((table) => table !== "d1_migrations")
    .sort();
  assert.deepStrictEqual(dropTablesWithoutMigrations, baselineTables);
});
