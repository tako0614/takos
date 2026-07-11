import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Env, Thread } from "../../../../shared/types/index.ts";
import { createMessage } from "../thread-service.ts";
import { reserveThreadMessageSequence } from "../message-sequence.ts";
import {
  createPreparedStatement,
  createSequentialBatch,
} from "../../../../local-platform/d1-prepared-statement.ts";

test("concurrent Thread message writers commit a unique deterministic sequence", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      title TEXT,
      locale TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      summary TEXT,
      key_points TEXT NOT NULL DEFAULT '[]',
      retrieval_index INTEGER NOT NULL DEFAULT -1,
      context_window INTEGER NOT NULL DEFAULT 50,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    CREATE UNIQUE INDEX idx_messages_thread_sequence
      ON messages(thread_id, sequence);
    INSERT INTO threads (id, account_id) VALUES ('thread_a', 'space_a');
  `);
  const db = drizzle(client, { schema });
  const thread = {
    id: "thread_a",
    space_id: "space_a",
    title: "Existing title",
  } as Thread;

  try {
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        createMessage({ DB: db } as unknown as Env, db, thread, {
          role: "user",
          content: `message ${index}`,
        }),
      ),
    );

    const result = await client.execute(
      "SELECT sequence FROM messages WHERE thread_id = 'thread_a' ORDER BY sequence",
    );
    expect(result.rows.map((row) => Number(row.sequence))).toEqual(
      Array.from({ length: 10 }, (_, index) => index),
    );
  } finally {
    client.close();
  }
});

test("raw production binding atomically reserves one monotonic range", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      next_message_sequence INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO threads (id, next_message_sequence) VALUES ('thread_a', 0);
  `);
  const binding = {
    prepare(query: string) {
      return createPreparedStatement(client, query);
    },
    batch: createSequentialBatch((statement) => statement.run()),
  } as unknown as import("../../../../shared/types/bindings.ts").SqlDatabaseBinding;

  try {
    const starts = await Promise.all(
      Array.from({ length: 20 }, () =>
        reserveThreadMessageSequence(binding, "thread_a"),
      ),
    );
    expect(starts.slice().sort((left, right) => left! - right!)).toEqual(
      Array.from({ length: 20 }, (_, index) => index),
    );
    const row = await client.execute(
      "SELECT next_message_sequence FROM threads WHERE id = 'thread_a'",
    );
    expect(Number(row.rows[0].next_message_sequence)).toBe(20);
  } finally {
    client.close();
  }
});
