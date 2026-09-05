import { describe, expect, test } from "bun:test";

import {
  adaptEdgeSqlBinding,
  isEdgeSqlBinding,
  isNativeD1Binding,
  normalizeEdgeSqlResult,
  toEdgeSqlValue,
} from "../edge-sql.ts";

describe("edge.sql platform adapter", () => {
  test("projects execute results through the prepared D1 consumer surface", async () => {
    const calls: Array<{
      operation: string;
      sql?: string;
      params?: readonly unknown[];
    }> = [];
    const external = {
      async execute(sql: string, params?: readonly unknown[]) {
        calls.push({ operation: "execute", sql, params });
        return {
          rows: [{ id: 7, payload: { encoding: "base64" as const, data: "AQI=" } }],
          rowsWritten: 1,
        };
      },
      async query() {
        throw new Error("query must not be used by prepared consumers");
      },
      async transaction(statements: readonly unknown[]) {
        calls.push({ operation: "transaction" });
        return {
          results: statements.map(() => ({ rows: [], rowsWritten: 0 })),
        };
      },
    };

    expect(isEdgeSqlBinding(external)).toBe(true);
    expect(isNativeD1Binding(external)).toBe(false);

    const db = adaptEdgeSqlBinding(external);
    const result = await db
      .prepare("INSERT INTO blobs (payload) VALUES (?) RETURNING id, payload")
      .bind(new Uint8Array([1, 2]))
      .all<{ id: number; payload: Uint8Array }>();

    expect(calls).toEqual([
      {
        operation: "execute",
        sql: "INSERT INTO blobs (payload) VALUES (?) RETURNING id, payload",
        params: [{ encoding: "base64", data: "AQI=" }],
      },
    ]);
    expect(result.results[0]?.id).toBe(7);
    expect(result.results[0]?.payload).toBeInstanceOf(Uint8Array);
    expect([...result.results[0]!.payload]).toEqual([1, 2]);
    expect(result.meta.changes).toBe(1);
    expect("last_row_id" in result.meta).toBe(false);
  });

  test("preserves every raw named column through all, run, and first", async () => {
    const calls: string[] = [];
    const external = {
      async execute(operation: string) {
        calls.push(operation);
        return {
          rows: [Object.fromEntries([
            // Reverse the SQL projection order, include an integer-like name,
            // and keep __proto__ as an own data property. A host is free to
            // materialize its JSON record in this order.
            ["label", "raw"],
            ["__proto__", { encoding: "base64" as const, data: "AQI=" }],
            ["1", 9],
          ])],
          rowsWritten: 0,
        };
      },
      async query() {
        throw new Error("query must not be used by raw prepared consumers");
      },
      async transaction() {
        throw new Error("unexpected transaction");
      },
    };
    const db = adaptEdgeSqlBinding(external);
    const prepared = db.prepare(
      "SELECT 9 AS '1', x'0102' AS '__proto__', 'raw' AS label",
    );

    const all = await prepared.all<{
      "1": number;
      __proto__: Uint8Array;
      label: string;
    }>();
    const run = await prepared.run<{
      "1": number;
      __proto__: Uint8Array;
      label: string;
    }>();
    const first = await prepared.first<{
      "1": number;
      __proto__: Uint8Array;
      label: string;
    }>();

    const rows = [all.results[0], run.results[0], first];
    for (const row of rows) {
      expect(row?.["1"]).toBe(9);
      expect(row?.label).toBe("raw");
      expect(Object.hasOwn(row ?? {}, "__proto__")).toBe(true);
      expect(row?.__proto__).toBeInstanceOf(Uint8Array);
      expect([...(row?.__proto__ ?? [])]).toEqual([1, 2]);
    }
    expect(calls).toEqual([
      "SELECT 9 AS '1', x'0102' AS '__proto__', 'raw' AS label",
      "SELECT 9 AS '1', x'0102' AS '__proto__', 'raw' AS label",
      "SELECT 9 AS '1', x'0102' AS '__proto__', 'raw' AS label",
    ]);
  });

  test("sends a prepared batch as one external transaction", async () => {
    const transactions: Array<readonly unknown[]> = [];
    const external = {
      execute: async () => ({ rows: [], rowsWritten: 0 }),
      query: async () => ({ rows: [], rowsWritten: 0 }),
      async transaction(statements: readonly unknown[]) {
        transactions.push(statements);
        return {
          results: statements.map((_statement, index) => ({
            rows: [{ index }],
            rowsWritten: index + 1,
          })),
        };
      },
    };
    const db = adaptEdgeSqlBinding(external);

    const result = await db.batch([
      db.prepare("INSERT INTO t (value) VALUES (?)").bind("a"),
      db.prepare("UPDATE t SET value = ? WHERE value = ?").bind("b", "a"),
    ]);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toEqual([
      { sql: "INSERT INTO t (value) VALUES (?)", params: ["a"] },
      {
        sql: "UPDATE t SET value = ? WHERE value = ?",
        params: ["b", "a"],
      },
    ]);
    expect(result.map((entry) => entry.meta.changes)).toEqual([1, 2]);
  });

  test("refuses positional raw rows without projection metadata", async () => {
    let executed = false;
    const db = adaptEdgeSqlBinding({
      async execute() {
        executed = true;
        return { rows: [{ a: 1, b: 2 }], rowsWritten: 0 };
      },
      async query() {
        throw new Error("unexpected query");
      },
      async transaction() {
        throw new Error("unexpected transaction");
      },
    });

    await expect(db.prepare("select 1 as a, 2 as b").raw()).rejects.toThrow(
      "positional raw rows require projection metadata",
    );
    expect(executed).toBe(false);
  });

  test("refuses native-only helpers before any host call", async () => {
    const calls: string[] = [];
    const db = adaptEdgeSqlBinding({
      async execute() {
        calls.push("execute");
        return { rows: [], rowsWritten: 0 };
      },
      async query() {
        calls.push("query");
        return { rows: [], rowsWritten: 0 };
      },
      async transaction() {
        calls.push("transaction");
        return { results: [] };
      },
    });

    await expect(db.exec("SELECT 1")).rejects.toThrow(
      "native D1 exec is not expressible",
    );
    expect(() => db.withSession()).toThrow(
      "native D1 bookmarked sessions are not expressible",
    );
    await expect(db.dump()).rejects.toThrow(
      "native D1 dumps are not expressible",
    );
    expect(calls).toEqual([]);
  });

  test("does not silently coerce undefined into the closed value union", () => {
    expect(() => toEdgeSqlValue(undefined)).toThrow(
      "parameters are not edge.sql values",
    );
  });

  test("reports the published numeric_out_of_range error name", () => {
    let failure: unknown;
    try {
      toEdgeSqlValue(Number.MAX_SAFE_INTEGER + 1);
    } catch (error) {
      failure = error;
    }

    expect((failure as Error | undefined)?.name).toBe(
      "numeric_out_of_range",
    );
  });

  test("rejects result metadata outside the exact published shape", () => {
    let failure: unknown;
    try {
      normalizeEdgeSqlResult({
        rows: [],
        rowsWritten: 0,
        success: true,
      });
    } catch (error) {
      failure = error;
    }

    expect((failure as Error | undefined)?.name).toBe("sql_error");
    expect((failure as Error | undefined)?.message).toContain(
      "result must contain exactly rows and rowsWritten",
    );
  });
});
