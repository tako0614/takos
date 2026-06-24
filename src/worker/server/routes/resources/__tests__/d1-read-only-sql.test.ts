import { describe, expect, it } from "bun:test";
import { isReadOnlySql } from "../d1.ts";

describe("isReadOnlySql — read/write permission gate", () => {
  it("treats real reads as read-only", () => {
    expect(isReadOnlySql("SELECT * FROM users WHERE id = 5")).toBe(true);
    expect(isReadOnlySql("WITH t AS (SELECT 1) SELECT * FROM t")).toBe(true);
    expect(isReadOnlySql("EXPLAIN SELECT 1")).toBe(true);
    expect(isReadOnlySql("PRAGMA table_info(users)")).toBe(true);
    expect(isReadOnlySql("PRAGMA user_version")).toBe(true); // read form
  });

  it("treats writes as NOT read-only", () => {
    expect(isReadOnlySql("INSERT INTO t VALUES (1)")).toBe(false);
    expect(isReadOnlySql("UPDATE t SET x = 1")).toBe(false);
    expect(isReadOnlySql("DELETE FROM t")).toBe(false);
    expect(isReadOnlySql("DROP TABLE t")).toBe(false);
  });

  it("treats state-mutating PRAGMAs as NOT read-only (the bypass)", () => {
    // Assignment form changes persistent/connection state with no mutating
    // keyword — these used to slip through as "read-only".
    expect(isReadOnlySql("PRAGMA user_version = 4242")).toBe(false);
    expect(isReadOnlySql("PRAGMA writable_schema = ON")).toBe(false);
    expect(isReadOnlySql("PRAGMA journal_mode = WAL")).toBe(false);
    expect(isReadOnlySql("PRAGMA foreign_keys = OFF")).toBe(false);
    // Call-form mutators without `=`.
    expect(isReadOnlySql("PRAGMA wal_checkpoint(FULL)")).toBe(false);
    expect(isReadOnlySql("PRAGMA incremental_vacuum(10)")).toBe(false);
    expect(isReadOnlySql("PRAGMA optimize")).toBe(false);
  });

  it("does not confuse a SELECT WHERE `=` with a PRAGMA assignment", () => {
    expect(isReadOnlySql("SELECT * FROM t WHERE a = 1 AND b = 2")).toBe(true);
  });
});
