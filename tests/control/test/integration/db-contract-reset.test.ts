import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assert, assertStringIncludes } from "@std/assert";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const docsRoot = Deno.env.get("TAKOS_DOCS_DIR");
const docsCandidates = docsRoot
  ? [
    resolve(docsRoot, "takos/reference/database.md"),
    resolve(docsRoot, "reference/database.md"),
    resolve(repoRoot, "docs/reference/database.md"),
    resolve(repoRoot, "../docs/reference/database.md"),
  ]
  : [
    resolve(repoRoot, "docs/reference/database.md"),
    resolve(repoRoot, "../docs/reference/database.md"),
  ];

const docsDatabasePath = docsCandidates.find((candidate) =>
  existsSync(candidate)
);
if (!docsDatabasePath) {
  throw new Error(
    "Missing Takos database reference docs for DB contract tests",
  );
}
const docsDatabase = readFileSync(docsDatabasePath, "utf8");
const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const baselineSql = readFileSync(
  resolve(appRoot, "db/migrations/0001_baseline.sql"),
  "utf8",
);
const legacyAccountIdentityMigration = readFileSync(
  resolve(
    appRoot,
    "db/migrations/0073_drop_legacy_account_identity_columns.sql",
  ),
  "utf8",
);

const requiredTables = [
  "auth_sessions",
  "thread_shares",
  "mcp_servers",
  "bundle_deployments",
  "bundle_deployment_events",
  "service_mcp_endpoints",
  "repo_release_assets",
  "file_handler_matchers",
];

/**
 * Tables that unified principals/users/spaces into accounts.
 * All sources now use the canonical new names.
 */
const unifiedAccountTables = [
  "accounts",
  "account_memberships",
  "account_metadata",
];

const docsInventoryTables = [
  "service_runtimes",
  "infra_endpoints",
  "infra_endpoint_routes",
  "branches",
  "commits",
  "tags",
  "repo_remotes",
];

const forbiddenTables = [
  "projects",
  "space_builds",
  "tool_packages",
  "space_tools",
  "custom_tools",
  "space_installations",
  "usage_meters",
];

const legacyAccountIdentityColumns = [
  "google_sub",
  "takos_auth_id",
];

type ColumnContract = string | readonly string[];

const criticalColumns: Record<string, ColumnContract[]> = {
  resources: [
    "owner_account_id",
    "account_id",
  ],
  branches: [
    "commit_sha",
    "is_default",
    "is_protected",
  ],
  commits: [
    "tree_sha",
    "parent_shas",
    "author_date",
    "commit_date",
  ],
  tags: [
    "commit_sha",
    "tagger_name",
    "tagger_email",
  ],
  repo_remotes: [
    "upstream_repo_id",
  ],
  service_runtimes: [
    ["cloudflare_service_ref", "cf_worker_name"],
    "bundle_deployment_id",
  ],
  infra_endpoints: [
    ["target_service_ref", "target_worker_name"],
    "timeout_ms",
    "bundle_deployment_id",
  ],
  infra_endpoint_routes: [
    "path_prefix",
    "methods_json",
    "position",
  ],
  deployments: [
    "runtime_config_snapshot_json",
    "bindings_snapshot_encrypted",
    "env_vars_snapshot_encrypted",
    "routing_status",
  ],
  deployment_events: [
    "deployment_id",
    "actor_account_id",
    "event_type",
  ],
};

function extractBaselineTableBlock(source: string, table: string): string {
  const aliases = table === "service_runtimes"
    ? ["service_runtimes", "infra_workers"]
    : table === "service_mcp_endpoints"
    ? ["service_mcp_endpoints", "worker_mcp_endpoints"]
    : [table];
  for (const candidate of aliases) {
    const match = source.match(
      new RegExp(`CREATE TABLE "${candidate}" \\(([\\s\\S]*?)\\n\\);`),
    );
    if (match) {
      return match[1];
    }
  }
  throw new Error(`Missing baseline table block for ${table}`);
}

