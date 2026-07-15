import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";

import * as schema from "../../../../infra/db/schema.ts";
import type { Database } from "../../../../infra/db/client.ts";
import type { Env, ExecutionContext } from "../../../../shared/types/index.ts";
import {
  classifyNotificationPushGatewayStatus,
  deliverNotificationToPushers,
  parseNotificationPushRetryAfter,
  pruneStaleNotificationPushers,
  validateNotificationPushGatewayUrl,
} from "../mobile-push-delivery.ts";
import { registerNotificationPusher } from "../pushers.ts";
import { createNotification } from "../service.ts";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(`
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
    CREATE UNIQUE INDEX idx_notification_pushers_app_pushkey
      ON notification_pushers(app_id, pushkey_hash);
  `);
  return drizzle(client, { schema }) as unknown as Database;
}

async function insertPusher(
  db: Database,
  input: {
    readonly id: string;
    readonly pushkey: string;
    readonly gatewayUrl?: string;
    readonly data?: Record<string, unknown>;
    readonly lastSeenAt?: string;
  },
): Promise<void> {
  const timestamp = input.lastSeenAt ?? "2026-07-14T00:00:00.000Z";
  await db.insert(schema.notificationPushers).values({
    id: input.id,
    accountId: "user-1",
    product: "takos",
    scope: "account:user-1",
    kind: "http",
    appId: "jp.takos.mobile",
    pushkey: input.pushkey,
    pushkeyHash: `${input.id}-hash`,
    gatewayUrl:
      input.gatewayUrl ?? "https://push.example/_matrix/push/v1/notify",
    data: JSON.stringify(
      input.data ?? { provider: "fcm", format: "event_id_only" },
    ),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastSeenAt: timestamp,
  });
}

function deliveryEnv(
  db: Database,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  overrides: Partial<Env> = {},
): Env {
  return {
    DB: db,
    TAKOS_EGRESS: { fetch: fetcher },
    TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS:
      "push.example,other.example,replacement.example",
    ...overrides,
  } as unknown as Env;
}

test("notification pusher dispatch sends an event-id-only envelope through TAKOS_EGRESS", async () => {
  const db = await freshDb();
  await insertPusher(db, { id: "pusher-1", pushkey: "device-token" });
  let outbound: Request | undefined;
  const env = deliveryEnv(db, async (input, init) => {
    outbound = new Request(input, init);
    return Response.json({ rejected: [] });
  });

  const result = await deliverNotificationToPushers(
    env,
    {
      userId: "user-1",
      notificationId: "notification-1",
      spaceId: "workspace-1",
    },
    { now: new Date("2026-07-14T12:00:00.000Z") },
  );

  expect(result).toMatchObject({
    selectedPusherCount: 1,
    dispatchedPusherCount: 1,
    gatewayBatchCount: 1,
    rejectedCount: 0,
    retryExhaustedCount: 0,
  });
  expect(outbound?.url).toBe("https://push.example/_matrix/push/v1/notify");
  expect(outbound?.headers.get("x-takos-egress-mode")).toBe(
    "notification-push",
  );
  expect(outbound?.headers.get("x-takos-space-id")).toBe("workspace-1");
  const body = (await outbound!.json()) as {
    notification: Record<string, unknown> & {
      devices: Array<
        Record<string, unknown> & { data: Record<string, unknown> }
      >;
    };
  };
  expect(Object.keys(body.notification).sort()).toEqual([
    "devices",
    "event_id",
    "room_id",
  ]);
  expect(body.notification.event_id).toBe("notification-1");
  expect(body.notification.devices).toHaveLength(1);
  expect(body.notification.devices[0]!.data).toEqual({
    provider: "fcm",
    format: "event_id_only",
  });
  expect(JSON.stringify(body)).not.toContain("gateway_url");
  expect(JSON.stringify(body)).not.toContain("title");
  expect(JSON.stringify(body)).not.toContain("body");
});

