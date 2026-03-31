// deno-lint-ignore-file no-import-prefix no-unversioned-import no-explicit-any

import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";
import { stub } from "jsr:@std/testing/mock";

import type { D1Database } from "../../../../../packages/control/src/shared/types/bindings.ts";
import {
  checkIdempotency,
  cleanupStaleOperations,
  completeOperation,
  generateOperationKey,
} from "../../../../../packages/control/src/application/tools/idempotency.ts";

type ToolOperationRow = {
  id: string;
  runId: string;
  operationKey: string;
  toolName: string;
  status: "pending" | "completed" | "failed";
  resultOutput: string | null;
  resultError: string | null;
  createdAt: string;
  completedAt: string | null;
};

type FakeDbOptions = {
  selectResults?: Array<ToolOperationRow | null>;
  runResults?: Array<{ meta: { changes: number } }>;
};

function createToolOperation(
  overrides: Partial<ToolOperationRow> = {},
): ToolOperationRow {
  return {
    id: "op-1",
    runId: "run-1",
    operationKey: "key-1",
    toolName: "tool",
    status: "pending",
    resultOutput: null,
    resultError: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

function createFakeDb(options: FakeDbOptions = {}) {
  const selectResults = [...(options.selectResults ?? [])];
  const runResults = [...(options.runResults ?? [])];
  const queries: Array<{ sql: string; args: unknown[] }> = [];

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          queries.push({ sql, args });

          return {
            raw: async () => {
              if (!sql.toLowerCase().startsWith("select ")) {
                throw new Error(`Unexpected raw() query: ${sql}`);
              }

              const row = selectResults.shift() ?? null;
              return row
                ? [[
                  row.id,
                  row.runId,
                  row.operationKey,
                  row.toolName,
                  row.status,
                  row.resultOutput,
                  row.resultError,
                  row.createdAt,
                  row.completedAt,
                ]]
                : [];
            },
            run: async () => ({
              success: true,
              meta: runResults.shift()?.meta ?? { changes: 1 },
            }),
            first: async () => null,
            all: async () => ({ results: [] }),
          };
        },
      };
    },
  } as unknown as D1Database;

  return { db, queries };
}

Deno.test("idempotency - generateOperationKey - generates deterministic keys for same inputs", async () => {
  const key1 = await generateOperationKey("run-1", "file_read", {
    path: "/test",
  });
  const key2 = await generateOperationKey("run-1", "file_read", {
    path: "/test",
  });
  assertEquals(key1, key2);
});

Deno.test("idempotency - generateOperationKey - generates different keys for different inputs", async () => {
  const runKey = await generateOperationKey("run-1", "file_read", {
    path: "/test",
  });
  const otherRunKey = await generateOperationKey("run-2", "file_read", {
    path: "/test",
  });
  const otherToolKey = await generateOperationKey("run-1", "file_write", {
    path: "/test",
  });
  const otherArgsKey = await generateOperationKey("run-1", "file_read", {
    path: "/other",
  });

  assertNotEquals(runKey, otherRunKey);
  assertNotEquals(runKey, otherToolKey);
  assertNotEquals(runKey, otherArgsKey);
});

Deno.test("idempotency - generateOperationKey - ignores object key ordering", async () => {
  const key1 = await generateOperationKey("run-1", "tool", { a: 1, b: 2 });
  const key2 = await generateOperationKey("run-1", "tool", { b: 2, a: 1 });
  assertEquals(key1, key2);
  assert(/^[0-9a-f]{32}$/.test(key1));
});

Deno.test("idempotency - checkIdempotency - inserts a pending operation when none exists", async () => {
  const { db, queries } = createFakeDb({
    selectResults: [null],
    runResults: [{ meta: { changes: 1 } }],
  });

  const result = await checkIdempotency(db, "run-1", "tool", {});

  assertEquals(result.action, "execute");
  assert(typeof result.operationId === "string");
  assert(queries.some((query) => query.sql.includes('select "id"')));
  assert(
    queries.some((query) =>
      query.sql.includes("INSERT OR IGNORE INTO tool_operations")
    ),
  );
});

Deno.test("idempotency - checkIdempotency - returns cached output for completed operations", async () => {
  const { db } = createFakeDb({
    selectResults: [
      createToolOperation({
        status: "completed",
        resultOutput: "cached result",
        resultError: null,
      }),
    ],
  });

  const result = await checkIdempotency(db, "run-1", "tool", {});

  assertEquals(result, {
    action: "cached",
    cachedOutput: "cached result",
    cachedError: undefined,
  });
});

Deno.test("idempotency - checkIdempotency - returns cached error for failed completed output", async () => {
  const { db } = createFakeDb({
    selectResults: [
      createToolOperation({
        status: "completed",
        resultOutput: "some output",
        resultError: "some error",
      }),
    ],
  });

  const result = await checkIdempotency(db, "run-1", "tool", {});

  assertEquals(result.action, "cached");
  assertEquals(result.cachedOutput, "some output");
  assertEquals(result.cachedError, "some error");
});

