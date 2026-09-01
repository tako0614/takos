import { afterEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";
import { isAppError } from "@takos/worker-platform-utils/errors";
import * as schema from "../../../../infra/db/schema.ts";
import type { Env } from "../../../../shared/types/index.ts";
import { hashPassword } from "../../../../application/services/identity/auth-utils.ts";
import publicShareRoutes from "../routes.ts";

const TOKEN = "a".repeat(32);
const THREAD_ID = "thread_public_share";
const NOW = "2026-08-10T00:00:00.000Z";
const clients: Client[] = [];

async function fixture() {
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
    CREATE TABLE thread_shares (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      created_by_account_id TEXT,
      token TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL,
      password_hash TEXT,
      expires_at TEXT,
      revoked_at TEXT,
      last_accessed_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  const db = drizzle(client, { schema });
  await client.execute({
    sql: `INSERT INTO threads
      (id, account_id, title, status, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?)`,
    args: [THREAD_ID, "workspace_1", "Shared thread", NOW, NOW],
  });
  await client.execute({
    sql: `INSERT INTO thread_shares
      (id, thread_id, account_id, created_by_account_id, token, mode,
       password_hash, created_at)
      VALUES (?, ?, ?, ?, ?, 'password', ?, ?)`,
    args: [
      "share_1",
      THREAD_ID,
      "workspace_1",
      "user_1",
      TOKEN,
      await hashPassword(" correct horse "),
      NOW,
    ],
  });
  await client.execute({
    sql: `INSERT INTO messages
      (id, thread_id, role, content, r2_key, metadata, sequence, created_at)
      VALUES
      ('message_0', ?, 'user', 'Visible question', NULL, '{}', 0, ?),
      ('message_1', ?, 'system', 'Never disclose this', NULL, '{}', 1, ?),
      ('message_2', ?, 'assistant', 'SQL preview', 'offload_message_2', '{}', 2, ?),
      ('message_3', ?, 'tool', 'Never disclose this either', NULL, '{}', 3, ?)`,
    args: [THREAD_ID, NOW, THREAD_ID, NOW, THREAD_ID, NOW, THREAD_ID, NOW],
  });
  return { client, db };
}

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

function rateLimiter(allowed = true) {
  const calls: Array<Record<string, unknown>> = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (_input: unknown, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({
          allowed,
          reset: Date.now() + 60_000,
        });
      },
    }),
  };
  return { calls, namespace };
}

function offload() {
  const persisted = {
    id: "message_2",
    thread_id: THREAD_ID,
    role: "assistant",
    content: "Hydrated assistant answer",
    tool_calls: null,
    tool_call_id: null,
    metadata: "{}",
    sequence: 2,
    created_at: NOW,
  };
  const body = JSON.stringify(persisted);
  return {
    get: async (key: string) =>
      key === "offload_message_2"
        ? {
            size: new TextEncoder().encode(body).byteLength,
            text: async () => body,
          }
        : null,
  };
}

function app() {
  const result = new Hono<{ Bindings: Env }>();
  result.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as 400 | 401 | 403 | 404 | 429 | 503,
      );
    }
    throw error;
  });
  result.route("/api/public", publicShareRoutes);
  return result;
}

describe("public Thread share boundary", () => {
  test("uses the standard error envelope to request a password", async () => {
    const { db } = await fixture();
    const response = await app().request(
      `/api/public/thread-shares/${TOKEN}`,
      undefined,
      { DB: db } as unknown as Env,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: {
        details: { requires_password: true },
      },
    });
  });

  test("pages public roles and hydrates offloaded message content", async () => {
    const { db } = await fixture();
    const limiter = rateLimiter();
    const env = {
      DB: db,
      RATE_LIMITER_DO: limiter.namespace,
      TAKOS_OFFLOAD: offload(),
    } as unknown as Env;

    const first = await app().request(
      `/api/public/thread-shares/${TOKEN}/access`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password: " correct horse ",
          limit: 2,
          offset: 0,
        }),
      },
      env,
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      token: TOKEN,
      messages: [{ id: "message_0", content: "Visible question" }],
      page: { offset: 0, has_more: true, next_offset: 2 },
    });

    const second = await app().request(
      `/api/public/thread-shares/${TOKEN}/access`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password: " correct horse ",
          limit: 2,
          offset: 2,
        }),
      },
      env,
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      messages: [
        {
          id: "message_2",
          content: "Hydrated assistant answer",
        },
      ],
      page: { offset: 2, has_more: false, next_offset: null },
    });
    expect(limiter.calls).toHaveLength(2);
  });

  test("preserves exact passwords and fails closed without durable limiting", async () => {
    const { db } = await fixture();
    const limiter = rateLimiter();
    const wrong = await app().request(
      `/api/public/thread-shares/${TOKEN}/access`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "correct horse" }),
      },
      { DB: db, RATE_LIMITER_DO: limiter.namespace } as unknown as Env,
    );
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({
      error: { details: { invalid_password: true } },
    });

    const unavailable = await app().request(
      `/api/public/thread-shares/${TOKEN}/access`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: " correct horse " }),
      },
      { DB: db } as unknown as Env,
    );
    expect(unavailable.status).toBe(503);
  });

  test("rejects over-limit password attempts before password hashing", async () => {
    const { db } = await fixture();
    const limiter = rateLimiter(false);
    const response = await app().request(
      `/api/public/thread-shares/${TOKEN}/access`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "wrong-password" }),
      },
      { DB: db, RATE_LIMITER_DO: limiter.namespace } as unknown as Env,
    );

    expect(response.status).toBe(429);
    expect(limiter.calls).toHaveLength(1);
  });
});
