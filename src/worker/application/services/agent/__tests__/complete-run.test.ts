import { test } from "bun:test";
import { assertEquals, assertFalse } from "@takos/test/assert";
import { createClient } from "@libsql/client";
import type {
  SqlPreparedStatementBinding,
  SqlResultBinding,
} from "../../../../shared/types/bindings.ts";
import {
  completeRunAtomically,
  completeRunKey,
  type CompleteRunInput,
} from "../complete-run.ts";
import {
  createPreparedStatement,
  createSequentialBatch,
} from "../../../../local-platform/d1-prepared-statement.ts";

type CapturedStatement = SqlPreparedStatementBinding & {
  queryText: string;
  boundValues: unknown[];
};

function sqlResult(
  changes: number,
  results: Record<string, unknown>[] = [],
): SqlResultBinding<Record<string, unknown>> {
  return {
    results,
    success: true,
    meta: {
      changed_db: changes > 0,
      changes,
      duration: 0,
      last_row_id: 0,
      rows_read: results.length,
      rows_written: changes,
      size_after: 0,
    },
  };
}

function capturedStatement(
  queryText: string,
  boundValues: unknown[] = [],
): CapturedStatement {
  const statement = {
    queryText,
    boundValues,
    bind(...values: unknown[]) {
      return capturedStatement(queryText, values);
    },
    first: async () => null,
    run: async () => sqlResult(0),
    all: async () => sqlResult(0),
    raw: async () => [],
  };
  return statement as unknown as CapturedStatement;
}

function completeInput(
  overrides: Partial<CompleteRunInput> = {},
): CompleteRunInput {
  return {
    runId: "run-1",
    threadId: "thread-1",
    serviceId: "service-1",
    leaseVersion: 7,
    status: "completed",
    usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 },
    output: "done",
    messages: [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          { id: "call-1", name: "read", arguments: { path: "README.md" } },
        ],
      },
      {
        role: "tool",
        content: "contents",
        tool_call_id: "call-1",
      },
      { role: "assistant", content: "done" },
    ],
    terminalEvent: {
      status: "completed",
      run: { id: "run-1", session_id: "session-1" },
      output: "done",
    },
    ...overrides,
  };
}

test("completion key binds the canonical full transcript and terminal payload", async () => {
  const first = completeInput();
  const reordered = completeInput({
    terminalEvent: {
      output: "done",
      run: { session_id: "session-1", id: "run-1" },
      status: "completed",
    },
  });
  assertEquals(await completeRunKey(first), await completeRunKey(reordered));
  assertFalse(
    (await completeRunKey(first)) ===
      (await completeRunKey(
        completeInput({
          messages: [{ role: "assistant", content: "different" }],
        }),
      )),
  );
  assertFalse(
    (await completeRunKey(first)) ===
      (await completeRunKey(
        completeInput({
          terminalEvent: { ...first.terminalEvent, output: "different" },
        }),
      )),
  );
  assertEquals((await completeRunKey(first)).length, 79);
});

test("D1 path commits run, chunked transcript, and event in one bounded batch", async () => {
  let captured: CapturedStatement[] = [];
  const db = {
    prepare(queryText: string) {
      return capturedStatement(queryText);
    },
    async batch(statements: CapturedStatement[]) {
      captured = statements;
      return statements.map((_statement, index) =>
        index === 0
          ? sqlResult(1)
          : index === statements.length - 1
            ? sqlResult(1, [{ id: 44 }])
            : sqlResult(1),
      );
    },
  };
  const result = await completeRunAtomically(db as never, completeInput());

  assertEquals(result.committed, true);
  assertEquals(result.eventId, 44);
  assertEquals(captured.length, 7);
  assertEquals(captured[0].queryText.includes('UPDATE "runs"'), true);
  assertEquals(captured[1].queryText.includes('UPDATE "threads"'), true);
  assertEquals(
    captured[2].queryText.includes('"transcript_sequence_start"'),
    true,
  );
  assertEquals(captured[3].queryText.includes("WITH pending"), true);
  assertEquals(captured[3].queryText.includes('ON CONFLICT ("id")'), true);
  assertEquals(
    captured[4].queryText.includes('INSERT INTO "index_jobs"'),
    true,
  );
  assertEquals(captured[4].boundValues.includes("info_unit"), true);
  assertEquals(captured[5].boundValues.includes("thread_context"), true);
  assertEquals(
    captured[6].queryText.includes('INSERT INTO "run_events"'),
    true,
  );
  assertEquals(
    captured[6].boundValues.some(
      (value) =>
        typeof value === "string" &&
        value.includes(`completion:${result.completionKey}:terminal-status`),
    ),
    true,
  );
});

