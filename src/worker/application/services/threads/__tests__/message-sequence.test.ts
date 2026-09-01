import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Env, Thread } from "../../../../shared/types/index.ts";
import {
  createMessage,
  createThread,
  updateThread,
} from "../thread-service.ts";
import { MAX_CLIENT_THREAD_TITLE_CHARACTERS } from "../../../../shared/utils/client-thread.ts";
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

test("a retried client message key returns one canonical message", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      title TEXT,
      updated_at TEXT
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
  const input = {
    role: "user" as const,
    content: "one durable request",
    metadata: { source: "test", context: { beta: 2, alpha: 1 } },
    idempotency_key: "ab".repeat(16),
  };

  try {
    const [first, retry] = await Promise.all([
      createMessage({ DB: db } as unknown as Env, db, thread, input),
      createMessage({ DB: db } as unknown as Env, db, thread, input),
    ]);
    expect(first?.id).toBe(`msg_request_${"ab".repeat(16)}`);
    expect(retry?.id).toBe(first?.id);
    const rows = await client.execute(
      "SELECT id, content FROM messages WHERE thread_id = 'thread_a'",
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].content).toBe("one durable request");
    const reordered = await createMessage(
      { DB: db } as unknown as Env,
      db,
      thread,
      {
        ...input,
        metadata: { context: { alpha: 1, beta: 2 }, source: "test" },
      },
    );
    expect(reordered?.id).toBe(first?.id);
    await expect(
      createMessage({ DB: db } as unknown as Env, db, thread, {
        ...input,
        content: "a different request",
      }),
    ).rejects.toThrow("another request");
    await expect(
      createMessage({ DB: db } as unknown as Env, db, thread, {
        ...input,
        metadata: { source: "different", context: { alpha: 1, beta: 2 } },
      }),
    ).rejects.toThrow("another request");
  } finally {
    client.close();
  }
});

test("public message writes require an active Thread but accepted retries remain replayable", async () => {
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
      next_message_sequence INTEGER NOT NULL DEFAULT 0,
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
    INSERT INTO threads (id, account_id, status)
    VALUES ('thread_a', 'space_a', 'archived');
  `);
  const db = drizzle(client, { schema });
  const thread = {
    id: "thread_a",
    space_id: "space_a",
    title: "Archived",
    status: "archived",
  } as Thread;
  const input = {
    role: "user" as const,
    content: "one accepted request",
    idempotency_key: "ef".repeat(16),
    require_active_thread: true,
  };

  try {
    await expect(
      createMessage({ DB: db } as unknown as Env, db, thread, input),
    ).rejects.toThrow("must be unarchived");
    await client.execute(
      "UPDATE threads SET status = 'active' WHERE id = 'thread_a'",
    );
    const accepted = await createMessage(
      { DB: db } as unknown as Env,
      db,
      thread,
      input,
    );
    await client.execute(
      "UPDATE threads SET status = 'archived' WHERE id = 'thread_a'",
    );
    const replay = await createMessage(
      { DB: db } as unknown as Env,
      db,
      thread,
      input,
    );
    expect(replay?.id).toBe(accepted?.id);
    const rows = await client.execute("SELECT id FROM messages");
    expect(rows.rows).toHaveLength(1);
  } finally {
    client.close();
  }
});

test("competing client message requests cannot share one operation key", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      title TEXT,
      updated_at TEXT
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
  const idempotencyKey = "bc".repeat(16);

  try {
    const settlements = await Promise.allSettled([
      createMessage({ DB: db } as unknown as Env, db, thread, {
        role: "user",
        content: "request one",
        idempotency_key: idempotencyKey,
      }),
      createMessage({ DB: db } as unknown as Env, db, thread, {
        role: "user",
        content: "request two",
        idempotency_key: idempotencyKey,
      }),
    ]);
    expect(settlements.filter((result) => result.status === "fulfilled"))
      .toHaveLength(1);
    const rejected = settlements.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(String(rejected.reason)).toContain("another request");
    }
    const rows = await client.execute(
      "SELECT content FROM messages WHERE thread_id = 'thread_a'",
    );
    expect(rows.rows).toHaveLength(1);
  } finally {
    client.close();
  }
});

test("a concurrent internal thread retry returns one canonical thread", async () => {
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
      next_message_sequence INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const db = drizzle(client, { schema });
  const input = {
    title: "Durable task thread",
    locale: "ja" as const,
    idempotency_key: "cd".repeat(16),
  };

  try {
    const [first, retry] = await Promise.all([
      createThread(db, "space_a", input),
      createThread(db, "space_a", input),
    ]);
    expect(first?.id).toBe(`thread_request_${"cd".repeat(16)}`);
    expect(retry?.id).toBe(first?.id);
    const rows = await client.execute("SELECT id FROM threads");
    expect(rows.rows).toHaveLength(1);
    await expect(createThread(db, "space_b", input)).rejects.toThrow(
      "another Workspace",
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
      status TEXT NOT NULL DEFAULT 'active',
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
    await client.execute(
      "UPDATE threads SET status = 'archived' WHERE id = 'thread_a'",
    );
    await expect(
      reserveThreadMessageSequence(binding, "thread_a", 1, {
        requireActive: true,
      }),
    ).rejects.toThrow("reservation failed");
    const afterArchive = await client.execute(
      "SELECT next_message_sequence FROM threads WHERE id = 'thread_a'",
    );
    expect(Number(afterArchive.rows[0].next_message_sequence)).toBe(20);
  } finally {
    client.close();
  }
});

test("direct Thread writes preserve the public title and context budgets", async () => {
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
      next_message_sequence INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const db = drizzle(client, { schema });
  try {
    await expect(createThread(db, "space_a", {
      title: "x".repeat(MAX_CLIENT_THREAD_TITLE_CHARACTERS + 1),
    })).rejects.toThrow("Invalid Thread title");
    const created = await createThread(db, "space_a", {
      title: "   ",
      locale: "ja",
    });
    expect(created?.title).toBeNull();
    await expect(updateThread(db, created!.id, {
      title: "x".repeat(MAX_CLIENT_THREAD_TITLE_CHARACTERS + 1),
    })).rejects.toThrow("Invalid Thread title");
    await expect(updateThread(db, created!.id, {
      context_window: 201,
    })).rejects.toThrow("Invalid Thread context window");
  } finally {
    client.close();
  }
});
