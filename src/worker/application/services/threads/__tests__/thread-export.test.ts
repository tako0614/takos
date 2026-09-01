import { afterEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "../../../../infra/db/schema.ts";
import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../../../shared/types/bindings.ts";
import { MAX_DIRECT_THREAD_EXPORT_MESSAGES } from "../../../../../contracts/public/thread-export.ts";
import { MAX_OFFLOADED_MESSAGE_CONTENT_BYTES } from "../../offload/messages.ts";
import { exportThread, threadExportDeps } from "../thread-export.ts";
import { threadExportQuerySchema } from "../../../../server/routes/threads/thread.ts";

const THREAD_ID = "thread_export";
const NOW = "2026-08-10T00:00:00.000Z";
const clients: Client[] = [];
const originalNow = threadExportDeps.now;

async function fixture(threadId = THREAD_ID, title = "Export fixture") {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
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
  await client.execute({
    sql: `INSERT INTO threads
      (id, account_id, title, status, created_at, updated_at)
      VALUES (?, 'workspace_1', ?, 'active', ?, ?)`,
    args: [threadId, title, NOW, NOW],
  });
  return { client, db: drizzle(client, { schema }) };
}

afterEach(() => {
  threadExportDeps.now = originalNow;
  for (const client of clients.splice(0)) client.close();
});

function offloadRecord(overrides: Record<string, unknown> = {}) {
  const payload = {
    id: "message_1",
    thread_id: THREAD_ID,
    role: "assistant",
    content: "Canonical full assistant answer",
    tool_calls: null,
    tool_call_id: null,
    metadata: "{}",
    sequence: 1,
    created_at: NOW,
    ...overrides,
  };
  const body = JSON.stringify(payload);
  return {
    get: async () => ({
      size: new TextEncoder().encode(body).byteLength,
      text: async () => body,
    }),
  } as unknown as ObjectStoreBinding;
}

describe("direct Thread export boundary", () => {
  test("hydrates canonical R2 content and excludes internal roles by default", async () => {
    const { client, db } = await fixture();
    await client.execute({
      sql: `INSERT INTO messages
        (id, thread_id, role, content, r2_key, metadata, sequence, created_at)
        VALUES
        ('message_0', ?, 'system', 'Do not export', NULL, '{}', 0, ?),
        ('message_1', ?, 'assistant', 'SQL preview', 'message_1.json', '{}', 1, ?)`,
      args: [THREAD_ID, NOW, THREAD_ID, NOW],
    });
    threadExportDeps.now = () => "2026-08-10T01:00:00.000Z";

    const response = await exportThread({
      db: db as unknown as SqlDatabaseBinding,
      offload: offloadRecord(),
      threadId: THREAD_ID,
      includeInternal: false,
      includeInternalAuthorized: false,
      format: "json",
    });
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("application/json");
    expect(response?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response?.json()).toMatchObject({
      exported_at: "2026-08-10T01:00:00.000Z",
      messages: [
        {
          role: "assistant",
          content: "Canonical full assistant answer",
          sequence: 1,
        },
      ],
    });
  });

  test("fails closed when an offloaded canonical body is unavailable or mismatched", async () => {
    const { client, db } = await fixture();
    await client.execute({
      sql: `INSERT INTO messages
        (id, thread_id, role, content, r2_key, metadata, sequence, created_at)
        VALUES ('message_1', ?, 'assistant', 'SQL preview', 'message_1.json', '{}', 1, ?)`,
      args: [THREAD_ID, NOW],
    });
    const input = {
      db: db as unknown as SqlDatabaseBinding,
      threadId: THREAD_ID,
      includeInternal: false,
      includeInternalAuthorized: false,
      format: "markdown" as const,
    };

    await expect(exportThread(input)).rejects.toMatchObject({
      statusCode: 503,
      details: { message_data_unavailable: true },
    });
    await expect(
      exportThread({
        ...input,
        offload: offloadRecord({ id: "other_message" }),
      }),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  test("refuses an oversized direct export instead of returning a partial file", async () => {
    const { client, db } = await fixture();
    await client.execute(`
      WITH RECURSIVE counter(value) AS (
        SELECT 0
        UNION ALL
        SELECT value + 1 FROM counter
        WHERE value < ${MAX_DIRECT_THREAD_EXPORT_MESSAGES}
      )
      INSERT INTO messages
        (id, thread_id, role, content, metadata, sequence, created_at)
      SELECT
        'message_' || value,
        '${THREAD_ID}',
        'user',
        'Message ' || value,
        '{}',
        value,
        '${NOW}'
      FROM counter
    `);

    await expect(
      exportThread({
        db: db as unknown as SqlDatabaseBinding,
        threadId: THREAD_ID,
        includeInternal: false,
        includeInternalAuthorized: false,
        format: "markdown",
      }),
    ).rejects.toMatchObject({
      statusCode: 413,
      details: {
        assisted_processing: true,
        reason: "message_count_limit",
      },
    });
  });

  test("rejects oversized legacy message content before response materialization", async () => {
    const { client, db } = await fixture();
    await client.execute({
      sql: `INSERT INTO messages
        (id, thread_id, role, content, metadata, sequence, created_at)
        VALUES ('message_1', ?, 'user', ?, '{}', 0, ?)`,
      args: [
        THREAD_ID,
        "x".repeat(MAX_OFFLOADED_MESSAGE_CONTENT_BYTES + 1),
        NOW,
      ],
    });

    await expect(
      exportThread({
        db: db as unknown as SqlDatabaseBinding,
        threadId: THREAD_ID,
        includeInternal: false,
        includeInternalAuthorized: false,
        format: "json",
      }),
    ).rejects.toMatchObject({
      statusCode: 413,
      details: { reason: "message_content_limit" },
    });
  });

  test("requires owner authority for internal exports", async () => {
    await expect(
      exportThread({
        db: {} as SqlDatabaseBinding,
        threadId: THREAD_ID,
        includeInternal: true,
        includeInternalAuthorized: false,
        format: "json",
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test("keeps untrusted database identity out of attachment header syntax", async () => {
    const hostileThreadId = 'thread"\r\nX-Evil';
    const { db } = await fixture(hostileThreadId, "Unsafe / title");

    const response = await exportThread({
      db: db as unknown as SqlDatabaseBinding,
      threadId: hostileThreadId,
      includeInternal: false,
      includeInternalAuthorized: false,
      format: "json",
    });
    expect(response?.headers.get("content-disposition")).toBe(
      'attachment; filename="Unsafe-title-thread-X-Evil.json"',
    );
  });

  test("accepts only the exact bounded query vocabulary", () => {
    expect(threadExportQuerySchema.parse({})).toEqual({
      format: "markdown",
      include_internal: "0",
    });
    expect(
      threadExportQuerySchema.parse({
        format: "json",
        include_internal: "1",
      }),
    ).toEqual({ format: "json", include_internal: "1" });
    expect(threadExportQuerySchema.safeParse({ format: "pdf" }).success).toBe(
      false,
    );
    expect(threadExportQuerySchema.safeParse({ format: "PDF" }).success).toBe(
      false,
    );
    expect(
      threadExportQuerySchema.safeParse({ include_internal: "yes" }).success,
    ).toBe(false);
    expect(threadExportQuerySchema.safeParse({ unknown: true }).success).toBe(
      false,
    );
  });
});