test("Postgres path uses the dedicated transaction and never outer sequential batch", async () => {
  let transactionCalls = 0;
  let outerBatchCalls = 0;
  let transactionStatementCount = 0;
  let transcriptInsertSql = "";
  const tx = {
    prepare(queryText: string) {
      if (queryText.includes("WITH pending")) transcriptInsertSql = queryText;
      return capturedStatement(queryText);
    },
    async batch(statements: CapturedStatement[]) {
      transactionStatementCount = statements.length;
      return statements.map((_statement, index) =>
        index === 0
          ? sqlResult(1)
          : sqlResult(1, index === statements.length - 1 ? [{ id: 9 }] : []),
      );
    },
  };
  const db = {
    prepare(queryText: string) {
      return capturedStatement(queryText);
    },
    async batch() {
      outerBatchCalls++;
      return [];
    },
    async withTransaction(
      callback: (transaction: typeof tx) => Promise<unknown>,
    ) {
      transactionCalls++;
      return await callback(tx);
    },
  };

  const result = await completeRunAtomically(db as never, completeInput());
  assertEquals(result.committed, true);
  assertEquals(transactionCalls, 1);
  assertEquals(outerBatchCalls, 0);
  assertEquals(transactionStatementCount, 7);
  assertEquals(
    transcriptInsertSql.includes('CAST(p."ord" AS INTEGER)'),
    true,
  );
});

test("cancel winner leaves completion uncommitted and cannot persist orphan transcript", async () => {
  let captured: CapturedStatement[] = [];
  const db = {
    prepare(queryText: string) {
      return capturedStatement(queryText);
    },
    async batch(statements: CapturedStatement[]) {
      captured = statements;
      return statements.map(() => sqlResult(0));
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                get: async () => ({
                  status: "cancelled",
                  usage: "{}",
                  output: null,
                  error: null,
                  serviceId: "service-1",
                  leaseVersion: 7,
                  completionKey: "user-cancel",
                }),
              };
            },
          };
        },
      };
    },
    insert() {},
    update() {},
    delete() {},
  };

  const result = await completeRunAtomically(db as never, completeInput());
  assertEquals(result.committed, false);
  assertEquals(result.leaseLost, true);
  // Every non-CAS statement selects through the completion key written only by
  // the winning UPDATE. With update=0, cancel's different key yields 0 inserts.
  for (const statement of captured.slice(1)) {
    assertEquals(statement.queryText.includes('"completion_key" = ?'), true);
  }
});

test("same lease with a different transcript is not treated as idempotent", async () => {
  const original = completeInput();
  const originalKey = await completeRunKey(original);
  const changed = completeInput({
    messages: [{ role: "assistant", content: "changed after retry" }],
  });
  const db = {
    prepare(queryText: string) {
      return capturedStatement(queryText);
    },
    async batch(statements: CapturedStatement[]) {
      return statements.map(() => sqlResult(0));
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                get: async () => ({
                  status: original.status,
                  usage: JSON.stringify(original.usage),
                  output: original.output,
                  error: null,
                  serviceId: original.serviceId,
                  leaseVersion: original.leaseVersion,
                  completionKey: originalKey,
                }),
              };
            },
          };
        },
      };
    },
    insert() {},
    update() {},
    delete() {},
  };
  const result = await completeRunAtomically(db as never, changed);
  assertEquals(result.committed, false);
  assertEquals(result.idempotent, false);
  assertEquals(result.leaseLost, true);
});

test("maximum transcript stays below D1 query and parameter limits", async () => {
  let captured: CapturedStatement[] = [];
  const messages = Array.from({ length: 256 }, (_, index) => ({
    role: "assistant" as const,
    content: `message-${index}`,
  }));
  const db = {
    prepare(queryText: string) {
      return capturedStatement(queryText);
    },
    async batch(statements: CapturedStatement[]) {
      captured = statements;
      return statements.map((_statement, index) =>
        index === 0 ? sqlResult(1) : sqlResult(1),
      );
    },
  };
  await completeRunAtomically(db as never, completeInput({ messages }));
  assertEquals(captured.length <= 50, true);
  for (const statement of captured) {
    assertEquals((statement.queryText.match(/\?/gu) ?? []).length <= 100, true);
  }
});

