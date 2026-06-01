import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

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
