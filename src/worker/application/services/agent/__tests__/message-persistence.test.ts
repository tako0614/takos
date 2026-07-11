import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { SqlDatabaseBinding } from "../../../../shared/types/bindings.ts";
import type { Env } from "../../../../shared/types/index.ts";
import { persistMessage } from "../message-persistence.ts";

test("legacy message persistence retries sequence conflicts without mistaking thread_id for the primary key", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
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
  `);
  const db = drizzle(client, { schema });
  const binding = db as unknown as SqlDatabaseBinding;
  const env = { DB: binding } as Env;

  try {
    await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        persistMessage(
          { db: binding, env, threadId: "thread_a" },
          { role: "assistant", content: `message ${index}` },
          { idempotencyKey: `message-${index}` },
        ),
      ),
    );

    const result = await client.execute(
      "SELECT content, sequence FROM messages WHERE thread_id = 'thread_a' ORDER BY sequence",
    );
    expect(result.rows).toHaveLength(10);
    expect(result.rows.map((row) => Number(row.sequence))).toEqual(
      Array.from({ length: 10 }, (_, index) => index),
    );
  } finally {
    client.close();
  }
});
