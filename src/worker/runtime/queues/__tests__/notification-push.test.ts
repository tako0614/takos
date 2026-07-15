import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "../../../infra/db/schema.ts";
import type { Database } from "../../../infra/db/client.ts";
import type {
  MessageQueueMessage,
  NotificationPushQueueMessage,
} from "../../../shared/types/index.ts";
import { NOTIFICATION_PUSH_QUEUE_MESSAGE_VERSION } from "../../../shared/types/index.ts";
import {
  handleNotificationPushDlq,
  handleNotificationPushQueue,
} from "../notification-push.ts";
import { notificationPushQueueFallbackDelaySeconds } from "../notification-push-policy.ts";
import { createWorkerRuntime } from "../../worker/runtime-factory.ts";
import type { NotificationType } from "../../../application/services/notifications/notification-models.ts";
import {
  dispatchNotificationPushOutbox,
  getNotificationPushOutboxStatus,
} from "../../../application/services/notifications/push-outbox.ts";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
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
    CREATE INDEX idx_notification_push_outbox_status_claimed_at
      ON notification_push_outbox(delivery_status, claimed_at);
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
  `);
  return drizzle(client, { schema }) as unknown as Database;
}

async function seedDelivery(
  db: Database,
  type: NotificationType = "run.completed",
): Promise<void> {
  const timestamp = "2026-07-14T00:00:00.000Z";
  await db.insert(schema.notifications).values({
    id: "notification-1",
    recipientAccountId: "user-1",
    accountId: "workspace-1",
    type,
    title: "Agent response is ready",
    data: JSON.stringify({ run_id: "run-1" }),
    createdAt: timestamp,
  });
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
}

function body(): NotificationPushQueueMessage {
  return {
    version: NOTIFICATION_PUSH_QUEUE_MESSAGE_VERSION,
    notificationId: "notification-1",
    userId: "user-1",
    scopeId: "workspace-1",
    timestamp: Date.parse("2026-07-14T00:00:00.000Z"),
  };
}

function queueMessage<T>(messageBody: T, attempts = 1) {
  const state = { acknowledgements: 0, retryDelays: [] as number[] };
  const message: MessageQueueMessage<T> = {
    id: "transport-1",
    timestamp: new Date("2026-07-14T00:00:01.000Z"),
    attempts,
    body: messageBody,
    ack() {
      state.acknowledgements += 1;
    },
    retry(options) {
      state.retryDelays.push(options?.delaySeconds ?? 0);
    },
  };
  return { message, state };
}

test("notification push queue honors a bounded gateway Retry-After", async () => {
  const db = await freshDb();
  await seedDelivery(db);
  const queued = queueMessage(body(), 2);
  let gatewayCalls = 0;

  await handleNotificationPushQueue(
    { queue: "takos-notification-push", messages: [queued.message] },
    {
      DB: db,
      TAKOS_EGRESS: {
        async fetch() {
          gatewayCalls += 1;
          return Response.json(
            { rejected: [], retryable: ["device-token"] },
            { status: 429, headers: { "Retry-After": "120" } },
          );
        },
      },
      TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    } as never,
  );

  expect(gatewayCalls).toBe(1);
  expect(queued.state.acknowledgements).toBe(0);
  expect(queued.state.retryDelays).toEqual([120]);
});

test("notification push queue acknowledges permanent gateway failures", async () => {
  const db = await freshDb();
  await seedDelivery(db);
  const queued = queueMessage(body());

  await handleNotificationPushQueue(
    { queue: "takos-notification-push", messages: [queued.message] },
    {
      DB: db,
      TAKOS_EGRESS: {
        async fetch() {
          return Response.json({ rejected: [] }, { status: 400 });
        },
      },
      TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    } as never,
  );

  expect(queued.state.acknowledgements).toBe(1);
  expect(queued.state.retryDelays).toEqual([]);
});

test("notification push queue rejects payload-bearing and stale-scope jobs", async () => {
  const db = await freshDb();
  await seedDelivery(db);
  const invalid = queueMessage({ ...body(), title: "must not enter Queue" });
  const staleScope = queueMessage({ ...body(), scopeId: "workspace-2" });
  let gatewayCalls = 0;

  await handleNotificationPushQueue(
    {
      queue: "takos-notification-push",
      messages: [invalid.message, staleScope.message],
    },
    {
      DB: db,
      TAKOS_EGRESS: {
        async fetch() {
          gatewayCalls += 1;
          return Response.json({ rejected: [] });
        },
      },
      TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    } as never,
  );

  expect(gatewayCalls).toBe(0);
  expect(invalid.state.acknowledgements).toBe(1);
  expect(staleScope.state.acknowledgements).toBe(1);
});

test("notification push queue acknowledges unsupported Takos event types without delivery", async () => {
  const db = await freshDb();
  await seedDelivery(db, "workspace.invite");
  const queued = queueMessage(body());
  let gatewayCalls = 0;

  await handleNotificationPushQueue(
    { queue: "takos-notification-push", messages: [queued.message] },
    {
      DB: db,
      TAKOS_EGRESS: {
        async fetch() {
          gatewayCalls += 1;
          return Response.json({ rejected: [] });
        },
      },
      TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    } as never,
  );

  expect(gatewayCalls).toBe(0);
  expect(queued.state.acknowledgements).toBe(1);
  expect(queued.state.retryDelays).toEqual([]);
  expect(
    await getNotificationPushOutboxStatus(db as never, "notification-1"),
  ).toBe("done");
});

test("notification push queue honors a push opt-out made after enqueue", async () => {
  const db = await freshDb();
  await seedDelivery(db);
  const timestamp = "2026-07-14T00:00:02.000Z";
  await db.insert(schema.notificationPreferences).values({
    accountId: "user-1",
    type: "run.completed",
    channel: "push",
    enabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const queued = queueMessage(body());
  let gatewayCalls = 0;

  await handleNotificationPushQueue(
    { queue: "takos-notification-push", messages: [queued.message] },
    {
      DB: db,
      TAKOS_EGRESS: {
        async fetch() {
          gatewayCalls += 1;
          return Response.json({ rejected: [] });
        },
      },
      TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    } as never,
  );

  expect(gatewayCalls).toBe(0);
  expect(queued.state.acknowledgements).toBe(1);
  expect(queued.state.retryDelays).toEqual([]);
  expect(
    await getNotificationPushOutboxStatus(db as never, "notification-1"),
  ).toBe("done");
});

test("notification push queue honors a mute made after enqueue", async () => {
  const db = await freshDb();
  await seedDelivery(db);
  const timestamp = "2026-07-14T00:00:02.000Z";
  await db.insert(schema.notificationSettings).values({
    accountId: "user-1",
    mutedUntil: "2999-01-01T00:00:00.000Z",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const queued = queueMessage(body());
  let gatewayCalls = 0;

  await handleNotificationPushQueue(
    { queue: "takos-notification-push", messages: [queued.message] },
    {
      DB: db,
      TAKOS_EGRESS: {
        async fetch() {
          gatewayCalls += 1;
          return Response.json({ rejected: [] });
        },
      },
      TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    } as never,
  );

  expect(gatewayCalls).toBe(0);
  expect(queued.state.acknowledgements).toBe(1);
  expect(queued.state.retryDelays).toEqual([]);
  expect(
    await getNotificationPushOutboxStatus(db as never, "notification-1"),
  ).toBe("done");
});

test("notification push queue retries configuration errors for DLQ visibility", async () => {
  const db = await freshDb();
  await seedDelivery(db);
  const queued = queueMessage(body(), 3);

  await handleNotificationPushQueue(
    { queue: "takos-notification-push", messages: [queued.message] },
    {
      DB: db,
      TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    } as never,
  );

  expect(queued.state.acknowledgements).toBe(0);
  expect(queued.state.retryDelays).toEqual([
    notificationPushQueueFallbackDelaySeconds(3),
  ]);
});

test("notification push DLQ records and acknowledges terminal messages", async () => {
  const db = await freshDb();
  await seedDelivery(db);
  const queued = queueMessage(body(), 6);
  await handleNotificationPushDlq(
    {
      queue: "takos-notification-push-dlq",
      messages: [queued.message],
    },
    { DB: db } as never,
  );
  expect(queued.state.acknowledgements).toBe(1);
  expect(queued.state.retryDelays).toEqual([]);
  expect(
    await getNotificationPushOutboxStatus(db as never, "notification-1"),
  ).toBe("queued");
});

test("notification push survives gateway outage through DLQ and replays idempotently", async () => {
  const db = await freshDb();
  await seedDelivery(db);
  const unavailable = queueMessage(body(), 5);

  await handleNotificationPushQueue(
    { queue: "takos-notification-push", messages: [unavailable.message] },
    {
      DB: db,
      TAKOS_EGRESS: {
        async fetch() {
          return Response.json(
            { retryable: ["device-token"] },
            { status: 503 },
          );
        },
      },
      TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    } as never,
  );
  expect(unavailable.state.acknowledgements).toBe(0);
  expect(unavailable.state.retryDelays).toHaveLength(1);
  expect(
    await getNotificationPushOutboxStatus(db as never, "notification-1"),
  ).toBe("enqueued");

  const exhausted = queueMessage(body(), 6);
  await handleNotificationPushDlq(
    {
      queue: "takos-notification-push-dlq",
      messages: [exhausted.message],
    },
    { DB: db } as never,
  );
  expect(exhausted.state.acknowledgements).toBe(1);
  expect(
    await getNotificationPushOutboxStatus(db as never, "notification-1"),
  ).toBe("queued");

  const replayed: NotificationPushQueueMessage[] = [];
  expect(
    await dispatchNotificationPushOutbox(
      {
        DB: db as never,
        TAKOS_NOTIFICATION_PUSH_QUEUE: {
          async send(message) {
            replayed.push(message);
          },
        },
      },
      { notificationId: "notification-1" },
    ),
  ).toBe(1);
  expect(replayed).toHaveLength(1);

  const recovered = queueMessage(replayed[0]);
  await handleNotificationPushQueue(
    { queue: "takos-notification-push", messages: [recovered.message] },
    {
      DB: db,
      TAKOS_EGRESS: {
        async fetch() {
          return Response.json({ rejected: [] });
        },
      },
      TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    } as never,
  );
  expect(recovered.state.acknowledgements).toBe(1);
  expect(
    await getNotificationPushOutboxStatus(db as never, "notification-1"),
  ).toBe("done");

  const duplicateDlq = queueMessage(body(), 6);
  await handleNotificationPushDlq(
    {
      queue: "takos-notification-push-dlq",
      messages: [duplicateDlq.message],
    },
    { DB: db } as never,
  );
  expect(duplicateDlq.state.acknowledgements).toBe(1);
  expect(
    await getNotificationPushOutboxStatus(db as never, "notification-1"),
  ).toBe("done");
  expect(
    await dispatchNotificationPushOutbox(
      {
        DB: db as never,
        TAKOS_NOTIFICATION_PUSH_QUEUE: {
          async send(message) {
            replayed.push(message);
          },
        },
      },
      { notificationId: "notification-1" },
    ),
  ).toBe(0);
  expect(replayed).toHaveLength(1);
});

test("notification push outbox recovers a stale crash-before-send claim", async () => {
  const db = await freshDb();
  await seedDelivery(db);
  await db.insert(schema.notificationPushOutbox).values({
    notificationId: "notification-1",
    deliveryStatus: "dispatching",
    claimToken: "crashed-before-send",
    claimedAt: "2026-07-13T00:00:00.000Z",
    attempts: 1,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  });
  const replayed: NotificationPushQueueMessage[] = [];

  expect(
    await dispatchNotificationPushOutbox(
      {
        DB: db as never,
        TAKOS_NOTIFICATION_PUSH_QUEUE: {
          async send(message) {
            replayed.push(message);
          },
        },
      },
      { staleBefore: "2026-07-14T00:00:00.000Z" },
    ),
  ).toBe(1);
  expect(replayed).toHaveLength(1);
  expect(
    await getNotificationPushOutboxStatus(db as never, "notification-1"),
  ).toBe("enqueued");
  const row = await db
    .select({
      attempts: schema.notificationPushOutbox.attempts,
      claimToken: schema.notificationPushOutbox.claimToken,
    })
    .from(schema.notificationPushOutbox)
    .where(eq(schema.notificationPushOutbox.notificationId, "notification-1"))
    .get();
  expect(row).toEqual({ attempts: 2, claimToken: null });
});

test("notification push outbox recovers crash-after-send and collapses the duplicate", async () => {
  const db = await freshDb();
  await seedDelivery(db);
  await db.insert(schema.notificationPushOutbox).values({
    notificationId: "notification-1",
    deliveryStatus: "dispatching",
    claimToken: "crashed-after-send",
    claimedAt: "2026-07-13T00:00:00.000Z",
    attempts: 1,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  });
  const replayed: NotificationPushQueueMessage[] = [];
  await dispatchNotificationPushOutbox(
    {
      DB: db as never,
      TAKOS_NOTIFICATION_PUSH_QUEUE: {
        async send(message) {
          replayed.push(message);
        },
      },
    },
    { staleBefore: "2026-07-14T00:00:00.000Z" },
  );
  expect(replayed).toHaveLength(1);

  let gatewayCalls = 0;
  const env = {
    DB: db,
    TAKOS_EGRESS: {
      async fetch() {
        gatewayCalls += 1;
        return Response.json({ rejected: [] });
      },
    },
    TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
  } as never;
  const original = queueMessage(body());
  const recovered = queueMessage(replayed[0]);
  await handleNotificationPushQueue(
    { queue: "takos-notification-push", messages: [original.message] },
    env,
  );
  await handleNotificationPushQueue(
    { queue: "takos-notification-push", messages: [recovered.message] },
    env,
  );

  expect(gatewayCalls).toBe(1);
  expect(original.state.acknowledgements).toBe(1);
  expect(recovered.state.acknowledgements).toBe(1);
  expect(
    await getNotificationPushOutboxStatus(db as never, "notification-1"),
  ).toBe("done");
});

test("notification push DLQ retries without ack when D1 replay ownership cannot commit", async () => {
  const queued = queueMessage(body(), 100);
  await handleNotificationPushDlq(
    {
      queue: "takos-notification-push-dlq",
      messages: [queued.message],
    },
    { DB: {} } as never,
  );
  expect(queued.state.acknowledgements).toBe(0);
  expect(queued.state.retryDelays).toEqual([600]);
});

test("notification push fallback retry delay is bounded exponential backoff", () => {
  expect(notificationPushQueueFallbackDelaySeconds(1)).toBe(5);
  expect(notificationPushQueueFallbackDelaySeconds(2)).toBe(10);
  expect(notificationPushQueueFallbackDelaySeconds(3)).toBe(20);
  expect(notificationPushQueueFallbackDelaySeconds(100)).toBe(900);
});

test("unified Worker runtime routes notification push and DLQ queues", async () => {
  const db = await freshDb();
  await seedDelivery(db);
  const runtime = createWorkerRuntime(
    async (env) => ({ bindings: env }) as never,
  );
  const push = queueMessage({ invalid: true });
  const dlq = queueMessage(body(), 6);

  await runtime.queue(
    { queue: "takos-notification-push", messages: [push.message] },
    {} as never,
  );
  await runtime.queue(
    { queue: "takos-notification-push-dlq", messages: [dlq.message] },
    { DB: db } as never,
  );

  expect(push.state.acknowledgements).toBe(1);
  expect(dlq.state.acknowledgements).toBe(1);
});
