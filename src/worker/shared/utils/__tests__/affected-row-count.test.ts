import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { affectedRowCount } from "../affected-row-count.ts";

test("affectedRowCount reads D1Result meta.changes", () => {
  // Cloudflare D1 RunResult shape (production runtime driver).
  const d1Result = {
    success: true,
    results: [],
    meta: {
      duration: 0.5,
      changes: 3,
      last_row_id: 42,
      rows_read: 0,
      rows_written: 3,
      changed_db: true,
    },
  };
  assertEquals(affectedRowCount(d1Result), 3);
});

test("affectedRowCount reads libsql ResultSet rowsAffected", () => {
  // @libsql/client ResultSet shape (local SQLite stack).
  const libsqlResult = {
    columns: [],
    rows: [],
    rowsAffected: 7,
    lastInsertRowid: 99n,
  };
  assertEquals(affectedRowCount(libsqlResult), 7);
});

test("affectedRowCount reads better-sqlite3 RunResult changes", () => {
  // better-sqlite3 / node:sqlite RunResult shape.
  const betterSqliteResult = {
    changes: 2,
    lastInsertRowid: 17,
  };
  assertEquals(affectedRowCount(betterSqliteResult), 2);
});

test("affectedRowCount prefers meta.changes when multiple fields present", () => {
  // Some shim layers populate every field; the D1 meta field wins because the
  // production driver is canonical.
  const mixed = {
    meta: { changes: 1 },
    changes: 99,
    rowsAffected: 99,
  };
  assertEquals(affectedRowCount(mixed), 1);
});

test("affectedRowCount returns 0 for missing / null / non-object inputs", () => {
  assertEquals(affectedRowCount(null), 0);
  assertEquals(affectedRowCount(undefined), 0);
  assertEquals(affectedRowCount({}), 0);
  assertEquals(affectedRowCount({ meta: null }), 0);
  assertEquals(affectedRowCount({ meta: {} }), 0);
  assertEquals(affectedRowCount("not an object"), 0);
  assertEquals(affectedRowCount(42), 0);
});

test("affectedRowCount coerces non-finite candidates to 0", () => {
  assertEquals(affectedRowCount({ changes: Number.NaN }), 0);
  assertEquals(affectedRowCount({ rowsAffected: "abc" }), 0);
  assertEquals(affectedRowCount({ meta: { changes: undefined } }), 0);
});

test("affectedRowCount coerces numeric strings", () => {
  // Some drivers (notably better-sqlite3 with BigInt mode disabled) may
  // surface numeric strings. Number() handles that uniformly.
  assertEquals(affectedRowCount({ rowsAffected: "5" }), 5);
});
