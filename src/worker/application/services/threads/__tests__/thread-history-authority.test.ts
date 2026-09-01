import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { Env } from "../../../../shared/types/index.ts";
import * as schema from "../../../../infra/db/schema.ts";
import { getThreadHistory } from "../thread-history.ts";
import {
  getThreadTimeline,
  threadTimelineDeps,
} from "../thread-timeline.ts";
import { listThreadMessages, listThreads } from "../thread-service.ts";
import { MAX_OFFLOADED_MESSAGE_OBJECT_BYTES } from "../../offload/messages.ts";
import {
  CHAT_HISTORY_TRUNCATED_EVENT_DATA,
  MAX_CHAT_HISTORY_ARTIFACTS,
  MAX_CHAT_HISTORY_EVENT_DATA_CHARACTERS,
  MAX_CHAT_HISTORY_EVENTS,
} from "takos-api-contract/chat-history";
import { MAX_CHAT_THREADS_PER_RESPONSE } from "takos-api-contract/chat-thread";

test("Thread inventory returns one bounded deterministic recent page", async () => {
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
    WITH RECURSIVE thread_counter(value) AS (
      SELECT 0
      UNION ALL
      SELECT value + 1 FROM thread_counter
      WHERE value < ${MAX_CHAT_THREADS_PER_RESPONSE}
    )
    INSERT INTO threads (id, account_id, title, created_at, updated_at)
    SELECT
      printf('thread_%03d', value),
      'space_a',
      'Thread ' || value,
      printf('2026-08-10T00:%02d:%02d.000Z', value / 60, value % 60),
      printf('2026-08-10T00:%02d:%02d.000Z', value / 60, value % 60)
    FROM thread_counter;
  `);
  const db = drizzle(client, { schema });

  try {
    const page = await listThreads(db, "space_a", { status: "active" });
    expect(page.threads).toHaveLength(MAX_CHAT_THREADS_PER_RESPONSE);
    expect(page.truncated).toBe(true);
    expect(page.threads[0].id).toBe(
      `thread_${String(MAX_CHAT_THREADS_PER_RESPONSE).padStart(3, "0")}`,
    );
    expect(page.threads.at(-1)?.id).toBe("thread_001");
  } finally {
    client.close();
  }
});

test("Thread history fences root Runs and Task context to the accepted Workspace", async () => {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      requester_account_id TEXT,
      session_id TEXT,
      parent_run_id TEXT,
      child_thread_id TEXT,
      root_thread_id TEXT,
      root_run_id TEXT,
      agent_type TEXT NOT NULL,
      model TEXT,
      status TEXT NOT NULL,
      terminal_reason TEXT,
      last_event_id INTEGER NOT NULL DEFAULT 0,
      input TEXT NOT NULL,
      output TEXT,
      error TEXT,
      usage TEXT NOT NULL,
      service_id TEXT,
      service_heartbeat TEXT,
      lease_version INTEGER NOT NULL DEFAULT 0,
      completion_key TEXT,
      transcript_sequence_start INTEGER,
      engine_checkpoint TEXT,
      engine_checkpoint_updated_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT,
      file_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE run_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE agent_tasks (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      thread_id TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO runs (
      id, thread_id, account_id, requester_account_id, root_thread_id,
      root_run_id, agent_type, model, status, input, usage, completed_at,
      created_at
    ) VALUES
      ('run_a', 'thread_a', 'space_a', 'user_a', 'thread_a', 'run_a',
       'default', 'gpt-5.5', 'completed', '{}', '{}',
       '2026-08-10T00:00:02.000Z', '2026-08-10T00:00:00.000Z'),
      ('run_b', 'thread_b', 'space_b', 'user_b', 'thread_a', 'run_b',
       'default', 'gpt-5.5', 'running', '{}', '{}', NULL,
       '2026-08-10T00:00:01.000Z');
    INSERT INTO agent_tasks (
      id, account_id, thread_id, title, status, priority, updated_at
    ) VALUES
      ('task_a', 'space_a', 'thread_a', 'Visible task', 'failed', 'high',
       '2026-08-10T00:00:03.000Z'),
      ('task_b', 'space_b', 'thread_a', 'Foreign task', 'in_progress', 'urgent',
       '2026-08-10T00:00:04.000Z');
  `);
  const db = drizzle(client, { schema });

  try {
    const history = await getThreadHistory(
      { DB: db } as unknown as Env,
      "thread_a",
      {
        spaceId: "space_a",
        limit: 100,
        offset: 0,
        includeMessages: false,
      },
    );
    expect(history.runs.map((node) => node.run.id)).toEqual(["run_a"]);
    expect(history.runs[0].run).not.toHaveProperty("input");
    expect(history.runs[0].run).not.toHaveProperty("output");
    expect(history.runs[0].run).not.toHaveProperty("usage");
    expect(history.runs[0].run).not.toHaveProperty("worker_id");
    expect(history.activeRun).toBeNull();
    expect(history.taskContext).toEqual({
      id: "task_a",
      space_id: "space_a",
      thread_id: "thread_a",
      title: "Visible task",
      status: "failed",
      priority: "high",
    });
    expect(history.truncation).toEqual({
      message_data: false,
      runs: false,
      artifacts: false,
      events: false,
      event_data: false,
    });
    expect(history).not.toHaveProperty("pendingSessionDiff");

    await client.executeMultiple(`
      WITH RECURSIVE artifact_counter(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM artifact_counter WHERE value < 1001
      )
      INSERT INTO artifacts (id, run_id, type, title, file_id, created_at)
      SELECT
        'artifact_' || value,
        'run_a',
        'report',
        'Artifact ' || value,
        NULL,
        printf('2026-08-10T00:01:%02d.000Z', value % 60)
      FROM artifact_counter;

      WITH RECURSIVE event_counter(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM event_counter WHERE value < 2001
      )
      INSERT INTO run_events (run_id, type, data, created_at)
      SELECT
        'run_a',
        'progress',
        json_object('sequence', value),
        printf('2026-08-10T00:02:%02d.000Z', value % 60)
      FROM event_counter;
    `);
    await client.execute({
      sql: `
        INSERT INTO run_events (run_id, type, data, created_at)
        VALUES ('run_a', 'progress', ?, '2026-08-10T00:03:00.000Z')
      `,
      args: [
        JSON.stringify({
          blob: "x".repeat(MAX_CHAT_HISTORY_EVENT_DATA_CHARACTERS + 1),
        }),
      ],
    });

    const bounded = await getThreadHistory(
      { DB: db } as unknown as Env,
      "thread_a",
      {
        spaceId: "space_a",
        limit: 100,
        offset: 0,
        includeMessages: false,
      },
    );
    expect(bounded.runs[0].artifacts).toHaveLength(
      MAX_CHAT_HISTORY_ARTIFACTS,
    );
    expect(bounded.runs[0].events).toHaveLength(MAX_CHAT_HISTORY_EVENTS);
    expect(bounded.truncation).toEqual({
      message_data: false,
      runs: false,
      artifacts: true,
      events: true,
      event_data: true,
    });
    expect(bounded.runs[0].events.at(-1)).toMatchObject({
      data: CHAT_HISTORY_TRUNCATED_EVENT_DATA,
      data_truncated: true,
      created_at: "2026-08-10T00:03:00.000Z",
    });
    expect(bounded.runs[0].latest_event_at).toBe(
      "2026-08-10T00:03:00.000Z",
    );
  } finally {
    client.close();
  }
});