test("notification pusher dispatch fails closed without TAKOS_EGRESS", async () => {
  const db = await freshDb();
  await insertPusher(db, { id: "pusher-1", pushkey: "device-token" });

  const result = await deliverNotificationToPushers(
    {
      DB: db,
      TAKOS_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    } as unknown as Env,
    { userId: "user-1", notificationId: "notification-1" },
  );

  expect(result).toMatchObject({
    selectedPusherCount: 1,
    gatewayBatchCount: 1,
    configurationErrorCount: 1,
  });
  expect(result.batches[0]).toMatchObject({
    status: "configuration_error",
    attempts: 0,
  });
});

test("createNotification dispatches push only when the recipient enabled the push channel", async () => {
  const db = await freshDb();
  await insertPusher(db, { id: "pusher-1", pushkey: "device-token" });
  const now = "2026-07-14T00:00:00.000Z";
  await db.insert(schema.notificationPreferences).values({
    accountId: "user-1",
    type: "run.failed",
    channel: "push",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  const requests: Request[] = [];
  const env = deliveryEnv(db, async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json({ rejected: [] });
  });

  const created = await createNotification(env, {
    userId: "user-1",
    spaceId: "workspace-1",
    type: "run.failed",
    title: "Secret title that must not be pushed",
    body: "Secret body that must not be pushed",
    data: { route: "/runs/run-1" },
  });

  expect(created.notification_id).toBeString();
  expect(requests).toHaveLength(1);
  const body = await requests[0]!.json();
  expect(JSON.stringify(body)).toContain(created.notification_id!);
  expect(JSON.stringify(body)).not.toContain("Secret title");
  expect(JSON.stringify(body)).not.toContain("Secret body");
  expect(JSON.stringify(body)).not.toContain("/runs/run-1");
});

test("createNotification persists a minimal queue job instead of calling the gateway when configured", async () => {
  const db = await freshDb();
  await insertPusher(db, { id: "pusher-1", pushkey: "device-token" });
  const now = "2026-07-14T00:00:00.000Z";
  await db.insert(schema.notificationPreferences).values({
    accountId: "user-1",
    type: "run.failed",
    channel: "push",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  const queueMessages: unknown[] = [];
  let gatewayCalls = 0;
  const env = deliveryEnv(
    db,
    async () => {
      gatewayCalls += 1;
      return Response.json({ rejected: [] });
    },
    {
      TAKOS_NOTIFICATION_PUSH_QUEUE: {
        async send(message) {
          queueMessages.push(message);
        },
        async sendBatch() {},
      },
    },
  );

  const created = await createNotification(env, {
    userId: "user-1",
    spaceId: "workspace-1",
    type: "run.failed",
    title: "Queue-only title",
    body: "Queue-only body",
  });

  expect(gatewayCalls).toBe(0);
  expect(queueMessages).toEqual([
    {
      version: 1,
      notificationId: created.notification_id,
      userId: "user-1",
      scopeId: "workspace-1",
      timestamp: expect.any(Number),
    },
  ]);
  expect(JSON.stringify(queueMessages)).not.toContain("Queue-only title");
  expect(JSON.stringify(queueMessages)).not.toContain("Queue-only body");
  expect(JSON.stringify(queueMessages)).not.toContain("device-token");
});

test("createNotification falls back to bounded direct delivery when queue enqueue fails", async () => {
  const db = await freshDb();
  await insertPusher(db, { id: "pusher-1", pushkey: "device-token" });
  const now = "2026-07-14T00:00:00.000Z";
  await db.insert(schema.notificationPreferences).values({
    accountId: "user-1",
    type: "run.failed",
    channel: "push",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  let gatewayCalls = 0;
  const env = deliveryEnv(
    db,
    async () => {
      gatewayCalls += 1;
      return Response.json({ rejected: [] });
    },
    {
      TAKOS_NOTIFICATION_PUSH_QUEUE: {
        async send() {
          throw new Error("queue unavailable");
        },
        async sendBatch() {},
      },
    },
  );

  await createNotification(env, {
    userId: "user-1",
    type: "run.failed",
    title: "Fallback",
  });

  expect(gatewayCalls).toBe(1);
});

test("HTTP notification creation defers gateway delivery to waitUntil", async () => {
  const db = await freshDb();
  await insertPusher(db, { id: "pusher-1", pushkey: "device-token" });
  const now = "2026-07-14T00:00:00.000Z";
  await db.insert(schema.notificationPreferences).values({
    accountId: "user-1",
    type: "run.failed",
    channel: "push",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });

  let resolveGateway!: (response: Response) => void;
  const gatewayResponse = new Promise<Response>((resolve) => {
    resolveGateway = resolve;
  });
  const env = deliveryEnv(db, async () => gatewayResponse);
  const waitUntilTasks: Promise<unknown>[] = [];
  const executionCtx = {
    waitUntil(task: Promise<unknown>) {
      waitUntilTasks.push(task);
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  const app = new Hono<{ Bindings: Env }>().post("/notify", async (c) => {
    const result = await createNotification(
      c.env,
      {
        userId: "user-1",
        spaceId: "workspace-1",
        type: "run.failed",
        title: "Deferred notification",
      },
      {
        deferPushDelivery: (task) => c.executionCtx.waitUntil(task),
      },
    );
    return c.json(result, 201);
  });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const response = await Promise.race([
    app.fetch(
      new Request("https://takos.test/notify", { method: "POST" }),
      env,
      executionCtx,
    ),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("HTTP response waited for push gateway")),
        100,
      );
    }),
  ]).finally(() => clearTimeout(timeout));

  expect(response.status).toBe(201);
  expect(waitUntilTasks).toHaveLength(1);
  resolveGateway(Response.json({ rejected: [] }));
  await waitUntilTasks[0];
});

test("notification pusher dispatch deletes only pushkeys rejected by their gateway", async () => {
  const db = await freshDb();
  await insertPusher(db, { id: "old", pushkey: "old-token" });
  await insertPusher(db, { id: "current", pushkey: "current-token" });
  const env = deliveryEnv(db, async () =>
    Response.json({ rejected: ["old-token"] }),
  );

  const result = await deliverNotificationToPushers(env, {
    userId: "user-1",
    notificationId: "notification-1",
  });

  expect(result.rejectedCount).toBe(1);
  expect(result.deletedRejectedCount).toBe(1);
  const remaining = await db
    .select({ id: schema.notificationPushers.id })
    .from(schema.notificationPushers);
  expect(remaining).toEqual([{ id: "current" }]);
});

test("re-registering one app device on another account stops delivery to the old account", async () => {
  const db = await freshDb();
  const gatewayUrl = "https://push.example/_matrix/push/v1/notify";
  const register = (accountId: string, appId = "jp.takos.mobile") =>
    registerNotificationPusher(db, {
      accountId,
      product: "takos",
      scope: `account:${accountId}`,
      gatewayUrl,
      pusher: {
        kind: "http",
        app_id: appId,
        pushkey: "shared-device-token",
        data: { url: gatewayUrl, format: "event_id_only" },
      },
    });

  await register("old-account");
  await register("old-account", "jp.takos.other-client");
  await register("new-account");

  const deliveredAppIds: string[][] = [];
  const env = deliveryEnv(db, async (input, init) => {
    const body = (await new Request(input, init).json()) as {
      notification: { devices: Array<{ app_id: string }> };
    };
    deliveredAppIds.push(
      body.notification.devices.map((device) => device.app_id),
    );
    return Response.json({ rejected: [] });
  });
  const oldResult = await deliverNotificationToPushers(env, {
    userId: "old-account",
    notificationId: "old-notification",
  });
  const newResult = await deliverNotificationToPushers(env, {
    userId: "new-account",
    notificationId: "new-notification",
  });

  expect(oldResult.selectedPusherCount).toBe(1);
  expect(newResult.selectedPusherCount).toBe(1);
  expect(deliveredAppIds).toEqual([
    ["jp.takos.other-client"],
    ["jp.takos.mobile"],
  ]);
  const rows = await db
    .select({
      accountId: schema.notificationPushers.accountId,
      appId: schema.notificationPushers.appId,
    })
    .from(schema.notificationPushers);
  expect(rows.sort((a, b) => a.accountId.localeCompare(b.accountId))).toEqual([
    { accountId: "new-account", appId: "jp.takos.mobile" },
    { accountId: "old-account", appId: "jp.takos.other-client" },
  ]);
});

test("concurrent cross-account registration leaves one atomic app-token owner", async () => {
  const db = await freshDb();
  const gatewayUrl = "https://push.example/_matrix/push/v1/notify";
  const register = (accountId: string) =>
    registerNotificationPusher(db, {
      accountId,
      product: "takos",
      scope: `account:${accountId}`,
      gatewayUrl,
      pusher: {
        kind: "http",
        app_id: "jp.takos.mobile",
        pushkey: "concurrent-device-token",
        data: { url: gatewayUrl, format: "event_id_only" },
      },
    });

  await Promise.all([register("account-a"), register("account-b")]);

  const rows = await db
    .select({
      accountId: schema.notificationPushers.accountId,
      appId: schema.notificationPushers.appId,
      pushkey: schema.notificationPushers.pushkey,
    })
    .from(schema.notificationPushers);
  expect(rows).toHaveLength(1);
  expect(["account-a", "account-b"]).toContain(rows[0]!.accountId);
  expect(rows[0]).toMatchObject({
    appId: "jp.takos.mobile",
    pushkey: "concurrent-device-token",
  });
});

test("rejected cleanup preserves a concurrently re-registered pusher", async () => {
  const db = await freshDb();
  await insertPusher(db, { id: "rotated", pushkey: "device-token" });
  const replacementUrl = "https://replacement.example/_matrix/push/v1/notify";
  const replacementData = JSON.stringify({
    provider: "apns",
    format: "event_id_only",
  });
  const env = deliveryEnv(db, async () => {
    await db
      .update(schema.notificationPushers)
      .set({
        gatewayUrl: replacementUrl,
        data: replacementData,
        updatedAt: "2026-07-14T00:01:00.000Z",
        lastSeenAt: "2026-07-14T00:01:00.000Z",
      })
      .where(eq(schema.notificationPushers.id, "rotated"));
    return Response.json({ rejected: ["device-token"] });
  });

  const result = await deliverNotificationToPushers(env, {
    userId: "user-1",
    notificationId: "notification-1",
  });

  expect(result).toMatchObject({
    rejectedCount: 1,
    deletedRejectedCount: 0,
  });
  const row = await db
    .select({
      gatewayUrl: schema.notificationPushers.gatewayUrl,
      data: schema.notificationPushers.data,
    })
    .from(schema.notificationPushers)
    .where(eq(schema.notificationPushers.id, "rotated"))
    .get();
  expect(row).toEqual({ gatewayUrl: replacementUrl, data: replacementData });
});

test("partial gateway retry sends only retryable devices and keeps permanent failures", async () => {
  const db = await freshDb();
  await insertPusher(db, { id: "success", pushkey: "success-token" });
  await insertPusher(db, { id: "expired", pushkey: "expired-token" });
  await insertPusher(db, { id: "failed", pushkey: "failed-token" });
  await insertPusher(db, { id: "retry", pushkey: "retry-token" });
  const requestPushkeys: string[][] = [];
  let calls = 0;
  const env = deliveryEnv(db, async (input, init) => {
    const body = (await new Request(input, init).json()) as {
      notification: { devices: Array<{ pushkey: string }> };
    };
    requestPushkeys.push(
      body.notification.devices.map((device) => device.pushkey),
    );
    calls += 1;
    return calls === 1
      ? Response.json(
          {
            rejected: ["expired-token"],
            failed: ["failed-token"],
            retryable: ["retry-token"],
          },
          { status: 503 },
        )
      : Response.json({ rejected: [], failed: [], retryable: [] });
  });

  const result = await deliverNotificationToPushers(
    env,
    { userId: "user-1", notificationId: "notification-1" },
    { sleep: async () => undefined },
  );

  expect(requestPushkeys[0]?.sort()).toEqual([
    "expired-token",
    "failed-token",
    "retry-token",
    "success-token",
  ]);
  expect(requestPushkeys[1]).toEqual(["retry-token"]);
  expect(result).toMatchObject({
    rejectedCount: 1,
    deletedRejectedCount: 1,
    permanentFailureCount: 1,
    retryExhaustedCount: 0,
  });
  expect(result.batches[0]).toMatchObject({
    status: "permanent_failure",
    attempts: 2,
    permanentDeviceFailureCount: 1,
  });
  const remaining = await db
    .select({ id: schema.notificationPushers.id })
    .from(schema.notificationPushers);
  expect(remaining.map((row) => row.id).sort()).toEqual([
    "failed",
    "retry",
    "success",
  ]);
});

test("delivery caps legacy over-quota rows and reports truncation", async () => {
  const db = await freshDb();
  for (let index = 0; index < 41; index += 1) {
    await insertPusher(db, {
      id: `pusher-${index}`,
      pushkey: `token-${index}`,
    });
  }
  const batchSizes: number[] = [];
  const env = deliveryEnv(db, async (input, init) => {
    const body = (await new Request(input, init).json()) as {
      notification: { devices: unknown[] };
    };
    batchSizes.push(body.notification.devices.length);
    return Response.json({ rejected: [] });
  });

  const result = await deliverNotificationToPushers(env, {
    userId: "user-1",
    notificationId: "notification-1",
  });

  expect(result).toMatchObject({
    selectedPusherCount: 16,
    selectionTruncated: true,
    gatewayBatchCount: 1,
  });
  expect(batchSizes).toEqual([16]);
});

test("notification pusher dispatch retries only transient gateway failures with a bounded backoff", async () => {
  const db = await freshDb();
  await insertPusher(db, { id: "pusher-1", pushkey: "device-token" });
  const statuses = [503, 429, 200];
  const delays: number[] = [];
  let calls = 0;
  const env = deliveryEnv(
    db,
    async () => {
      const status = statuses[calls++]!;
      return status === 200
        ? Response.json({ rejected: [] })
        : new Response("unavailable", { status });
    },
    { TAKOS_NOTIFICATION_PUSH_MAX_ATTEMPTS: "5" },
  );

  const result = await deliverNotificationToPushers(
    env,
    { userId: "user-1", notificationId: "notification-1" },
    { sleep: async (delay) => void delays.push(delay) },
  );

  expect(calls).toBe(3);
  expect(delays).toEqual([100, 200]);
  expect(result.batches[0]).toMatchObject({
    status: "delivered",
    attempts: 3,
  });
});

test("single-attempt queue delivery exposes a bounded gateway Retry-After", async () => {
  const db = await freshDb();
  await insertPusher(db, { id: "pusher-1", pushkey: "device-token" });
  let calls = 0;
  const env = deliveryEnv(db, async () => {
    calls += 1;
    return Response.json(
      { rejected: [], retryable: ["device-token"] },
      { status: 429, headers: { "Retry-After": "120" } },
    );
  });

  const result = await deliverNotificationToPushers(
    env,
    { userId: "user-1", notificationId: "notification-1" },
    { maxAttempts: 1 },
  );

  expect(calls).toBe(1);
  expect(result).toMatchObject({
    retryExhaustedCount: 1,
    retryAfterSeconds: 120,
  });
  expect(result.batches[0]).toMatchObject({
    status: "retry_exhausted",
    retryAfterSeconds: 120,
  });
});

test("notification pusher dispatch does not retry permanent gateway failures", async () => {
  const db = await freshDb();
  await insertPusher(db, { id: "pusher-1", pushkey: "device-token" });
  let calls = 0;
  const env = deliveryEnv(db, async () => {
    calls += 1;
    return new Response("bad request", { status: 400 });
  });

  const result = await deliverNotificationToPushers(
    env,
    { userId: "user-1", notificationId: "notification-1" },
    { sleep: async () => undefined },
  );

  expect(calls).toBe(1);
  expect(result.permanentFailureCount).toBe(1);
  expect(result.batches[0]).toMatchObject({
    status: "permanent_failure",
    failureKind: "permanent",
    responseStatus: 400,
  });
});

test("gateway bearer is sent only to the exact configured canonical URL", async () => {
  const db = await freshDb();
  await insertPusher(db, {
    id: "official",
    pushkey: "official-token",
    gatewayUrl: "https://push.example/_matrix/push/v1/notify",
  });
  await insertPusher(db, {
    id: "client-owned",
    pushkey: "client-token",
    gatewayUrl: "https://other.example/_matrix/push/v1/notify",
  });
  const authorizations = new Map<string, string | null>();
  const env = deliveryEnv(
    db,
    async (input, init) => {
      const request = new Request(input, init);
      authorizations.set(request.url, request.headers.get("authorization"));
      return Response.json({ rejected: [] });
    },
    {
      TAKOS_NOTIFICATION_PUSH_GATEWAY_URL:
        "https://push.example/_matrix/push/v1/notify",
      TAKOS_NOTIFICATION_PUSH_GATEWAY_TOKEN: "host-bearer",
    },
  );

  await deliverNotificationToPushers(env, {
    userId: "user-1",
    notificationId: "notification-1",
  });

  expect(
    authorizations.get("https://push.example/_matrix/push/v1/notify"),
  ).toBe("Bearer host-bearer");
  expect(
    authorizations.get("https://other.example/_matrix/push/v1/notify"),
  ).toBeNull();
});

test("gateway URL validation rejects private, insecure, credentialed, and disallowed targets", () => {
  for (const url of [
    "http://push.example/_matrix/push/v1/notify",
    "https://127.0.0.1/_matrix/push/v1/notify",
    "https://metadata.google.internal/_matrix/push/v1/notify",
    "https://user:password@push.example/_matrix/push/v1/notify",
    "https://push.example:8443/_matrix/push/v1/notify",
  ]) {
    expect(validateNotificationPushGatewayUrl(url).ok).toBe(false);
  }
  expect(
    validateNotificationPushGatewayUrl(
      "https://push.example/_matrix/push/v1/notify",
      { allowedHosts: "allowed.example" },
    ).ok,
  ).toBe(false);
  expect(
    validateNotificationPushGatewayUrl(
      "https://mobile.push.example/_matrix/push/v1/notify",
      { allowedHosts: "*.push.example" },
    ).ok,
  ).toBe(true);

  for (const url of [
    "http://localhost:8787/_matrix/push/v1/notify",
    "http://127.0.0.1:8787/_matrix/push/v1/notify",
    "http://[::1]:8787/_matrix/push/v1/notify",
  ]) {
    expect(validateNotificationPushGatewayUrl(url).ok).toBe(false);
    expect(
      validateNotificationPushGatewayUrl(url, {
        allowInsecureLoopback: true,
      }).ok,
    ).toBe(true);
  }
  for (const url of [
    "http://public.example:8787/_matrix/push/v1/notify",
    "http://user:password@localhost:8787/_matrix/push/v1/notify",
    "http://localhost:8787/_matrix/push/v1/notify#secret",
    "http://localhost:0/_matrix/push/v1/notify",
    "https://public.example:8443/_matrix/push/v1/notify",
  ]) {
    expect(
      validateNotificationPushGatewayUrl(url, {
        allowInsecureLoopback: true,
      }).ok,
    ).toBe(false);
  }
});

test("delivery permits HTTP loopback only behind the explicit development flag", async () => {
  const db = await freshDb();
  await insertPusher(db, {
    id: "loopback",
    pushkey: "device-token",
    gatewayUrl: "http://127.0.0.1:8787/_matrix/push/v1/notify",
  });
  let calls = 0;
  const authorizations: Array<string | null> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    authorizations.push(new Request(input, init).headers.get("authorization"));
    return Response.json({ rejected: [] });
  };

  const blocked = await deliverNotificationToPushers(deliveryEnv(db, fetcher), {
    userId: "user-1",
    notificationId: "notification-1",
  });
  expect(blocked).toMatchObject({
    dispatchedPusherCount: 0,
    skippedInvalidPusherCount: 1,
  });

  const allowed = await deliverNotificationToPushers(
    deliveryEnv(db, fetcher, {
      TAKOS_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK: "true",
      TAKOS_NOTIFICATION_PUSH_GATEWAY_URL:
        "http://127.0.0.1:8787/_matrix/push/v1/notify",
      TAKOS_NOTIFICATION_PUSH_GATEWAY_TOKEN: "must-not-cross-cleartext",
    }),
    { userId: "user-1", notificationId: "notification-2" },
  );
  expect(allowed).toMatchObject({
    dispatchedPusherCount: 1,
    skippedInvalidPusherCount: 0,
  });
  expect(calls).toBe(1);
  expect(authorizations).toEqual([null]);
});

test("stale notification pusher retention is bounded and keeps recent registrations", async () => {
  const db = await freshDb();
  await insertPusher(db, {
    id: "stale-1",
    pushkey: "stale-token-1",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
  });
  await insertPusher(db, {
    id: "stale-2",
    pushkey: "stale-token-2",
    lastSeenAt: "2026-02-01T00:00:00.000Z",
  });
  await insertPusher(db, {
    id: "recent",
    pushkey: "recent-token",
    lastSeenAt: "2026-07-01T00:00:00.000Z",
  });

  const first = await pruneStaleNotificationPushers(
    {
      DB: db,
      TAKOS_NOTIFICATION_PUSH_RETENTION_DAYS: "90",
    } as unknown as Pick<Env, "DB" | "TAKOS_NOTIFICATION_PUSH_RETENTION_DAYS">,
    { now: new Date("2026-07-14T00:00:00.000Z"), batchSize: 1 },
  );
  expect(first).toMatchObject({ selected: 1, deleted: 1, hasMore: true });
  const second = await pruneStaleNotificationPushers(
    {
      DB: db,
      TAKOS_NOTIFICATION_PUSH_RETENTION_DAYS: "90",
    } as unknown as Pick<Env, "DB" | "TAKOS_NOTIFICATION_PUSH_RETENTION_DAYS">,
    { now: new Date("2026-07-14T00:00:00.000Z"), batchSize: 10 },
  );
  expect(second).toMatchObject({ selected: 1, deleted: 1, hasMore: false });
  const remaining = await db
    .select({ id: schema.notificationPushers.id })
    .from(schema.notificationPushers);
  expect(remaining).toEqual([{ id: "recent" }]);
});

test("gateway status classification keeps transient and permanent failures distinct", () => {
  expect(classifyNotificationPushGatewayStatus(408)).toBe("retryable");
  expect(classifyNotificationPushGatewayStatus(429)).toBe("retryable");
  expect(classifyNotificationPushGatewayStatus(503)).toBe("retryable");
  expect(classifyNotificationPushGatewayStatus(400)).toBe("permanent");
  expect(classifyNotificationPushGatewayStatus(401)).toBe("permanent");
});

test("Retry-After parsing accepts seconds and HTTP dates within the queue delay bound", () => {
  const now = new Date("2026-07-14T12:00:00.000Z");
  expect(parseNotificationPushRetryAfter("60", now)).toBe(60);
  expect(
    parseNotificationPushRetryAfter("Tue, 14 Jul 2026 12:02:00 GMT", now),
  ).toBe(120);
  expect(
    parseNotificationPushRetryAfter("Tue, 14 Jul 2026 11:59:00 GMT", now),
  ).toBe(1);
  expect(parseNotificationPushRetryAfter("999999999999999999", now)).toBe(
    86_400,
  );
  expect(parseNotificationPushRetryAfter("not-a-date", now)).toBeUndefined();
});
