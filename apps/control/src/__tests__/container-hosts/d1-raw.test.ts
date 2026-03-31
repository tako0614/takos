/**
 * Tests for the d1-raw module: executeD1RawStatement.
 */
import {
  type D1RawOptions,
  executeD1RawStatement,
} from "@/container-hosts/d1-raw";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { assertSpyCallArgs } from "jsr:@std/testing/mock";

function makeMockStatement(options: {
  rawResult?: unknown[];
  rawColumnResult?: unknown[];
} = {}): any {
  const mock = {
    raw: async (opts?: { columnNames?: boolean }) => {
      if (opts?.columnNames) {
        return options.rawColumnResult ??
          [["col1", "col2"], [1, "a"], [2, "b"]];
      }
      return options.rawResult ?? [[1, "a"], [2, "b"]];
    },
  };
  return mock;
}

// ---------------------------------------------------------------------------
// executeD1RawStatement
// ---------------------------------------------------------------------------

Deno.test("executeD1RawStatement - calls raw() without options when columnNames is not requested", async () => {
  const stmt = makeMockStatement({ rawResult: [[1], [2], [3]] });

  const result = await executeD1RawStatement(stmt);
  assertSpyCallArgs(stmt.raw, 0, []);
  assertEquals(result, [[1], [2], [3]]);
});
Deno.test("executeD1RawStatement - calls raw() without options when rawOptions is undefined", async () => {
  const stmt = makeMockStatement();

  const result = await executeD1RawStatement(stmt, undefined);
  assertSpyCallArgs(stmt.raw, 0, []);
});
Deno.test("executeD1RawStatement - calls raw() without options when columnNames is false", async () => {
  const stmt = makeMockStatement();

  const result = await executeD1RawStatement(stmt, { columnNames: false });
  assertSpyCallArgs(stmt.raw, 0, []);
});
Deno.test("executeD1RawStatement - calls raw({ columnNames: true }) when columnNames is true", async () => {
  const stmt = makeMockStatement({
    rawColumnResult: [["id", "name"], [1, "test"]],
  });

  const result = await executeD1RawStatement(stmt, { columnNames: true });
  assertSpyCallArgs(stmt.raw, 0, [{ columnNames: true }]);
  assertEquals(result, [["id", "name"], [1, "test"]]);
});
Deno.test("executeD1RawStatement - returns empty array when raw returns empty", async () => {
  const stmt = makeMockStatement({ rawResult: [] });

  const result = await executeD1RawStatement(stmt);
  assertEquals(result, []);
});
Deno.test("executeD1RawStatement - returns column names as first row when columnNames is true", async () => {
  const stmt = makeMockStatement({
    rawColumnResult: [["a", "b", "c"]],
  });

  const result = await executeD1RawStatement(stmt, { columnNames: true });
  assertEquals(result[0], ["a", "b", "c"]);
});
Deno.test("executeD1RawStatement - propagates errors from the statement", async () => {
  const stmt = {
    raw: async () => {
      throw new Error("D1_ERROR: query failed");
    },
  };

  await assertRejects(async () => {
    await executeD1RawStatement(stmt as any);
  }, "D1_ERROR: query failed");
});