Deno.test("idempotency - checkIdempotency - returns in_progress for fresh pending operations", async () => {
  const { db } = createFakeDb({
    selectResults: [createToolOperation({ status: "pending" })],
  });

  const result = await checkIdempotency(db, "run-1", "tool", {});

  assertEquals(result, { action: "in_progress" });
});

Deno.test("idempotency - checkIdempotency - deletes stale pending operations before re-executing", async () => {
  const staleCreatedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const { db, queries } = createFakeDb({
    selectResults: [
      createToolOperation({ status: "pending", createdAt: staleCreatedAt }),
    ],
    runResults: [{ meta: { changes: 1 } }, { meta: { changes: 1 } }],
  });

  const result = await checkIdempotency(db, "run-1", "tool", {});

  assertEquals(result.action, "execute");
  assert(
    queries.some((query) =>
      query.sql.startsWith('delete from "tool_operations"')
    ),
  );
  assert(
    queries.some((query) =>
      query.sql.includes("INSERT OR IGNORE INTO tool_operations")
    ),
  );
});

Deno.test("idempotency - checkIdempotency - deletes failed operations before re-executing", async () => {
  const { db, queries } = createFakeDb({
    selectResults: [createToolOperation({ status: "failed" })],
    runResults: [{ meta: { changes: 1 } }, { meta: { changes: 1 } }],
  });

  const result = await checkIdempotency(db, "run-1", "tool", {});

  assertEquals(result.action, "execute");
  assert(
    queries.some((query) =>
      query.sql.startsWith('delete from "tool_operations"')
    ),
  );
});

Deno.test("idempotency - checkIdempotency - returns in_progress on insert race with pending operation", async () => {
  const { db } = createFakeDb({
    selectResults: [
      null,
      createToolOperation({ status: "pending" }),
    ],
    runResults: [{ meta: { changes: 0 } }],
  });

  const result = await checkIdempotency(db, "run-1", "tool", {});

  assertEquals(result, { action: "in_progress" });
});

Deno.test("idempotency - checkIdempotency - returns cached on insert race when other worker already completed", async () => {
  const { db } = createFakeDb({
    selectResults: [
      null,
      createToolOperation({
        status: "completed",
        resultOutput: "race result",
        resultError: null,
      }),
    ],
    runResults: [{ meta: { changes: 0 } }],
  });

  const result = await checkIdempotency(db, "run-1", "tool", {});

  assertEquals(result, {
    action: "cached",
    cachedOutput: "race result",
    cachedError: undefined,
  });
});

Deno.test("idempotency - completeOperation - marks a successful operation as completed", async () => {
  const { db, queries } = createFakeDb({
    runResults: [{ meta: { changes: 1 } }],
  });

  await completeOperation(db, "op-1", "done");

  const updateQuery = queries.find((query) =>
    query.sql.startsWith('update "tool_operations"')
  );
  assert(updateQuery);
  assertEquals(updateQuery.args[0], "completed");
  assertEquals(updateQuery.args[1], "done");
  assertEquals(updateQuery.args[2], null);
  assert(typeof updateQuery.args[3] === "string");
  assertEquals(updateQuery.args[4], "op-1");
});

Deno.test("idempotency - completeOperation - marks a failed operation with an error", async () => {
  const { db, queries } = createFakeDb({
    runResults: [{ meta: { changes: 1 } }],
  });

  await completeOperation(db, "op-1", "output", "error message");

  const updateQuery = queries.find((query) =>
    query.sql.startsWith('update "tool_operations"')
  );
  assert(updateQuery);
  assertEquals(updateQuery.args[0], "failed");
  assertEquals(updateQuery.args[1], "output");
  assertEquals(updateQuery.args[2], "error message");
  assert(typeof updateQuery.args[3] === "string");
  assertEquals(updateQuery.args[4], "op-1");
});

Deno.test("idempotency - cleanupStaleOperations - deletes rows older than 24 hours", async () => {
  const fixedNow = Date.UTC(2026, 0, 10, 12, 0, 0);
  const { db, queries } = createFakeDb({
    runResults: [{ meta: { changes: 5 } }],
  });
  const nowStub = stub(Date, "now", () => fixedNow);

  try {
    const result = await cleanupStaleOperations(db);

    assertEquals(result, 5);
    const deleteQuery = queries.find((query) =>
      query.sql.startsWith('delete from "tool_operations"')
    );
    assert(deleteQuery);
    assertEquals(
      deleteQuery.args[0],
      new Date(fixedNow - 24 * 60 * 60 * 1000).toISOString(),
    );
  } finally {
    nowStub.restore();
  }
});

Deno.test("idempotency - cleanupStaleOperations - returns zero when nothing is deleted", async () => {
  const { db } = createFakeDb({
    runResults: [{ meta: { changes: 0 } }],
  });

  const result = await cleanupStaleOperations(db);

  assertEquals(result, 0);
});
