import { test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { assertEquals, assertStringIncludes } from "@takos/test/assert";
import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
} from "../../../../shared/types/bindings.ts";
import {
  createPreparedStatement,
  createSequentialBatch,
} from "../../../../local-platform/d1-prepared-statement.ts";
import {
  dispatchTerminalIndexOutbox,
  terminalIndexJobId,
} from "../index-outbox.ts";

async function createIndexOutboxDatabase(): Promise<{
  client: Client;
  db: SqlDatabaseBinding;
}> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE index_jobs (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      type TEXT NOT NULL,
      target_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      total_files INTEGER NOT NULL DEFAULT 0,
      processed_files INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      claim_token TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const runStatement = (statement: SqlPreparedStatementBinding) =>
    statement.run<Record<string, unknown>>();
  return {
    client,
    db: {
      prepare(queryText: string) {
        return createPreparedStatement(client, queryText);
      },
      batch: createSequentialBatch(runStatement),
    } as SqlDatabaseBinding,
  };
}

async function insertJob(
  client: Client,
  input: {
    id: string;
    type: string;
    targetId: string;
    status: string;
    startedAt?: string | null;
  },
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO index_jobs
      (id, account_id, type, target_id, status, started_at, created_at)
      VALUES (?, 'account-1', ?, ?, ?, ?, '2026-07-11T00:00:00.000Z')`,
    args: [
      input.id,
      input.type,
      input.targetId,
      input.status,
      input.startedAt ?? null,
    ],
  });
}

test("cron dispatch CAS sends queued and stale enqueued terminal jobs only", async () => {
  const { client, db } = await createIndexOutboxDatabase();
  try {
    await insertJob(client, {
      id: "queued-info",
      type: "info_unit",
      targetId: "run-1",
      status: "queued",
    });
    await insertJob(client, {
      id: "stale-thread",
      type: "thread_context",
      targetId: "thread-1",
      status: "enqueued",
      startedAt: "2026-07-10T00:00:00.000Z",
    });
    await insertJob(client, {
      id: "fresh-thread",
      type: "thread_context",
      targetId: "thread-2",
      status: "enqueued",
      startedAt: "2099-01-01T00:00:00.000Z",
    });
    await insertJob(client, {
      id: "manual-full",
      type: "full",
      targetId: "file-1",
      status: "queued",
    });

    const messages: Array<Record<string, unknown>> = [];
    const sent = await dispatchTerminalIndexOutbox(
      {
        DB: db,
        INDEX_QUEUE: {
          async send(message) {
            messages.push(message as unknown as Record<string, unknown>);
          },
        },
      },
      { staleBefore: "2026-07-11T00:00:00.000Z" },
    );

    assertEquals(sent, 2);
    assertEquals(messages.map((message) => message.jobId).sort(), [
      "queued-info",
      "stale-thread",
    ]);
    const rows = await client.execute(
      "SELECT id, status, started_at, claim_token FROM index_jobs ORDER BY id",
    );
    const byId = Object.fromEntries(rows.rows.map((row) => [row.id, row]));
    assertEquals(
      messages.every(
        (message) =>
          typeof message.deliveryId === "string" &&
          byId[String(message.jobId)].claim_token === message.deliveryId,
      ),
      true,
    );
    assertEquals(byId["queued-info"].status, "enqueued");
    assertEquals(byId["stale-thread"].status, "enqueued");
    assertEquals(byId["fresh-thread"].started_at, "2099-01-01T00:00:00.000Z");
    assertEquals(byId["manual-full"].status, "queued");
  } finally {
    client.close();
  }
});

test("a definite queue failure reverts only the exact enqueued claim", async () => {
  const { client, db } = await createIndexOutboxDatabase();
  try {
    await insertJob(client, {
      id: "send-failure",
      type: "info_unit",
      targetId: "run-failure",
      status: "queued",
    });
    const sent = await dispatchTerminalIndexOutbox({
      DB: db,
      INDEX_QUEUE: {
        async send() {
          throw new Error("index queue unavailable");
        },
      },
    });

    assertEquals(sent, 0);
    const row = await client.execute({
      sql: "SELECT status, claim_token, started_at, error FROM index_jobs WHERE id = ?",
      args: ["send-failure"],
    });
    assertEquals(row.rows[0].status, "queued");
    assertEquals(row.rows[0].claim_token, null);
    assertEquals(row.rows[0].started_at, null);
    assertStringIncludes(String(row.rows[0].error), "index queue unavailable");
  } finally {
    client.close();
  }
});

test("an immediate flush is restricted to its deterministic completion ids", async () => {
  const { client, db } = await createIndexOutboxDatabase();
  try {
    const completionKey = "agent-complete:one";
    const otherKey = "agent-complete:two";
    for (const [key, suffix] of [
      [completionKey, "one"],
      [otherKey, "two"],
    ]) {
      await insertJob(client, {
        id: terminalIndexJobId(key, "info_unit"),
        type: "info_unit",
        targetId: `run-${suffix}`,
        status: "queued",
      });
      await insertJob(client, {
        id: terminalIndexJobId(key, "thread_context"),
        type: "thread_context",
        targetId: `thread-${suffix}`,
        status: "queued",
      });
    }
    const messages: Array<{ jobId: string }> = [];
    const sent = await dispatchTerminalIndexOutbox(
      {
        DB: db,
        INDEX_QUEUE: {
          async send(message) {
            messages.push({ jobId: message.jobId });
          },
        },
      },
      { completionKey },
    );

    assertEquals(sent, 2);
    assertEquals(
      messages.map((message) => message.jobId).sort(),
      [
        terminalIndexJobId(completionKey, "info_unit"),
        terminalIndexJobId(completionKey, "thread_context"),
      ].sort(),
    );
    const other = await client.execute({
      sql: "SELECT status FROM index_jobs WHERE id = ?",
      args: [terminalIndexJobId(otherKey, "info_unit")],
    });
    assertEquals(other.rows[0].status, "queued");
  } finally {
    client.close();
  }
});
