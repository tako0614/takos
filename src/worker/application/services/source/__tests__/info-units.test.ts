import { expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Database } from "../../../../infra/db/index.ts";
import type { ObjectStoreBinding } from "../../../../shared/types/bindings.ts";
import {
  InfoUnitIndexer,
  MAX_INFO_UNIT_SEGMENTS_PER_RUN,
} from "../info-units.ts";

const TEST_DDL = `
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL,
    output TEXT,
    error TEXT,
    started_at TEXT,
    completed_at TEXT
  );
  CREATE TABLE run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    type TEXT NOT NULL,
    event_key TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE TABLE info_units (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    thread_id TEXT,
    run_id TEXT,
    session_id TEXT,
    kind TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    segment_index INTEGER NOT NULL,
    segment_count INTEGER NOT NULL,
    vector_id TEXT,
    metadata TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

async function seedCompletedRun(
  client: Client,
  runId: string,
  output: string,
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO runs
      (id, thread_id, account_id, status, output, started_at, completed_at)
      VALUES (?, ?, ?, 'completed', ?, ?, ?)`,
    args: [
      runId,
      "thread_a",
      "space_a",
      output,
      "2026-07-11T00:00:00.000Z",
      "2026-07-11T00:01:00.000Z",
    ],
  });
  await client.execute({
    sql: `INSERT INTO run_events
      (run_id, type, event_key, data, created_at)
      VALUES (?, 'completed', ?, '{}', ?)`,
    args: [runId, `terminal:${runId}`, "2026-07-11T00:01:00.000Z"],
  });
}

test("info unit indexing keeps SQL terminal evidence when configured R2 has no notifier segment", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(TEST_DDL);
  await seedCompletedRun(client, "run_a", "durable final answer");

  const db = drizzle(client, { schema }) as unknown as Database;
  const emptyOffload = {
    get: async () => null,
  } as unknown as ObjectStoreBinding;

  try {
    await new InfoUnitIndexer({
      DB: db as never,
      TAKOS_OFFLOAD: emptyOffload,
    }).indexRun("space_a", "run_a");

    const result = await client.execute(
      "SELECT content FROM info_units WHERE run_id = 'run_a'",
    );
    expect(result.rows).toHaveLength(1);
    expect(String(result.rows[0]?.content)).toContain(
      "[assistant] durable final answer",
    );

    // A retry must reconcile the existing segment instead of treating any
    // prior row as proof that a potentially multi-segment job fully finished.
    await client.execute(
      "UPDATE runs SET output = 'recovered final answer' WHERE id = 'run_a'",
    );
    await new InfoUnitIndexer({
      DB: db as never,
      TAKOS_OFFLOAD: emptyOffload,
    }).indexRun("space_a", "run_a");
    const retried = await client.execute(
      "SELECT id, content FROM info_units WHERE run_id = 'run_a'",
    );
    expect(retried.rows).toHaveLength(1);
    expect(String(retried.rows[0]?.content)).toContain(
      "[assistant] recovered final answer",
    );
  } finally {
    client.close();
  }
});

test("info unit indexing caps long Run transcripts and records the omission", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(TEST_DDL);
  await seedCompletedRun(client, "run_long", "durable final answer");
  await client.execute(`
    WITH RECURSIVE sequence(value) AS (
      SELECT 1
      UNION ALL
      SELECT value + 1 FROM sequence WHERE value < 520
    )
    INSERT INTO run_events (run_id, type, event_key, data, created_at)
    SELECT
      'run_long',
      'message',
      'event:' || value,
      '{"content":"event-' || value || '-' ||
        replace(hex(zeroblob(1000)), '00', 'x') || '"}',
      '2026-07-11T00:00:00.000Z'
    FROM sequence
  `);
  const db = drizzle(client, { schema }) as unknown as Database;

  try {
    await new InfoUnitIndexer({ DB: db as never }).indexRun(
      "space_a",
      "run_long",
    );

    const indexed = await client.execute(
      `SELECT content, metadata, segment_index
       FROM info_units WHERE run_id = 'run_long'
       ORDER BY segment_index`,
    );
    expect(indexed.rows).toHaveLength(MAX_INFO_UNIT_SEGMENTS_PER_RUN);
    expect(String(indexed.rows[0]?.content)).toContain(
      "Earlier Run activity was omitted",
    );
    expect(indexed.rows.some((row) =>
      String(row.content).includes("event-520-")
    )).toBe(true);
    expect(indexed.rows.some((row) =>
      String(row.content).includes("durable final answer")
    )).toBe(true);
    for (const row of indexed.rows) {
      expect(JSON.parse(String(row.metadata))).toMatchObject({
        source_truncated: true,
        event_data_truncated: false,
        repos_truncated: false,
      });
    }

    await client.execute("DELETE FROM run_events WHERE run_id = 'run_long'");
    await client.execute(
      "UPDATE runs SET output = 'recovered short answer' WHERE id = 'run_long'",
    );
    await new InfoUnitIndexer({ DB: db as never }).indexRun(
      "space_a",
      "run_long",
    );
    const reconciled = await client.execute(
      `SELECT content, segment_index, segment_count
       FROM info_units WHERE run_id = 'run_long'`,
    );
    expect(reconciled.rows).toHaveLength(1);
    expect(reconciled.rows[0]?.segment_index).toBe(0);
    expect(reconciled.rows[0]?.segment_count).toBe(1);
    expect(String(reconciled.rows[0]?.content)).toContain(
      "recovered short answer",
    );
  } finally {
    client.close();
  }
});

test("partial embedding failure stays retryable and fills the stable vector on retry", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(TEST_DDL);
  await seedCompletedRun(client, "run_vector", "vector retry answer");
  const db = drizzle(client, { schema }) as unknown as Database;
  let failEmbedding = true;
  const ai = {
    run: async () => {
      if (failEmbedding) throw new Error("temporary embedding outage");
      return { data: [[0.1, 0.2]] };
    },
  };
  const vectorize = {
    upsert: async () => undefined,
  };

  try {
    await expect(
      new InfoUnitIndexer({
        DB: db as never,
        AI: ai as never,
        VECTORIZE: vectorize as never,
      }).indexRun("space_a", "run_vector"),
    ).rejects.toThrow("embedding incomplete");
    const partial = await client.execute(
      "SELECT id, vector_id FROM info_units WHERE run_id = 'run_vector'",
    );
    expect(partial.rows).toHaveLength(1);
    expect(partial.rows[0]?.vector_id).toBeNull();

    failEmbedding = false;
    await new InfoUnitIndexer({
      DB: db as never,
      AI: ai as never,
      VECTORIZE: vectorize as never,
    }).indexRun("space_a", "run_vector");
    const recovered = await client.execute(
      "SELECT id, vector_id FROM info_units WHERE run_id = 'run_vector'",
    );
    expect(recovered.rows).toHaveLength(1);
    expect(String(recovered.rows[0]?.vector_id)).toContain(
      "info_unit:space_a:",
    );
  } finally {
    client.close();
  }
});
