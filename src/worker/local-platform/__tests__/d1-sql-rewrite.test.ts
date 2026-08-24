import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import { readFile } from "node:fs/promises";

import {
  normalizePostgresMigrationSql,
  splitSqlStatements,
  stripLeadingSqlComments,
} from "../d1-sql-rewrite.ts";

test("normalizePostgresMigrationSql preserves delimiters after index statements", () => {
  const normalized = normalizePostgresMigrationSql(
    "0001_baseline.sql",
    `
CREATE TABLE "demo" (
  "id" TEXT NOT NULL PRIMARY KEY
);

CREATE INDEX "demo_first_idx" ON "demo"("id");

CREATE UNIQUE INDEX "demo_second_idx" ON "demo"("id");
`,
  );

  const statements = splitSqlStatements(normalized)
    .map((statement) => stripLeadingSqlComments(statement))
    .filter(Boolean);

  assertEquals(statements, [
    'CREATE TABLE "demo" (\n  "id" TEXT NOT NULL PRIMARY KEY\n)',
    'CREATE INDEX IF NOT EXISTS "demo_first_idx" ON "demo"("id")',
    'CREATE UNIQUE INDEX IF NOT EXISTS "demo_second_idx" ON "demo"("id")',
  ]);
});

test("normalizePostgresMigrationSql drops sqlite trigger bodies", () => {
  const normalized = normalizePostgresMigrationSql(
    "0011_services_schema_cutover.sql",
    `
CREATE TABLE IF NOT EXISTS "services" (
  "id" TEXT PRIMARY KEY NOT NULL
);

CREATE TRIGGER IF NOT EXISTS "trg_services_mirror_insert_to_workers"
AFTER INSERT ON "services"
BEGIN
  INSERT INTO "workers" ("id") VALUES (NEW."id");
END;

CREATE INDEX IF NOT EXISTS "idx_services_id" ON "services"("id");
`,
  );

  const statements = splitSqlStatements(normalized)
    .map((statement) => stripLeadingSqlComments(statement))
    .filter(Boolean);

  assertEquals(statements, [
    'CREATE TABLE IF NOT EXISTS "services" (\n  "id" TEXT PRIMARY KEY NOT NULL\n)',
    'CREATE INDEX IF NOT EXISTS "idx_services_id" ON "services"("id")',
  ]);
});

test("normalizePostgresMigrationSql cascades legacy worker mirror drops", () => {
  const normalized = normalizePostgresMigrationSql(
    "0033_drop_legacy_worker_mirrors.sql",
    "",
  );

  const statements = splitSqlStatements(normalized)
    .map((statement) => stripLeadingSqlComments(statement))
    .filter(Boolean);

  assertEquals(statements.slice(-3), [
    'DROP TABLE IF EXISTS "worker_bindings" CASCADE',
    'DROP TABLE IF EXISTS "worker_common_env_links" CASCADE',
    'DROP TABLE IF EXISTS "workers" CASCADE',
  ]);
});

test("normalizePostgresMigrationSql rewrites sqlite json helper migrations", () => {
  for (
    const fileName of [
      "0036_group_inventory_unification.sql",
      "0037_resource_capability_cleanup.sql",
      "0038_group_provider_cleanup.sql",
      "0062_group_deployment_snapshot_build_sources_v2.sql",
    ]
  ) {
    const normalized = normalizePostgresMigrationSql(fileName, "");

    assertEquals(normalized.includes("json_extract"), false);
    assertEquals(normalized.includes("json_set"), false);
    assertEquals(normalized.includes("json_valid"), false);
    assertEquals(normalized.includes("json_each"), false);
    assertEquals(normalized.includes("json_group_array"), false);
    assertEquals(normalized.includes("json_object("), false);
  }
});

test("normalizePostgresMigrationSql skips sqlite table-rebuild repair", () => {
  assertEquals(
    normalizePostgresMigrationSql(
      "0055_repair_service_fk_rename_artifacts.sql",
      "DROP TABLE example;",
    ),
    "",
  );
});

