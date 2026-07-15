import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../../infra/db/schema.ts";
import type { Database } from "../../../../infra/db/client.ts";
import type { Env } from "../../../../shared/types/index.ts";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  PUSH_SUPPORTED_NOTIFICATION_TYPES,
  isPushSupportedNotificationType,
} from "../notification-models.ts";
import { createRunTerminalNotification } from "../run-terminal.ts";
import {
  createNotification,
  ensureNotificationPreferences,
  getNotificationPreferences,
  updateNotificationPreferences,
} from "../service.ts";

async function freshDb(): Promise<Database> {
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
  `);
  return drizzle(client, { schema }) as unknown as Database;
}

async function insertTerminalRun(
  db: Database,
  input: { status: "completed" | "failed"; completionKey: string },
): Promise<void> {
  await db.insert(schema.runs).values({
    id: "run-1",
    threadId: "thread-1",
    accountId: "workspace-1",
    requesterAccountId: "user-1",
    status: input.status,
    completionKey: input.completionKey,
    completedAt: "2026-07-14T12:00:00.000Z",
    createdAt: "2026-07-14T11:59:00.000Z",
  });
}

test.each([
  ["completed", "run.completed", "Agent response is ready"],
  ["failed", "run.failed", "Agent run failed"],
] as const)(
  "committed run %s keeps one inbox row and one durable Queue handoff",
  async (status, expectedType, expectedTitle) => {
    const db = await freshDb();
    const completionKey = `completion-${status}`;
    await insertTerminalRun(db, { status, completionKey });
    const queued: unknown[] = [];
    const env = {
      DB: db,
      TAKOS_NOTIFICATION_PUSH_QUEUE: {
        async send(message: unknown) {
          queued.push(message);
        },
        async sendBatch() {},
      },
    } as unknown as Env;

    const first = await createRunTerminalNotification(env, {
      runId: "run-1",
      status,
      completionKey,
    });
    const replay = await createRunTerminalNotification(env, {
      runId: "run-1",
      status,
      completionKey,
    });

    expect(replay.notification_id).toBe(first.notification_id);
    expect(first.push_handoff).toBe("queued");
    expect(replay.push_handoff).toBe("queued");
    const rows = await db
      .select({
        id: schema.notifications.id,
        type: schema.notifications.type,
        title: schema.notifications.title,
        data: schema.notifications.data,
      })
      .from(schema.notifications)
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: first.notification_id,
      type: expectedType,
      title: expectedTitle,
    });
    expect(JSON.parse(rows[0]!.data)).toEqual({
      run_id: "run-1",
      thread_id: "thread-1",
      route: "/chat/workspace-1/thread-1",
    });
    expect(queued).toHaveLength(1);
    for (const message of queued) {
      expect(message).toEqual({
        version: 1,
        notificationId: first.notification_id,
        userId: "user-1",
        scopeId: "workspace-1",
        timestamp: expect.any(Number),
      });
    }
  },
);

test("only Agent Run outcomes default push on", () => {
  expect(PUSH_SUPPORTED_NOTIFICATION_TYPES).toEqual([
    "run.completed",
    "run.failed",
  ]);
  expect(isPushSupportedNotificationType("run.completed")).toBe(true);
  expect(isPushSupportedNotificationType("workspace.invite")).toBe(false);
  expect(DEFAULT_NOTIFICATION_PREFERENCES["run.completed"].push).toBe(true);
  expect(DEFAULT_NOTIFICATION_PREFERENCES["run.failed"].push).toBe(true);
  for (const [type, preferences] of Object.entries(
    DEFAULT_NOTIFICATION_PREFERENCES,
  )) {
    if (type === "run.completed" || type === "run.failed") continue;
    expect(preferences.push).toBe(false);
  }
});

test("filling missing defaults never overwrites an existing push opt-out", async () => {
  const db = await freshDb();
  const timestamp = "2026-07-14T12:00:00.000Z";
  await db.insert(schema.notificationPreferences).values({
    accountId: "user-1",
    type: "run.completed",
    channel: "push",
    enabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await ensureNotificationPreferences(db as never, "user-1");

  const push = await db
    .select({ enabled: schema.notificationPreferences.enabled })
    .from(schema.notificationPreferences)
    .where(
      and(
        eq(schema.notificationPreferences.accountId, "user-1"),
        eq(schema.notificationPreferences.type, "run.completed"),
        eq(schema.notificationPreferences.channel, "push"),
      ),
    )
    .get();
  expect(push?.enabled).toBe(false);
});

test("historical and direct service preferences cannot enable push outside Agent Run outcomes", async () => {
  const db = await freshDb();
  const timestamp = "2026-07-14T12:00:00.000Z";
  await db.insert(schema.notificationPreferences).values({
    accountId: "user-1",
    type: "workspace.invite",
    channel: "push",
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const historical = await getNotificationPreferences(db as never, "user-1");
  expect(historical["workspace.invite"].push).toBe(false);
  const storedHistorical = await db
    .select({ enabled: schema.notificationPreferences.enabled })
    .from(schema.notificationPreferences)
    .where(
      and(
        eq(schema.notificationPreferences.accountId, "user-1"),
        eq(schema.notificationPreferences.type, "workspace.invite"),
        eq(schema.notificationPreferences.channel, "push"),
      ),
    )
    .get();
  expect(storedHistorical?.enabled).toBe(false);

  const direct = await updateNotificationPreferences(db as never, "user-1", [
    { type: "deploy.failed", channel: "push", enabled: true },
  ]);
  expect(direct["deploy.failed"].push).toBe(false);
  const storedDirect = await db
    .select({ enabled: schema.notificationPreferences.enabled })
    .from(schema.notificationPreferences)
    .where(
      and(
        eq(schema.notificationPreferences.accountId, "user-1"),
        eq(schema.notificationPreferences.type, "deploy.failed"),
        eq(schema.notificationPreferences.channel, "push"),
      ),
    )
    .get();
  expect(storedDirect?.enabled).toBe(false);
});

test("createNotification persists unsupported types without dispatching push", async () => {
  const db = await freshDb();
  const timestamp = "2026-07-14T12:00:00.000Z";
  await db.insert(schema.notificationPreferences).values({
    accountId: "user-1",
    type: "security.new_login",
    channel: "push",
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const queued: unknown[] = [];
  const result = await createNotification(
    {
      DB: db,
      TAKOS_NOTIFICATION_PUSH_QUEUE: {
        async send(message: unknown) {
          queued.push(message);
        },
        async sendBatch() {},
      },
    } as unknown as Env,
    {
      userId: "user-1",
      type: "security.new_login",
      title: "New sign-in",
    },
  );

  expect(result.notification_id).toBeString();
  expect(queued).toEqual([]);
  const stored = await db
    .select({ type: schema.notifications.type })
    .from(schema.notifications)
    .where(eq(schema.notifications.id, result.notification_id!))
    .get();
  expect(stored).toEqual({ type: "security.new_login" });
});
