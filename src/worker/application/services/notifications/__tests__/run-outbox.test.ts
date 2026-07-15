import { expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Database } from "../../../../infra/db/client.ts";
import type { Env } from "../../../../shared/types/index.ts";
import {
  dispatchRunNotificationOutbox,
  runNotificationOutboxId,
} from "../run-outbox.ts";

async function freshDb(): Promise<{ client: Client; db: Database }> {
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
      agent_type TEXT NOT NULL DEFAULT 'default',
      model TEXT,
      status TEXT NOT NULL,
      last_event_id INTEGER NOT NULL DEFAULT 0,
      input TEXT NOT NULL DEFAULT '{}',
      output TEXT,
      error TEXT,
      usage TEXT NOT NULL DEFAULT '{}',
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
    CREATE TABLE notification_preferences (
      account_id TEXT NOT NULL,
      type TEXT NOT NULL,
      channel TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, type, channel)
    );
    CREATE TABLE notification_settings (
      account_id TEXT PRIMARY KEY,
      muted_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      recipient_account_id TEXT NOT NULL,
      account_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      data TEXT NOT NULL DEFAULT '{}',
      read_at TEXT,
      created_at TEXT NOT NULL,
      email_status TEXT NOT NULL DEFAULT 'skipped',
      email_attempts INTEGER NOT NULL DEFAULT 0,
      email_sent_at TEXT,
      email_error TEXT
    );
    CREATE TABLE notification_pushers (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      product TEXT,
      scope TEXT,
      kind TEXT NOT NULL,
      app_id TEXT NOT NULL,
      pushkey TEXT NOT NULL,
      pushkey_hash TEXT NOT NULL,
      app_display_name TEXT,
      device_display_name TEXT,
      profile_tag TEXT,
      lang TEXT,
      gateway_url TEXT NOT NULL,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE TABLE notification_push_outbox (
      notification_id TEXT PRIMARY KEY,
      delivery_status TEXT NOT NULL DEFAULT 'queued',
      claim_token TEXT,
      claimed_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX idx_notification_pushers_app_pushkey
      ON notification_pushers(app_id, pushkey_hash);
    CREATE TABLE run_notification_outbox (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      completion_key TEXT NOT NULL UNIQUE,
      run_status TEXT NOT NULL,
      delivery_status TEXT NOT NULL DEFAULT 'queued',
      claim_token TEXT,
      claimed_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return {
    client,
    db: drizzle(client, { schema }) as unknown as Database,
  };
}

async function insertOutcome(
  db: Database,
  completionKey = "completion-1",
): Promise<void> {
  const createdAt = "2026-07-15T00:00:00.000Z";
  await db.insert(schema.runs).values({
    id: "run-1",
    threadId: "thread-1",
    accountId: "workspace-1",
    requesterAccountId: "user-1",
    status: "completed",
    completionKey,
    completedAt: createdAt,
    createdAt,
  });
  await db.insert(schema.runNotificationOutbox).values({
    id: runNotificationOutboxId(completionKey),
    runId: "run-1",
    completionKey,
    runStatus: "completed",
    deliveryStatus: "queued",
    attempts: 0,
    createdAt,
    updatedAt: createdAt,
  });
}

test("Run notification outbox completes after Queue accepts the stable event", async () => {
  const { client, db } = await freshDb();
  try {
    await insertOutcome(db);
    const messages: unknown[] = [];
    const completed = await dispatchRunNotificationOutbox({
      DB: db,
      TAKOS_NOTIFICATION_PUSH_QUEUE: {
        async send(message: unknown) {
          messages.push(message);
        },
      },
    } as unknown as Env);

    expect(completed).toBe(1);
    expect(messages).toHaveLength(1);
    const outbox = await db
      .select({
        status: schema.runNotificationOutbox.deliveryStatus,
        attempts: schema.runNotificationOutbox.attempts,
      })
      .from(schema.runNotificationOutbox)
      .get();
    expect(outbox).toEqual({ status: "done", attempts: 1 });
    expect(await db.select().from(schema.notifications)).toHaveLength(1);
  } finally {
    client.close();
  }
});

test("definite push handoff failure stays queued and retry keeps one inbox row", async () => {
  const { client, db } = await freshDb();
  try {
    await insertOutcome(db);
    const timestamp = "2026-07-15T00:00:00.000Z";
    await db.insert(schema.notificationPushers).values({
      id: "pusher-1",
      accountId: "user-1",
      product: "takos",
      scope: "account:user-1",
      kind: "http",
      appId: "jp.takos.mobile",
      pushkey: "device-token",
      pushkeyHash: "device-token-hash",
      gatewayUrl: "https://push.example/_matrix/push/v1/notify",
      data: JSON.stringify({ provider: "fcm", format: "event_id_only" }),
      createdAt: timestamp,
      updatedAt: timestamp,
      lastSeenAt: timestamp,
    });
    const unavailable = {
      DB: db,
      TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
      TAKOS_NOTIFICATION_PUSH_QUEUE: {
        async send() {
          throw new Error("queue unavailable");
        },
      },
    } as unknown as Env;

    expect(await dispatchRunNotificationOutbox(unavailable)).toBe(0);
    const pending = await db
      .select({
        status: schema.runNotificationOutbox.deliveryStatus,
        attempts: schema.runNotificationOutbox.attempts,
        error: schema.runNotificationOutbox.lastError,
      })
      .from(schema.runNotificationOutbox)
      .get();
    expect(pending).toMatchObject({ status: "queued", attempts: 1 });
    expect(pending?.error).toContain("push handoff failed");
    expect(await db.select().from(schema.notifications)).toHaveLength(1);

    const queued: unknown[] = [];
    expect(
      await dispatchRunNotificationOutbox({
        DB: db,
        TAKOS_NOTIFICATION_PUSH_QUEUE: {
          async send(message: unknown) {
            queued.push(message);
          },
        },
      } as unknown as Env),
    ).toBe(1);
    expect(queued).toHaveLength(1);
    expect(await db.select().from(schema.notifications)).toHaveLength(1);
    const done = await db
      .select({
        status: schema.runNotificationOutbox.deliveryStatus,
        attempts: schema.runNotificationOutbox.attempts,
      })
      .from(schema.runNotificationOutbox)
      .where(eq(schema.runNotificationOutbox.runId, "run-1"))
      .get();
    expect(done).toEqual({ status: "done", attempts: 2 });
  } finally {
    client.close();
  }
});

test("cron recovery reclaims a stale dispatching notification row", async () => {
  const { client, db } = await freshDb();
  try {
    await insertOutcome(db);
    await db
      .update(schema.runNotificationOutbox)
      .set({
        deliveryStatus: "dispatching",
        claimToken: "dead-process",
        claimedAt: "2026-07-14T00:00:00.000Z",
      })
      .where(eq(schema.runNotificationOutbox.runId, "run-1"));
    const queued: unknown[] = [];

    expect(
      await dispatchRunNotificationOutbox(
        {
          DB: db,
          TAKOS_NOTIFICATION_PUSH_QUEUE: {
            async send(message: unknown) {
              queued.push(message);
            },
          },
        } as unknown as Env,
        { staleBefore: "2026-07-15T00:00:00.000Z" },
      ),
    ).toBe(1);
    expect(queued).toHaveLength(1);
    const row = await db
      .select({
        status: schema.runNotificationOutbox.deliveryStatus,
        claimToken: schema.runNotificationOutbox.claimToken,
        claimedAt: schema.runNotificationOutbox.claimedAt,
      })
      .from(schema.runNotificationOutbox)
      .get();
    expect(row).toEqual({
      status: "done",
      claimToken: null,
      claimedAt: null,
    });
  } finally {
    client.close();
  }
});