function expectBaselineTable(table: string): void {
  if (table === "service_runtimes") {
    assert(/CREATE TABLE "(service_runtimes|infra_workers)"/.test(baselineSql));
    return;
  }
  if (table === "service_mcp_endpoints") {
    assert(
      /CREATE TABLE "(service_mcp_endpoints|worker_mcp_endpoints)"/.test(
        baselineSql,
      ),
    );
    return;
  }
  assertStringIncludes(baselineSql, `CREATE TABLE "${table}"`);
}

function assertColumnContract(block: string, contract: ColumnContract): void {
  const columns = typeof contract === "string" ? [contract] : [...contract];
  assert(
    columns.some((column) => block.includes(column)),
    `Expected block to contain one of: ${columns.join(", ")}`,
  );
}

function dbContractTest(name: string, fn: () => void): void {
  Deno.test({
    name: `DB contract reset canon - ${name}`,
    fn,
  });
}

// NOTE: docs/reference/database.md was intentionally restructured from a
// detailed CREATE TABLE reference into a high-level ownership document. The
// canonical schema source is now the baseline SQL only. Assertions below
// were narrowed accordingly: docs-side checks are limited to forbidding
// mixed-product/legacy text, while structural table/column contracts run
// against the baseline SQL.

dbContractTest(
  "keeps the reset-critical tables present in baseline SQL",
  () => {
    for (const table of requiredTables) {
      expectBaselineTable(table);
    }
  },
);

dbContractTest("keeps unified account tables present in baseline SQL", () => {
  for (const table of unifiedAccountTables) {
    expectBaselineTable(table);
  }
});

dbContractTest(
  "keeps the canonical inventory tables present in baseline SQL",
  () => {
    for (const table of docsInventoryTables) {
      expectBaselineTable(table);
    }
  },
);

dbContractTest("removes legacy tables from baseline SQL", () => {
  for (const table of forbiddenTables) {
    assert(!baselineSql.includes(`CREATE TABLE "${table}"`));
  }
});

dbContractTest(
  "removes mixed-product schema text from Takos database docs",
  () => {
    assert(!docsDatabase.includes("Yurucommu Schema"));
    assert(!docsDatabase.includes("actors"));
    assert(!docsDatabase.includes("likes"));
  },
);

dbContractTest(
  "drops legacy account identity columns and indexes via forward migration",
  () => {
    for (const column of legacyAccountIdentityColumns) {
      assertStringIncludes(baselineSql, `"${column}" TEXT`);
      assertStringIncludes(
        legacyAccountIdentityMigration,
        `ALTER TABLE "accounts" DROP COLUMN "${column}";`,
      );
    }

    for (
      const indexName of [
        "accounts_google_sub_key",
        "accounts_google_sub_idx",
        "accounts_takos_auth_id_idx",
      ]
    ) {
      assertStringIncludes(
        legacyAccountIdentityMigration,
        `DROP INDEX IF EXISTS "${indexName}";`,
      );
    }
  },
);

dbContractTest(
  "uses snapshot deployment columns and normalized bundle asset references",
  () => {
    assertStringIncludes(baselineSql, '"runtime_config_snapshot_json"');
    assertStringIncludes(baselineSql, '"bindings_snapshot_encrypted"');
    assertStringIncludes(baselineSql, '"env_vars_snapshot_encrypted"');
    assert(!baselineSql.includes('"completed_steps"'));
    assertStringIncludes(baselineSql, '"bundle_format"');
    assertStringIncludes(baselineSql, '"bundle_meta_json"');
  },
);

dbContractTest(
  "keeps critical column contracts present in baseline SQL",
  () => {
    for (const [table, columns] of Object.entries(criticalColumns)) {
      const baselineBlock = extractBaselineTableBlock(baselineSql, table);
      for (const columnContract of columns) {
        assertColumnContract(baselineBlock, columnContract);
      }
    }
  },
);
