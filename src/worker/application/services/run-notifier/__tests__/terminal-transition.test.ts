import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import type {
  SqlPreparedStatementBinding,
  SqlResultBinding,
} from "../../../../shared/types/bindings.ts";
import { transitionRunTerminalAtomically } from "../terminal-transition.ts";

type CapturedStatement = SqlPreparedStatementBinding & {
  queryText: string;
  boundValues: unknown[];
};

function result(
  changes: number,
  rows: Record<string, unknown>[] = [],
): SqlResultBinding<Record<string, unknown>> {
  return {
    results: rows,
    success: true,
    meta: {
      changed_db: changes > 0,
      changes,
      duration: 0,
      last_row_id: 0,
      rows_read: rows.length,
      rows_written: changes,
      size_after: 0,
    },
  };
}

function statement(
  queryText: string,
  boundValues: unknown[] = [],
  firstRow: Record<string, unknown> | null = { engineCheckpoint: null },
): CapturedStatement {
  return {
    queryText,
    boundValues,
    bind(...values: unknown[]) {
      return statement(queryText, values, firstRow);
    },
    first: async () => firstRow,
    run: async () => result(0),
    all: async () => result(0),
    raw: async () => [],
  } as unknown as CapturedStatement;
}

const cancellation = {
  runId: "run-1",
  status: "cancelled" as const,
  expectedStatuses: ["queued" as const],
  completedAt: "2026-07-11T00:00:00.000Z",
  error: null,
  eventType: "cancelled",
  terminalEvent: { status: "cancelled", run: { id: "run-1" } },
};

test("D1 commits the control-owned terminal status and event in one batch", async () => {
  let captured: CapturedStatement[] = [];
  const db = {
    prepare(queryText: string) {
      return statement(queryText);
    },
    async batch(statements: CapturedStatement[]) {
      captured = statements;
      return statements.map((_statement, index) =>
        index === 0
          ? result(1)
          : index === statements.length - 1
            ? result(1, [{ id: 8 }])
            : result(1),
      );
    },
  };

  const transition = await transitionRunTerminalAtomically(
    db as never,
    cancellation,
  );
  assertEquals(transition.committed, true);
  assertEquals(transition.eventId, 8);
  assertEquals(captured.length, 4);
  assertEquals(captured[0].queryText.includes('UPDATE "runs"'), true);
  assertEquals(
    captured[1].queryText.includes('INSERT INTO "index_jobs"'),
    true,
  );
  assertEquals(captured[1].boundValues.includes("info_unit"), true);
  assertEquals(captured[2].boundValues.includes("thread_context"), true);
  assertEquals(
    captured[3].queryText.includes('INSERT INTO "run_events"'),
    true,
  );
  assertEquals(captured[3].queryText.includes('r."completion_key" = ?'), true);
});

test("Postgres uses one dedicated transaction for the terminal transition", async () => {
  let transactionCalls = 0;
  let outerBatchCalls = 0;
  const tx = {
    prepare(queryText: string) {
      return statement(queryText);
    },
    async batch() {
      return [result(1), result(1), result(1), result(1, [{ id: 9 }])];
    },
  };
  const db = {
    prepare(queryText: string) {
      return statement(queryText);
    },
    async batch() {
      outerBatchCalls++;
      return [];
    },
    async withTransaction(callback: (session: typeof tx) => Promise<unknown>) {
      transactionCalls++;
      return await callback(tx);
    },
  };

  const transition = await transitionRunTerminalAtomically(
    db as never,
    cancellation,
  );
  assertEquals(transition.committed, true);
  assertEquals(transactionCalls, 1);
  assertEquals(outerBatchCalls, 0);
});

test("a lost active-status CAS cannot insert an orphan terminal event", async () => {
  let captured: CapturedStatement[] = [];
  const db = {
    prepare(queryText: string) {
      return statement(queryText);
    },
    async batch(statements: CapturedStatement[]) {
      captured = statements;
      return [result(0), result(0)];
    },
  };

  const transition = await transitionRunTerminalAtomically(
    db as never,
    cancellation,
  );
  assertEquals(transition.committed, false);
  assertEquals(transition.eventId, null);
  assertEquals(
    captured[1].boundValues.includes(transition.completionKey),
    true,
  );
});

test("a committed cancellation deletes only its captured R2 checkpoint", async () => {
  const deleted: string[] = [];
  const db = {
    prepare(queryText: string) {
      return statement(queryText, [], {
        engineCheckpoint:
          "r2:agent-checkpoints/run-1/service-1/7/generation.json",
      });
    },
    async batch(statements: CapturedStatement[]) {
      return statements.map((_statement, index) =>
        index === 0
          ? result(1)
          : index === statements.length - 1
            ? result(1, [{ id: 10 }])
            : result(1),
      );
    },
  };
  const transition = await transitionRunTerminalAtomically(
    db as never,
    cancellation,
    {
      offloadBucket: {
        delete: async (key: string | string[]) => {
          deleted.push(...(Array.isArray(key) ? key : [key]));
        },
      } as never,
    },
  );

  assertEquals(transition.committed, true);
  assertEquals(deleted, [
    "agent-checkpoints/run-1/service-1/7/generation.json",
  ]);
});

test("a lost terminal checkpoint CAS preserves the referenced R2 object", async () => {
  const deleted: string[] = [];
  const db = {
    prepare(queryText: string) {
      return statement(queryText, [], {
        engineCheckpoint:
          "r2:agent-checkpoints/run-1/service-1/7/generation.json",
      });
    },
    async batch() {
      return [result(0), result(0), result(0), result(0)];
    },
  };
  const transition = await transitionRunTerminalAtomically(
    db as never,
    cancellation,
    {
      offloadBucket: {
        delete: async (key: string | string[]) => {
          deleted.push(...(Array.isArray(key) ? key : [key]));
        },
      } as never,
    },
  );

  assertEquals(transition.committed, false);
  assertEquals(deleted, []);
});