test("large tool results are staged in TAKOS_OFFLOAD before the atomic SQL batch", async () => {
  const largeResult = "x".repeat(3 * 1024 * 1024);
  let captured: CapturedStatement[] = [];
  let objectKey = "";
  let objectPayload = "";
  let batchCalls = 0;
  const bucket = {
    async head() {
      return null;
    },
    async put(key: string, value: string) {
      objectKey = key;
      objectPayload = value;
      return null;
    },
    async delete() {},
  };
  const db = {
    prepare(queryText: string) {
      return capturedStatement(queryText);
    },
    async batch(statements: CapturedStatement[]) {
      batchCalls++;
      captured = statements;
      return statements.map((_statement, index) =>
        index === 0
          ? sqlResult(1)
          : index === statements.length - 1
            ? sqlResult(1, [{ id: 77 }])
            : sqlResult(1),
      );
    },
  };

  const result = await completeRunAtomically(
    db as never,
    completeInput({
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "large-1", name: "read", arguments: {} }],
        },
        { role: "tool", content: largeResult, tool_call_id: "large-1" },
        { role: "assistant", content: "done" },
      ],
    }),
    { offloadBucket: bucket as never },
  );

  assertEquals(result.committed, true);
  assertEquals(batchCalls, 1);
  assertEquals(
    objectKey.startsWith("threads/thread-1/messages/msg_terminal_"),
    true,
  );
  assertEquals(JSON.parse(objectPayload).content.length, largeResult.length);
  assertEquals(
    captured.some((statement) =>
      statement.boundValues.some((value) => value === largeResult),
    ),
    false,
  );
  assertEquals(
    captured.some((statement) => statement.boundValues.includes(objectKey)),
    true,
  );
});

test("offload failure happens before the run CAS", async () => {
  let batchCalls = 0;
  const db = {
    prepare(queryText: string) {
      return capturedStatement(queryText);
    },
    async batch() {
      batchCalls++;
      return [];
    },
  };
  const bucket = {
    async head() {
      return null;
    },
    async put() {
      throw new Error("R2 unavailable");
    },
    async delete() {},
  };

  let failure = "";
  try {
    await completeRunAtomically(
      db as never,
      completeInput({
        messages: [{ role: "tool", content: "large", tool_call_id: "call-1" }],
      }),
      { offloadBucket: bucket as never },
    );
  } catch (error) {
    failure = String(error);
  }
  assertEquals(failure.includes("R2 unavailable"), true);
  assertEquals(batchCalls, 0);
});

test("an idempotent retry never deletes an already committed R2 object after DB failure", async () => {
  let putCalls = 0;
  let deleteCalls = 0;
  const bucket = {
    async head(key: string) {
      return { key };
    },
    async put() {
      putCalls++;
      return null;
    },
    async delete() {
      deleteCalls++;
    },
  };
  const db = {
    prepare(queryText: string) {
      return capturedStatement(queryText);
    },
    async batch() {
      throw new Error("commit result unavailable");
    },
  };

  let failure = "";
  try {
    await completeRunAtomically(
      db as never,
      completeInput({
        messages: [
          { role: "tool", content: "persisted", tool_call_id: "call-1" },
        ],
      }),
      { offloadBucket: bucket as never },
    );
  } catch (error) {
    failure = String(error);
  }
  assertEquals(failure.includes("commit result unavailable"), true);
  assertEquals(putCalls, 0);
  assertEquals(deleteCalls, 0);
});

test("a concurrent identical completion loser never deletes the winner's R2 object", async () => {
  const input = completeInput({
    messages: [
      { role: "tool", content: "shared result", tool_call_id: "call-1" },
    ],
  });
  const completionKey = await completeRunKey(input);
  let deleteCalls = 0;
  const bucket = {
    async head() {
      return null;
    },
    async put() {
      return null;
    },
    async delete() {
      deleteCalls++;
    },
  };
  const db = {
    prepare(queryText: string) {
      return capturedStatement(queryText);
    },
    async batch(statements: CapturedStatement[]) {
      return statements.map(() => sqlResult(0));
    },
    select(fields: Record<string, unknown>) {
      return {
        from() {
          return {
            where() {
              return {
                get: async () =>
                  "completionKey" in fields
                    ? {
                        status: input.status,
                        usage: JSON.stringify(input.usage),
                        output: input.output,
                        error: null,
                        serviceId: input.serviceId,
                        leaseVersion: input.leaseVersion,
                        completionKey,
                      }
                    : { id: 91 },
              };
            },
          };
        },
      };
    },
    insert() {},
    update() {},
    delete() {},
  };

  const result = await completeRunAtomically(db as never, input, {
    offloadBucket: bucket as never,
  });
  assertEquals(result.committed, true);
  assertEquals(result.idempotent, true);
  assertEquals(result.eventId, 91);
  assertEquals(deleteCalls, 0);
});