test("Thread message timeline returns only its canonical Message page", async () => {
  const original = threadTimelineDeps.listThreadMessages;
  let listCalls = 0;
  let requestedLatest = false;
  threadTimelineDeps.listThreadMessages = (async (
    _env,
    _db,
    _threadId,
    _limit,
    _offset,
    options,
  ) => {
    listCalls++;
    requestedLatest = options?.latest === true;
    return {
      messages: [],
      total: 0,
      offset: 0,
      messageDataTruncated: false,
    };
  }) as never;

  try {
    const timeline = await getThreadTimeline(
      { DB: new Proxy({}, {
        get() {
          throw new Error("timeline must not read session state");
        },
      }) } as unknown as Env,
      "thread_a",
      100,
      0,
      true,
    );
    expect(listCalls).toBe(1);
    expect(requestedLatest).toBe(true);
    expect(timeline).toEqual({
      messages: [],
      total: 0,
      limit: 100,
      offset: 0,
      truncation: { message_data: false },
    });
    expect(timeline).not.toHaveProperty("activeRun");
    expect(timeline).not.toHaveProperty("pendingSessionDiff");
  } finally {
    threadTimelineDeps.listThreadMessages = original;
  }
});

test("Thread message latest pagination returns the newest bounded page", async () => {
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
    WITH RECURSIVE message_counter(value) AS (
      SELECT 0
      UNION ALL
      SELECT value + 1 FROM message_counter WHERE value < 204
    )
    INSERT INTO messages (
      id, thread_id, role, content, metadata, sequence, created_at
    )
    SELECT
      'message_' || value,
      'thread_long',
      CASE WHEN value % 2 = 0 THEN 'user' ELSE 'assistant' END,
      'Message ' || value,
      '{}',
      value,
      printf('2026-08-10T00:%02d:%02d.000Z', value / 60, value % 60)
    FROM message_counter;
  `);
  const db = drizzle(client, { schema });

  try {
    const page = await listThreadMessages(
      { DB: db } as unknown as Env,
      db,
      "thread_long",
      100,
      0,
      { latest: true },
    );
    expect(page.total).toBe(205);
    expect(page.offset).toBe(105);
    expect(page.messages).toHaveLength(100);
    expect(page.messages[0].sequence).toBe(105);
    expect(page.messages.at(-1)?.sequence).toBe(204);
    expect(page.messageDataTruncated).toBe(false);
    expect(page).not.toHaveProperty("runs");

    await client.execute(
      "UPDATE messages SET r2_key = 'oversized_latest' WHERE sequence = 204",
    );
    let bodyReads = 0;
    const truncated = await listThreadMessages(
      {
        DB: db,
        TAKOS_OFFLOAD: {
          get: async () => ({
            size: MAX_OFFLOADED_MESSAGE_OBJECT_BYTES + 1,
            text: async () => {
              bodyReads++;
              return "{}";
            },
          }),
        },
      } as unknown as Env,
      db,
      "thread_long",
      100,
      0,
      { latest: true },
    );
    expect(truncated.messageDataTruncated).toBe(true);
    expect(truncated.messages.at(-1)?.content).toBe("Message 204");
    expect(bodyReads).toBe(0);
  } finally {
    client.close();
  }
});