test("agent authority expand migration keeps both SQL lineages additive", async () => {
  const source = await readFile(
    new URL(
      "../../../../db/migrations-control/migrations/0112_run_context_revisions.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const normalized = normalizePostgresMigrationSql(
    "0112_run_context_revisions.sql",
    source,
  );

  for (
    const table of [
      "run_grants",
      "run_context_revisions",
      "mcp_tool_confirmation_identities",
      "mcp_confirmation_run_grants",
    ]
  ) {
    assertEquals(
      normalized.includes(`CREATE TABLE IF NOT EXISTS "${table}"`),
      true,
    );
  }
  assertEquals(normalized.includes("DROP TABLE"), false);
  assertEquals(normalized.includes('ALTER TABLE "runs"'), false);
  assertEquals(normalized.includes("json_valid"), false);
});

test("agent deletion authority migration stays additive across SQL lineages", async () => {
  const source = await readFile(
    new URL(
      "../../../../db/migrations-control/migrations/0113_agent_resource_deletion_authority.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const normalized = normalizePostgresMigrationSql(
    "0113_agent_resource_deletion_authority.sql",
    source,
  );

  for (
    const table of [
      "agent_resource_tombstones",
      "agent_resource_deletion_outbox",
    ]
  ) {
    assertEquals(
      normalized.includes(`CREATE TABLE IF NOT EXISTS "${table}"`),
      true,
    );
  }
  assertEquals(normalized.includes("DROP TABLE"), false);
  assertEquals(normalized.includes("ALTER TABLE"), false);
  assertEquals(normalized.includes("json_valid"), false);
});

test("progressive RunContext authority migration stays additive across SQL lineages", async () => {
  const source = await readFile(
    new URL(
      "../../../../db/migrations-control/migrations/0114_run_context_resource_authority.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const normalized = normalizePostgresMigrationSql(
    "0114_run_context_resource_authority.sql",
    source,
  );

  assertEquals(
    normalized.includes(
      'CREATE TABLE IF NOT EXISTS "run_context_resource_refs"',
    ),
    true,
  );
  for (
    const column of [
      '"current_context_revision"',
      '"terminal_reason"',
      '"activation_event_key"',
      '"identity_extension_version"',
      '"active_context_revision"',
      '"active_context_digest"',
    ]
  ) {
    assertEquals(normalized.includes(column), true);
  }
  assertEquals(normalized.includes("DROP TABLE"), false);
  assertEquals(normalized.includes("DROP COLUMN"), false);
  assertEquals(normalized.includes("json_valid"), false);
});

test("model-call authority migration stays additive across SQL lineages", async () => {
  const source = await readFile(
    new URL(
      "../../../../db/migrations-control/migrations/0115_run_model_call_authority.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const normalized = normalizePostgresMigrationSql(
    "0115_run_model_call_authority.sql",
    source,
  );

  assertEquals(
    normalized.includes('CREATE TABLE IF NOT EXISTS "run_model_calls"'),
    true,
  );
  assertEquals(
    normalized.includes('FOREIGN KEY ("run_id", "context_revision")'),
    true,
  );
  assertEquals(normalized.includes("DROP TABLE"), false);
  assertEquals(normalized.includes("ALTER TABLE"), false);
  assertEquals(normalized.includes("json_valid"), false);
});

test("immutable Skill and resource migrations stay additive across SQL lineages", async () => {
  for (
    const fileName of [
      "0116_skill_revisions.sql",
      "0117_skill_resource_revisions.sql",
    ]
  ) {
    const source = await readFile(
      new URL(
        `../../../../db/migrations-control/migrations/${fileName}`,
        import.meta.url,
      ),
      "utf8",
    );
    const normalized = normalizePostgresMigrationSql(fileName, source);
    assertEquals(normalized.includes("DROP TABLE"), false);
    assertEquals(normalized.includes("DROP COLUMN"), false);
    assertEquals(normalized.includes("ALTER TABLE"), false);
    assertEquals(normalized.includes("json_valid"), false);
  }
  const resourceSource = await readFile(
    new URL(
      "../../../../db/migrations-control/migrations/0117_skill_resource_revisions.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const normalizedResource = normalizePostgresMigrationSql(
    "0117_skill_resource_revisions.sql",
    resourceSource,
  );
  assertEquals(
    normalizedResource.includes(
      'CREATE TABLE IF NOT EXISTS "skill_resource_revisions"',
    ),
    true,
  );
  assertEquals(
    normalizedResource.includes('REFERENCES "skill_revisions"'),
    true,
  );
});

test("ToolDescriptor revision migration stays additive across SQL lineages", async () => {
  const fileName = "0118_tool_descriptor_revisions.sql";
  const source = await readFile(
    new URL(
      `../../../../db/migrations-control/migrations/${fileName}`,
      import.meta.url,
    ),
    "utf8",
  );
  const normalized = normalizePostgresMigrationSql(fileName, source);

  for (
    const table of [
      "tool_descriptor_revisions",
      "run_context_tool_descriptor_refs",
    ]
  ) {
    assertEquals(
      normalized.includes(`CREATE TABLE IF NOT EXISTS "${table}"`),
      true,
    );
  }
  assertEquals(normalized.includes("DROP TABLE"), false);
  assertEquals(normalized.includes("DROP COLUMN"), false);
  assertEquals(normalized.includes("ALTER TABLE"), false);
  assertEquals(normalized.includes("json_valid"), false);
});

test("splitSqlStatements handles doubled-quote escapes (no backslash escape)", () => {
  // Standard SQL `''` escape inside a literal must NOT terminate the literal.
  assertEquals(
    splitSqlStatements("INSERT INTO t (v) VALUES ('it''s; fine'); SELECT 1"),
    ["INSERT INTO t (v) VALUES ('it''s; fine')", "SELECT 1"],
  );
});

test("splitSqlStatements treats trailing backslash in a literal as data, not an escape", () => {
  // A literal ending in `\` before the closing quote must still close the
  // string; the previous backslash-escape logic left the parser in-string and
  // merged the next statement into it.
  assertEquals(
    splitSqlStatements("INSERT INTO t (p) VALUES ('C:\\'); SELECT 2"),
    ["INSERT INTO t (p) VALUES ('C:\\')", "SELECT 2"],
  );
});

test("splitSqlStatements handles doubled double-quote in identifiers", () => {
  assertEquals(
    splitSqlStatements('SELECT "weird""col" FROM t; SELECT 3'),
    ['SELECT "weird""col" FROM t', "SELECT 3"],
  );
});

test("normalizePostgresMigrationSql drops SQLite triggers that carry leading comments", async () => {
  // 0111 は CREATE TRIGGER の直前に説明のコメントを置いている。コメントを
  // 読み飛ばさずに判定していたころは、この文がそのまま Postgres へ渡り、
  // IF NOT EXISTS を解釈できずに空のデータベースからの起動が止まっていた。
  const fileName = "0111_workspace_deletion_receipts.sql";
  const sql = await readFile(
    new URL(
      `../../../../db/migrations-control/migrations/${fileName}`,
      import.meta.url,
    ),
    "utf8",
  );
  const normalized = normalizePostgresMigrationSql(fileName, sql);
  assertEquals(/CREATE\s+TRIGGER/i.test(normalized), false);
  assertEquals(
    normalized.includes('CREATE TABLE IF NOT EXISTS "workspace_deletion_receipts"'),
    true,
  );
});
