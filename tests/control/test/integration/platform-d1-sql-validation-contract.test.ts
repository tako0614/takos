import {
  validateD1MigrationSql,
  validateD1QuerySql,
} from "@/application/services/execution/sql-validation.ts";

import { strict as assert } from "node:assert";
import { test } from "bun:test";

test("platform SQL validation helpers - accepts a single statement query", () => {
  const result = validateD1QuerySql("SELECT id, email FROM users WHERE id = ?");

  assert.deepStrictEqual(result.valid, true);
  assert.deepStrictEqual(result.statement, "SELECT id, email FROM users WHERE id = ?");
});

test("platform SQL validation helpers - allows semicolons inside string literals", () => {
  const result = validateD1QuerySql("SELECT 'a;b;c' AS message");

  assert.deepStrictEqual(result.valid, true);
  assert.deepStrictEqual(result.statement, "SELECT 'a;b;c' AS message");
});

test("platform SQL validation helpers - rejects semicolons used as statement separators", () => {
  const result = validateD1QuerySql("SELECT 1; SELECT 2");

  assert.deepStrictEqual(result.valid, false);
  assert.ok(result.error);
  assert.ok(result.error.includes("Semicolons are not allowed"));
});

test("platform SQL validation helpers - rejects SQL comments", () => {
  for (
    const sql of [
      "SELECT 1 -- inline comment",
      "SELECT /* block comment */ 1",
    ]
  ) {
    const result = validateD1QuerySql(sql);

    assert.deepStrictEqual(result.valid, false);
    assert.ok(result.error);
    assert.ok(result.error.includes("comments are not allowed"));
  }
});

test("platform SQL validation helpers - rejects forbidden verbs", () => {
  for (
    const sql of [
      "ATTACH DATABASE ? AS other_db",
      "SELECT load_extension('evil.so')",
      "PRAGMA journal_mode = WAL",
    ]
  ) {
    const result = validateD1QuerySql(sql);

    assert.deepStrictEqual(result.valid, false);
    assert.ok(result.error);
    assert.ok(result.error.includes("forbidden verb"));
  }
});

test("platform SQL validation helpers - rejects unsupported statement verbs on query endpoint", () => {
  const result = validateD1QuerySql("DROP TABLE users");

  assert.deepStrictEqual(result.valid, false);
  assert.ok(result.error);
  assert.ok(result.error.includes("not allowed"));
});

test("platform SQL validation helpers - rejects write statements on read-only query endpoint", () => {
  const result = validateD1QuerySql("DELETE FROM users WHERE id = ?");

  assert.deepStrictEqual(result.valid, false);
  assert.ok(result.error);
  assert.ok(result.error.includes("read-only"));
});

test("platform SQL validation helpers - splits multiple statements while keeping semicolons inside literals", () => {
  const result = validateD1MigrationSql(
    "INSERT INTO logs(message) VALUES ('a;b'); UPDATE logs SET message = 'ok' WHERE id = 1",
  );

  assert.deepStrictEqual(result.valid, true);
  assert.deepStrictEqual(result.statements, [
    "INSERT INTO logs(message) VALUES ('a;b')",
    "UPDATE logs SET message = 'ok' WHERE id = 1",
  ]);
});

test("platform SQL validation helpers - allows DDL statements for migration endpoint", () => {
  const result = validateD1MigrationSql(
    "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT); DROP TABLE IF EXISTS notes_old",
  );

  assert.deepStrictEqual(result.valid, true);
  assert.ok(result.statements);
  assert.deepStrictEqual(result.statements.length, 2);
});

test("platform SQL validation helpers - rejects comment abuse in migrations", () => {
  for (
    const sql of [
      "CREATE TABLE t(id INTEGER); -- comment",
      "/* preface */ CREATE TABLE t(id INTEGER)",
    ]
  ) {
    const result = validateD1MigrationSql(sql);

    assert.deepStrictEqual(result.valid, false);
    assert.ok(result.error);
    assert.ok(result.error.includes("comments are not allowed"));
  }
});

test("platform SQL validation helpers - rejects forbidden migration verbs", () => {
  const result = validateD1MigrationSql("ATTACH DATABASE ? AS other_db");

  assert.deepStrictEqual(result.valid, false);
  assert.ok(result.error);
  assert.ok(result.error.includes("forbidden verb"));
});

test("platform SQL validation helpers - rejects unterminated quoted strings", () => {
  const result = validateD1MigrationSql(
    "INSERT INTO logs(message) VALUES('unterminated)",
  );

  assert.deepStrictEqual(result.valid, false);
  assert.ok(result.error);
  assert.ok(result.error.includes("Unterminated SQL string"));
});
