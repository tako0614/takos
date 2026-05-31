import { test } from "bun:test";
import { assertEquals } from "@std/assert";

import { splitSqlStatements } from "../persistent-bindings.ts";

test("splitSqlStatements splits multiple statements while preserving quoted semicolons", () => {
  const statements = splitSqlStatements(`
    CREATE TABLE demo (id INTEGER PRIMARY KEY, note TEXT);
    INSERT INTO demo (note) VALUES ('hello; world');
    UPDATE demo SET note = 'done' WHERE id = 1;
  `);

  assertEquals(statements, [
    "CREATE TABLE demo (id INTEGER PRIMARY KEY, note TEXT)",
    "INSERT INTO demo (note) VALUES ('hello; world')",
    "UPDATE demo SET note = 'done' WHERE id = 1",
  ]);
});

test("splitSqlStatements ignores empty statements", () => {
  const statements = splitSqlStatements(" ; SELECT 1; ; ");

  assertEquals(statements, ["SELECT 1"]);
});
