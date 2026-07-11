import { test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { assertEquals } from "@takos/test/assert";
import type {
  MessageQueueMessage,
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
} from "../../../shared/types/bindings.ts";
import {
  INDEX_QUEUE_MESSAGE_VERSION,
  indexJobDeliveryId,
  isValidIndexJobQueueMessage,
  type IndexJobQueueMessage,
} from "../../../shared/types/index.ts";
import {
  createPreparedStatement,
  createSequentialBatch,
} from "../../../local-platform/d1-prepared-statement.ts";
import indexer, { indexerHandlerDeps } from "../index.ts";
import { handleIndexJobDlq } from "../handlers.ts";

async function createIndexDatabase(): Promise<{
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
    CREATE TABLE dlq_entries (
      id TEXT PRIMARY KEY,
      queue TEXT NOT NULL,
      message_body TEXT,
      error TEXT,
      retry_count INTEGER,
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

function infoUnitBody(
  jobId: string,
  deliveryId = indexJobDeliveryId(jobId),
): IndexJobQueueMessage {
  return {
    version: INDEX_QUEUE_MESSAGE_VERSION,
    jobId,
    deliveryId,
    spaceId: "account-1",
    type: "info_unit",
    targetId: "run-1",
    timestamp: Date.now(),
  };
}

function queueMessage(
  id: string,
  body: IndexJobQueueMessage,
  attempts = 1,
): MessageQueueMessage<IndexJobQueueMessage> & {
  acks: number;
  retries: number;
  retryDelays: number[];
} {
  return {
    id,
    timestamp: new Date(),
    attempts,
    body,
    acks: 0,
    retries: 0,
    retryDelays: [],
    ack() {
      this.acks++;
    },
    retry(options) {
      this.retries++;
      if (options?.delaySeconds !== undefined) {
        this.retryDelays.push(options.delaySeconds);
      }
    },
  };
}

async function runMessage(
  db: SqlDatabaseBinding,
  message: MessageQueueMessage<IndexJobQueueMessage>,
): Promise<void> {
  await indexer.queue({ queue: "takos-index-jobs", messages: [message] }, {
    DB: db,
  } as never);
}

test("index queue validates portable delivery ids with one-release legacy fallback", () => {
  const current = infoUnitBody("job-guard");
  assertEquals(isValidIndexJobQueueMessage(current), true);
  assertEquals(
    isValidIndexJobQueueMessage({ ...current, deliveryId: "" }),
    false,
  );
  const { deliveryId: _deliveryId, ...legacy } = current;
  assertEquals(isValidIndexJobQueueMessage(legacy), true);
});

test("different delivery ids cannot execute one running index job concurrently", async () => {
  const { client, db } = await createIndexDatabase();
  const original = indexerHandlerDeps.handleInfoUnit;
  let calls = 0;
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  indexerHandlerDeps.handleInfoUnit = async () => {
    calls++;
    markStarted();
    await blocked;
    return { processed: true };
  };
  try {
    const ownerBody = infoUnitBody("job-concurrent", "logical-owner");
    const duplicateBody = infoUnitBody("job-concurrent", "logical-duplicate");
    const owner = queueMessage("transport-owner", ownerBody);
    const duplicate = queueMessage("transport-duplicate", duplicateBody);
    const ownerRun = runMessage(db, owner);
    await started;
    await runMessage(db, duplicate);

    assertEquals(calls, 1);
    assertEquals(duplicate.acks, 1);
    assertEquals(duplicate.retries, 0);

    release();
    await ownerRun;
    assertEquals(owner.acks, 1);
    const row = await client.execute({
      sql: "SELECT status, claim_token FROM index_jobs WHERE id = ?",
      args: [ownerBody.jobId],
    });
    assertEquals(row.rows[0].status, "completed");
    assertEquals(row.rows[0].claim_token, null);
  } finally {
    indexerHandlerDeps.handleInfoUnit = original;
    client.close();
  }
});

test("the same delivery id duplicate cannot re-enter a fresh running claim", async () => {
  const { client, db } = await createIndexDatabase();
  const original = indexerHandlerDeps.handleInfoUnit;
  let calls = 0;
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  indexerHandlerDeps.handleInfoUnit = async () => {
    calls++;
    markStarted();
    await blocked;
    return { processed: true };
  };
  try {
    const body = infoUnitBody("job-same-delivery", "logical-shared");
    const owner = queueMessage("transport-owner", body);
    const duplicate = queueMessage("transport-duplicate", body);
    const ownerRun = runMessage(db, owner);
    await started;
    await runMessage(db, duplicate);

    assertEquals(calls, 1);
    assertEquals(duplicate.acks, 0);
    assertEquals(duplicate.retries, 1);
    assertEquals(duplicate.retryDelays.length, 1);
    assertEquals(
      duplicate.retryDelays[0] >= 1 && duplicate.retryDelays[0] <= 900,
      true,
    );
    release();
    await ownerRun;
    assertEquals(owner.acks, 1);
  } finally {
    indexerHandlerDeps.handleInfoUnit = original;
    client.close();
  }
});

test("the same stable delivery id reclaims an abandoned stale running claim", async () => {
  const { client, db } = await createIndexDatabase();
  const original = indexerHandlerDeps.handleInfoUnit;
  let calls = 0;
  indexerHandlerDeps.handleInfoUnit = async () => {
    calls++;
    return { processed: true };
  };
  try {
    const body = infoUnitBody("job-resume", "logical-stable");
    await client.execute({
      sql: `INSERT INTO index_jobs
        (id, account_id, type, target_id, status, claim_token, started_at, created_at)
        VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
      args: [
        body.jobId,
        body.spaceId,
        body.type,
        body.targetId ?? null,
        body.deliveryId,
        "2026-07-11T00:00:00.000Z",
        "2026-07-11T00:00:00.000Z",
      ],
    });
    const retry = queueMessage("new-transport-id", body, 2);
    await runMessage(db, retry);

    assertEquals(calls, 1);
    assertEquals(retry.acks, 1);
    assertEquals(retry.retries, 0);
    const row = await client.execute({
      sql: "SELECT status FROM index_jobs WHERE id = ?",
      args: [body.jobId],
    });
    assertEquals(row.rows[0].status, "completed");
  } finally {
    indexerHandlerDeps.handleInfoUnit = original;
    client.close();
  }
});

test("a superseded durable-outbox body cannot overwrite the newer delivery", async () => {
  const { client, db } = await createIndexDatabase();
  const original = indexerHandlerDeps.handleInfoUnit;
  let calls = 0;
  indexerHandlerDeps.handleInfoUnit = async () => {
    calls++;
    return { processed: true };
  };
  try {
    const staleBody = infoUnitBody("job-superseded", "old-delivery");
    await client.execute({
      sql: `INSERT INTO index_jobs
        (id, account_id, type, target_id, status, claim_token, started_at, created_at)
        VALUES (?, ?, ?, ?, 'enqueued', 'new-delivery', ?, ?)`,
      args: [
        staleBody.jobId,
        staleBody.spaceId,
        staleBody.type,
        staleBody.targetId ?? null,
        "2026-07-11T00:00:00.000Z",
        "2026-07-11T00:00:00.000Z",
      ],
    });
    const staleMessage = queueMessage("transport-old", staleBody);
    await runMessage(db, staleMessage);

    assertEquals(calls, 0);
    assertEquals(staleMessage.acks, 1);
    const row = await client.execute({
      sql: "SELECT status, claim_token FROM index_jobs WHERE id = ?",
      args: [staleBody.jobId],
    });
    assertEquals(row.rows[0].status, "enqueued");
    assertEquals(row.rows[0].claim_token, "new-delivery");
  } finally {
    indexerHandlerDeps.handleInfoUnit = original;
    client.close();
  }
});

test("legacy in-flight body falls back to the stable transport message id", async () => {
  const { client, db } = await createIndexDatabase();
  const original = indexerHandlerDeps.handleInfoUnit;
  let calls = 0;
  indexerHandlerDeps.handleInfoUnit = async () => {
    calls++;
    return { processed: true };
  };
  try {
    const current = infoUnitBody("job-legacy");
    const { deliveryId: _deliveryId, ...legacy } = current;
    await client.execute({
      sql: `INSERT INTO index_jobs
        (id, account_id, type, target_id, status, claim_token, started_at, created_at)
        VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
      args: [
        legacy.jobId,
        legacy.spaceId,
        legacy.type,
        legacy.targetId ?? null,
        "legacy-transport-id",
        "2026-07-11T00:00:00.000Z",
        "2026-07-11T00:00:00.000Z",
      ],
    });
    const message = queueMessage(
      "legacy-transport-id",
      legacy as IndexJobQueueMessage,
      2,
    );
    await runMessage(db, message);

    assertEquals(calls, 1);
    assertEquals(message.acks, 1);
  } finally {
    indexerHandlerDeps.handleInfoUnit = original;
    client.close();
  }
});

test("retryable handler outcome releases only its claim before retry", async () => {
  const { client, db } = await createIndexDatabase();
  const original = indexerHandlerDeps.handleInfoUnit;
  indexerHandlerDeps.handleInfoUnit = async () => ({
    processed: false,
    reason: "temporary_index_failure",
    retryable: true,
  });
  try {
    const body = infoUnitBody("job-retryable");
    const message = queueMessage("delivery-retryable", body);
    await runMessage(db, message);

    assertEquals(message.acks, 0);
    assertEquals(message.retries, 1);
    const row = await client.execute({
      sql: "SELECT status, claim_token, error FROM index_jobs WHERE id = ?",
      args: [body.jobId],
    });
    assertEquals(row.rows[0].status, "enqueued");
    assertEquals(row.rows[0].claim_token, null);
    assertEquals(row.rows[0].error, "temporary_index_failure");
  } finally {
    indexerHandlerDeps.handleInfoUnit = original;
    client.close();
  }
});

test("permanent unavailable outcome is fenced to the owner and marked failed", async () => {
  const { client, db } = await createIndexDatabase();
  const original = indexerHandlerDeps.handleInfoUnit;
  indexerHandlerDeps.handleInfoUnit = async () => ({
    processed: false,
    reason: "info_unit_indexer_unavailable",
    retryable: false,
  });
  try {
    const body = infoUnitBody("job-unavailable");
    const message = queueMessage("delivery-unavailable", body);
    await runMessage(db, message);

    assertEquals(message.acks, 1);
    assertEquals(message.retries, 0);
    const row = await client.execute({
      sql: "SELECT status, claim_token, error, completed_at FROM index_jobs WHERE id = ?",
      args: [body.jobId],
    });
    assertEquals(row.rows[0].status, "failed");
    assertEquals(row.rows[0].claim_token, null);
    assertEquals(row.rows[0].error, "info_unit_indexer_unavailable");
    assertEquals(typeof row.rows[0].completed_at, "string");
  } finally {
    indexerHandlerDeps.handleInfoUnit = original;
    client.close();
  }
});

test("a bounded unknown job type is recorded as failed, never completed", async () => {
  const { client, db } = await createIndexDatabase();
  try {
    const message = queueMessage("delivery-unknown", {
      version: INDEX_QUEUE_MESSAGE_VERSION,
      jobId: "job-unknown",
      deliveryId: "logical-unknown",
      spaceId: "account-1",
      type: "retired_index_kind",
      timestamp: Date.now(),
    } as never);
    await indexer.queue(
      { queue: "takos-index-jobs", messages: [message] } as never,
      { DB: db } as never,
    );

    assertEquals(message.acks, 1);
    const row = await client.execute({
      sql: "SELECT status, error FROM index_jobs WHERE id = ?",
      args: ["job-unknown"],
    });
    assertEquals(row.rows[0].status, "failed");
    assertEquals(
      row.rows[0].error,
      "unknown_index_job_type:retired_index_kind",
    );
  } finally {
    client.close();
  }
});

test("a late DLQ delivery records evidence without overwriting completed", async () => {
  const { client, db } = await createIndexDatabase();
  try {
    const body = infoUnitBody("job-completed-before-dlq");
    await client.execute({
      sql: `INSERT INTO index_jobs
        (id, account_id, type, target_id, status, completed_at, created_at)
        VALUES (?, ?, ?, ?, 'completed', ?, ?)`,
      args: [
        body.jobId,
        body.spaceId,
        body.type,
        body.targetId ?? null,
        "2026-07-11T00:01:00.000Z",
        "2026-07-11T00:00:00.000Z",
      ],
    });

    const outcome = await handleIndexJobDlq(body, { DB: db }, 2);

    const job = await client.execute({
      sql: "SELECT status, error FROM index_jobs WHERE id = ?",
      args: [body.jobId],
    });
    assertEquals(job.rows[0].status, "completed");
    assertEquals(job.rows[0].error, null);
    const dlq = await client.execute(
      "SELECT COUNT(*) AS count FROM dlq_entries",
    );
    assertEquals(Number(dlq.rows[0].count), 1);
    assertEquals(outcome, { action: "ack" });
  } finally {
    client.close();
  }
});

test("DLQ evidence cannot fail a fresh running owner claim", async () => {
  const { client, db } = await createIndexDatabase();
  try {
    const body = infoUnitBody("job-running-at-dlq", "logical-running");
    const now = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO index_jobs
        (id, account_id, type, target_id, status, claim_token, started_at, created_at)
        VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
      args: [
        body.jobId,
        body.spaceId,
        body.type,
        body.targetId ?? null,
        body.deliveryId,
        now,
        now,
      ],
    });

    const outcome = await handleIndexJobDlq(body, { DB: db }, 2);

    const job = await client.execute({
      sql: "SELECT status, claim_token, error FROM index_jobs WHERE id = ?",
      args: [body.jobId],
    });
    assertEquals(job.rows[0].status, "running");
    assertEquals(job.rows[0].claim_token, body.deliveryId);
    assertEquals(job.rows[0].error, null);
    const dlq = await client.execute(
      "SELECT COUNT(*) AS count FROM dlq_entries",
    );
    assertEquals(Number(dlq.rows[0].count), 0);
    assertEquals(outcome.action, "retry");
    if (outcome.action === "retry") {
      assertEquals(outcome.delaySeconds >= 1, true);
    }
  } finally {
    client.close();
  }
});

test("the same DLQ delivery terminalizes its abandoned stale claim", async () => {
  const { client, db } = await createIndexDatabase();
  try {
    const body = infoUnitBody("job-stale-at-dlq", "logical-stale");
    const staleStartedAt = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    await client.execute({
      sql: `INSERT INTO index_jobs
        (id, account_id, type, target_id, status, claim_token, started_at, created_at)
        VALUES (?, ?, ?, ?, 'running', ?, ?, ?)`,
      args: [
        body.jobId,
        body.spaceId,
        body.type,
        body.targetId ?? null,
        body.deliveryId,
        staleStartedAt,
        staleStartedAt,
      ],
    });

    const outcome = await handleIndexJobDlq(body, { DB: db }, 2);
    assertEquals(outcome, { action: "ack" });
    const job = await client.execute({
      sql: "SELECT status, claim_token, error FROM index_jobs WHERE id = ?",
      args: [body.jobId],
    });
    assertEquals(job.rows[0].status, "failed");
    assertEquals(job.rows[0].claim_token, null);
    assertEquals(String(job.rows[0].error).includes("after 2 attempts"), true);
  } finally {
    client.close();
  }
});

test("a late duplicate cannot restart a permanently failed index job", async () => {
  const { client, db } = await createIndexDatabase();
  const original = indexerHandlerDeps.handleInfoUnit;
  let calls = 0;
  indexerHandlerDeps.handleInfoUnit = async () => {
    calls++;
    return { processed: true };
  };
  try {
    const body = infoUnitBody("job-terminal-failed");
    await client.execute({
      sql: `INSERT INTO index_jobs
        (id, account_id, type, target_id, status, error, completed_at, created_at)
        VALUES (?, ?, ?, ?, 'failed', 'permanent', ?, ?)`,
      args: [
        body.jobId,
        body.spaceId,
        body.type,
        body.targetId ?? null,
        "2026-07-11T00:01:00.000Z",
        "2026-07-11T00:00:00.000Z",
      ],
    });
    const duplicate = queueMessage("late-duplicate", body, 2);
    await runMessage(db, duplicate);

    assertEquals(calls, 0);
    assertEquals(duplicate.acks, 1);
    const row = await client.execute({
      sql: "SELECT status, error FROM index_jobs WHERE id = ?",
      args: [body.jobId],
    });
    assertEquals(row.rows[0].status, "failed");
    assertEquals(row.rows[0].error, "permanent");
  } finally {
    indexerHandlerDeps.handleInfoUnit = original;
    client.close();
  }
});

test("completion cannot ack after the handler loses its claim token", async () => {
  const { client, db } = await createIndexDatabase();
  const original = indexerHandlerDeps.handleInfoUnit;
  indexerHandlerDeps.handleInfoUnit = async () => {
    await client.execute(
      "UPDATE index_jobs SET claim_token = 'replacement-owner' WHERE id = 'job-lost-claim'",
    );
    return { processed: true };
  };
  try {
    const body = infoUnitBody("job-lost-claim");
    const message = queueMessage("delivery-original", body);
    await runMessage(db, message);

    assertEquals(message.acks, 0);
    assertEquals(message.retries, 1);
    const row = await client.execute({
      sql: "SELECT status, claim_token FROM index_jobs WHERE id = ?",
      args: [body.jobId],
    });
    assertEquals(row.rows[0].status, "running");
    assertEquals(row.rows[0].claim_token, "replacement-owner");
  } finally {
    indexerHandlerDeps.handleInfoUnit = original;
    client.close();
  }
});
