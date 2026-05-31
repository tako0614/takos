import {
  validateD1MigrationSql,
  validateD1QuerySql,
} from "@/application/services/execution/sql-validation.ts";

import { assert, assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("platform SQL validation helpers - accepts a single statement query", () => {
  const result = validateD1QuerySql("SELECT id, email FROM users WHERE id = ?");

  assertEquals(result.valid, true);
  assertEquals(result.statement, "SELECT id, email FROM users WHERE id = ?");
});

Deno.test("platform SQL validation helpers - allows semicolons inside string literals", () => {
  const result = validateD1QuerySql("SELECT 'a;b;c' AS message");

  assertEquals(result.valid, true);
  assertEquals(result.statement, "SELECT 'a;b;c' AS message");
});

Deno.test("platform SQL validation helpers - rejects semicolons used as statement separators", () => {
  const result = validateD1QuerySql("SELECT 1; SELECT 2");

  assertEquals(result.valid, false);
  assert(result.error);
  assertStringIncludes(result.error, "Semicolons are not allowed");
});

Deno.test("platform SQL validation helpers - rejects SQL comments", () => {
  for (
    const sql of [
      "SELECT 1 -- inline comment",
      "SELECT /* block comment */ 1",
    ]
  ) {
    const result = validateD1QuerySql(sql);

    assertEquals(result.valid, false);
    assert(result.error);
    assertStringIncludes(result.error, "comments are not allowed");
  }
});

Deno.test("platform SQL validation helpers - rejects forbidden verbs", () => {
  for (
    const sql of [
      "ATTACH DATABASE ? AS other_db",
      "SELECT load_extension('evil.so')",
      "PRAGMA journal_mode = WAL",
    ]
  ) {
    const result = validateD1QuerySql(sql);

    assertEquals(result.valid, false);
    assert(result.error);
    assertStringIncludes(result.error, "forbidden verb");
  }
});

Deno.test("platform SQL validation helpers - rejects unsupported statement verbs on query endpoint", () => {
  const result = validateD1QuerySql("DROP TABLE users");

  assertEquals(result.valid, false);
  assert(result.error);
  assertStringIncludes(result.error, "not allowed");
});

Deno.test("platform SQL validation helpers - rejects write statements on read-only query endpoint", () => {
  const result = validateD1QuerySql("DELETE FROM users WHERE id = ?");

  assertEquals(result.valid, false);
  assert(result.error);
  assertStringIncludes(result.error, "read-only");
});

Deno.test("platform SQL validation helpers - splits multiple statements while keeping semicolons inside literals", () => {
  const result = validateD1MigrationSql(
    "INSERT INTO logs(message) VALUES ('a;b'); UPDATE logs SET message = 'ok' WHERE id = 1",
  );

  assertEquals(result.valid, true);
  assertEquals(result.statements, [
    "INSERT INTO logs(message) VALUES ('a;b')",
    "UPDATE logs SET message = 'ok' WHERE id = 1",
  ]);
});

Deno.test("platform SQL validation helpers - allows DDL statements for migration endpoint", () => {
  const result = validateD1MigrationSql(
    "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT); DROP TABLE IF EXISTS notes_old",
  );

  assertEquals(result.valid, true);
  assert(result.statements);
  assertEquals(result.statements.length, 2);
});

Deno.test("platform SQL validation helpers - rejects comment abuse in migrations", () => {
  for (
    const sql of [
      "CREATE TABLE t(id INTEGER); -- comment",
      "/* preface */ CREATE TABLE t(id INTEGER)",
    ]
  ) {
    const result = validateD1MigrationSql(sql);

    assertEquals(result.valid, false);
    assert(result.error);
    assertStringIncludes(result.error, "comments are not allowed");
  }
});

Deno.test("platform SQL validation helpers - rejects forbidden migration verbs", () => {
  const result = validateD1MigrationSql("ATTACH DATABASE ? AS other_db");

  assertEquals(result.valid, false);
  assert(result.error);
  assertStringIncludes(result.error, "forbidden verb");
});

Deno.test("platform SQL validation helpers - rejects unterminated quoted strings", () => {
  const result = validateD1MigrationSql(
    "INSERT INTO logs(message) VALUES('unterminated)",
  );

  assertEquals(result.valid, false);
  assert(result.error);
  assertStringIncludes(result.error, "Unterminated SQL string");
});