test("D1-compatible SQLite executes the atomic transcript SQL shape", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        status TEXT NOT NULL,
        usage TEXT NOT NULL DEFAULT '{}',
        output TEXT,
        error TEXT,
        service_id TEXT,
        lease_version INTEGER NOT NULL DEFAULT 0,
        completion_key TEXT,
        transcript_sequence_start INTEGER,
        engine_checkpoint TEXT,
        engine_checkpoint_updated_at TEXT,
        completed_at TEXT
      );
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        next_message_sequence INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        r2_key TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        sequence INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE run_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        type TEXT NOT NULL,
        event_key TEXT UNIQUE,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE index_jobs (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        type TEXT NOT NULL,
        target_id TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        total_files INTEGER NOT NULL DEFAULT 0,
        processed_files INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL
      );
    `);
    await client.execute({
      sql: "INSERT INTO threads (id, next_message_sequence) VALUES (?, 0)",
      args: ["thread-1"],
    });
    await client.execute({
      sql: "INSERT INTO runs (id, account_id, thread_id, status, service_id, lease_version, engine_checkpoint, engine_checkpoint_updated_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)",
      args: [
        "run-1",
        "account-1",
        "thread-1",
        "service-1",
        7,
        "{\"status\":\"running\"}",
        "2026-07-11T00:00:00.000Z",
      ],
    });
    const runStatement = (statement: SqlPreparedStatementBinding) =>
      statement.run<Record<string, unknown>>();
    const db = {
      prepare(queryText: string) {
        return createPreparedStatement(client, queryText);
      },
      batch: createSequentialBatch(runStatement),
    };

    const result = await completeRunAtomically(db as never, completeInput());
    assertEquals(result.committed, true);
    const run = await client.execute({
      sql: "SELECT status, output, completion_key, engine_checkpoint, engine_checkpoint_updated_at FROM runs WHERE id = ?",
      args: ["run-1"],
    });
    assertEquals(run.rows[0].status, "completed");
    assertEquals(run.rows[0].output, "done");
    assertEquals(run.rows[0].completion_key, result.completionKey);
    assertEquals(run.rows[0].engine_checkpoint, null);
    assertEquals(run.rows[0].engine_checkpoint_updated_at, null);
    const transcript = await client.execute(
      "SELECT role, content, tool_calls, tool_call_id FROM messages ORDER BY sequence",
    );
    assertEquals(transcript.rows.length, 3);
    assertEquals(transcript.rows[0].role, "assistant");
    assertEquals(JSON.parse(String(transcript.rows[0].tool_calls))[0], {
      id: "call-1",
      name: "read",
      arguments: { path: "README.md" },
    });
    assertEquals(transcript.rows[1].tool_call_id, "call-1");
    const events = await client.execute(
      "SELECT type, event_key FROM run_events",
    );
    assertEquals(events.rows.length, 1);
    assertEquals(events.rows[0].type, "completed");
    const indexOutbox = await client.execute(
      "SELECT id, account_id, type, target_id, status FROM index_jobs ORDER BY type",
    );
    assertEquals(indexOutbox.rows.length, 2);
    assertEquals(
      indexOutbox.rows.map((row) => row.type),
      ["info_unit", "thread_context"],
    );
    assertEquals(indexOutbox.rows[0].account_id, "account-1");
    assertEquals(indexOutbox.rows[0].target_id, "run-1");
    assertEquals(indexOutbox.rows[1].target_id, "thread-1");
    assertEquals(
      indexOutbox.rows.every((row) => row.status === "queued"),
      true,
    );
    const retry = await completeRunAtomically(db as never, completeInput());
    assertEquals(retry.committed, true);
    assertEquals(retry.idempotent, true);
    const reservation = await client.execute(
      "SELECT next_message_sequence FROM threads WHERE id = 'thread-1'",
    );
    assertEquals(reservation.rows[0].next_message_sequence, 3);
    const retryTranscript = await client.execute(
      "SELECT COUNT(*) AS count FROM messages WHERE thread_id = 'thread-1'",
    );
    assertEquals(Number(retryTranscript.rows[0].count), 3);
  } finally {
    client.close();
  }
});
