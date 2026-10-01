import assert from "node:assert/strict";
import { test } from "bun:test";

import type { DurableObjectStateBinding } from "../../shared/types/bindings.ts";
import { loadNotifierSnapshot, persistNotifierSnapshot } from "./notifier-journal.ts";
import { NotificationNotifierDO } from "./notification-notifier.ts";

type PutHook = (key: string, value: unknown) => Promise<void> | void;

function createState(
  values = new Map<string, unknown>(),
  hooks: { beforePut?: PutHook; afterPut?: PutHook } = {},
) {
  let queue: Promise<unknown> = Promise.resolve();
  let initialized: Promise<unknown> = Promise.resolve();
  let writes = 0;
  let alarmsScheduled = 0;
  const storage = {
    async get<T>(key: string): Promise<T | undefined> {
      const value = values.get(key);
      return value === undefined ? undefined : structuredClone(value) as T;
    },
    async put(keyOrEntries: string | Record<string, unknown>, value?: unknown): Promise<void> {
      if (typeof keyOrEntries === "string") {
        await hooks.beforePut?.(keyOrEntries, value);
        writes += 1;
        values.set(keyOrEntries, structuredClone(value));
        await hooks.afterPut?.(keyOrEntries, value);
        return;
      }
      for (const [key, entry] of Object.entries(keyOrEntries)) {
        await hooks.beforePut?.(key, entry);
        writes += 1;
        values.set(key, structuredClone(entry));
        await hooks.afterPut?.(key, entry);
      }
    },
    async delete(key: string | string[]): Promise<number> {
      const keys = Array.isArray(key) ? key : [key];
      let deleted = 0;
      for (const item of keys) if (values.delete(item)) deleted += 1;
      return deleted;
    },
    async list(options: { prefix?: string; limit?: number } = {}): Promise<Map<string, unknown>> {
      const prefix = options.prefix ?? "";
      const limit = options.limit ?? 1000;
      return new Map([...values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, limit));
    },
    async setAlarm(): Promise<void> { alarmsScheduled += 1; },
    async getAlarm(): Promise<number | null> { return null; },
  };
  const state = {
    storage,
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const operation = queue.then(callback);
      queue = operation.then(() => undefined, () => undefined);
      initialized = operation;
      return operation;
    },
    getWebSockets(): WebSocket[] { return []; },
    getTags(_socket: WebSocket): string[] { return []; },
    acceptWebSocket(_socket: WebSocket, _tags?: string[]): void {},
  };
  return {
    binding: state as unknown as DurableObjectStateBinding,
    values,
    ready: () => initialized,
    get writes() { return writes; },
    get alarmsScheduled() { return alarmsScheduled; },
  };
}

function createNotifier(options: {
  values?: Map<string, unknown>;
  hooks?: { beforePut?: PutHook; afterPut?: PutHook };
} = {}) {
  const state = createState(options.values, options.hooks);
  const notifier = new NotificationNotifierDO(state.binding);
  return {
    binding: state.binding,
    values: state.values,
    ready: state.ready,
    get writes() { return state.writes; },
    get alarmsScheduled() { return state.alarmsScheduled; },
    notifier,
  };
}

function emitRequest(input: Record<string, unknown>): Request {
  return new Request("https://notification-journal.test/emit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

function notification(notificationId: string, title = "Build finished") {
  return {
    type: "notification.new",
    data: { notification_id: notificationId, title, body: "Your build is ready" },
  };
}

test("cold alarm removes failed-stage copies without another emit or deleting accepted data", async () => {
  const values = new Map<string, unknown>([["unrelated", "retained"]]);
  let failHead = true;
  const failed = createNotifier({ values, hooks: {
    beforePut(key) {
      if (key === "bufferState" && failHead) {
        failHead = false;
        throw new Error("injected pre-commit head failure");
      }
    },
  } });
  await failed.ready();
  await assert.rejects(failed.notifier.fetch(emitRequest(notification("not-accepted"))), /pre-commit/);
  assert.equal(values.has("bufferState"), false);
  assert.ok([...values.keys()].some((key) => key.startsWith("notifier-v2/chunks/")));
  assert.ok(failed.alarmsScheduled > 0);
  const cold = createNotifier({ values });
  await cold.ready();
  await cold.notifier.alarm();
  assert.deepEqual([...values], [["unrelated", "retained"]]);

  await cold.notifier.fetch(emitRequest(notification("accepted")));
  const before = structuredClone(values);
  await cold.notifier.alarm();
  assert.deepEqual(values, before);
  const head = values.get("bufferState") as { snapshot: { chunks: string[] } };
  values.delete(`notifier-v2/chunks/${head.snapshot.chunks[0]}`);
  const corrupt = structuredClone(values);
  await assert.rejects(cold.notifier.alarm(), /chunk.encoding/);
  assert.deepEqual(values, corrupt);
});

test("cold notification receipts require one matching payload witness per replay event", async () => {
  const accepted = createNotifier();
  await accepted.ready();
  await accepted.notifier.fetch(emitRequest(notification("n-1")));
  const original = await loadNotifierSnapshot(accepted.binding.storage, "notification") as {
    emitReceipts: Array<{ key: string; digest: string; eventId: number }>;
    eventIdCounter: number;
  };
  for (const change of ["retired", "payload", "duplicate-event"] as const) {
    const invalid = structuredClone(original);
    if (change === "retired") {
      invalid.eventIdCounter = 2;
      invalid.emitReceipts[0]!.eventId = 2;
    } else if (change === "payload") {
      invalid.emitReceipts[0]!.digest = "0".repeat(64);
    } else {
      invalid.emitReceipts.push({ ...invalid.emitReceipts[0]!, key: "different-key" });
    }
    const seedState = createState();
    await persistNotifierSnapshot(seedState.binding.storage, "notification", invalid);
    const before = structuredClone(seedState.values);
    const cold = createNotifier({ values: seedState.values });
    await assert.rejects(cold.ready(), /Invalid persisted notification journal/);
    await assert.rejects(cold.notifier.fetch(emitRequest(notification("n-2"))), /Invalid persisted/);
    await assert.rejects(cold.notifier.alarm(), /Invalid persisted/);
    assert.equal(cold.writes, 0);
    assert.equal(cold.alarmsScheduled, 0);
    assert.deepEqual(seedState.values, before);
  }
});

test("a WebSocket bind head failure reloads before a queued concurrent emit", async () => {
  const values = new Map<string, unknown>();
  let resolveHeadPut!: () => void;
  const headPutEntered = new Promise<void>((resolve) => { resolveHeadPut = resolve; });
  let releaseHeadPut!: () => void;
  const release = new Promise<void>((resolve) => { releaseHeadPut = resolve; });
  let failAfterCommit = true;
  const fixture = createNotifier({ values, hooks: {
    afterPut: async (key) => {
      if (!failAfterCommit || key !== "bufferState") return;
      failAfterCommit = false;
      resolveHeadPut();
      await release;
      throw new Error("injected WebSocket bind head failure after commit");
    },
  } });
  await fixture.ready();

  const handshake = fixture.notifier.fetch(new Request("https://notification-journal.test/websocket", {
    headers: {
      Upgrade: "websocket",
      "X-WS-Auth-Validated": "true",
      "X-WS-User-Id": "principal-1",
    },
  }));
  await headPutEntered;
  const writesWhileHeld = fixture.writes;
  let emitSettled = false;
  const concurrentEmit = fixture.notifier.fetch(emitRequest(notification("n-1")))
    .then((response) => { emitSettled = true; return response; });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(emitSettled, false);
  assert.equal(fixture.writes, writesWhileHeld);
  const heldSnapshot = await loadNotifierSnapshot(fixture.binding.storage, "notification") as {
    eventIdCounter: number;
    userId: string | null;
  };
  assert.equal(heldSnapshot.eventIdCounter, 0);
  assert.equal(heldSnapshot.userId, "principal-1");

  releaseHeadPut();
  assert.equal((await handshake).status, 500);
  const emitted = await concurrentEmit;
  assert.equal(emitted.status, 200);
  assert.equal((await emitted.json() as { eventId: number }).eventId, 1);
  const current = await fixture.notifier.fetch(new Request("https://notification-journal.test/state"));
  assert.deepEqual(await current.json(), {
    eventCount: 1,
    lastEventId: 1,
    connectionCount: 0,
    userId: "principal-1",
  });
  const events = await fixture.notifier.fetch(new Request("https://notification-journal.test/events"));
  assert.deepEqual((await events.json() as { events: Array<{ event_id: string }> })
    .events.map(({ event_id }) => event_id), ["1"]);
});

test("notification IDs dedupe exactly across an ambiguous commit and cold replacement", async () => {
  const values = new Map<string, unknown>();
  let failAfterCommit = true;
  const fixture = createNotifier({ values, hooks: {
    afterPut: (key) => {
      if (failAfterCommit && key === "bufferState") {
        failAfterCommit = false;
        throw new Error("injected notification head failure after commit");
      }
    },
  } });
  await fixture.ready();
  const payload = notification("018f2f51-9a70-7dc1-8a14-0b43121b9e20");

  await assert.rejects(fixture.notifier.fetch(emitRequest({
    ...payload,
    dedup_key: "transport-key-a",
  })), /head failure after commit/);
  const sameInstanceRetry = await fixture.notifier.fetch(emitRequest({
    ...payload,
    dedup_key: "transport-key-b",
    event_id: 42,
  }));
  assert.equal(sameInstanceRetry.status, 200);
  assert.deepEqual(await sameInstanceRetry.json(), {
    success: true, duplicate: true, eventId: 1,
  });
  const conflict = await fixture.notifier.fetch(emitRequest({
    ...notification("018f2f51-9a70-7dc1-8a14-0b43121b9e20", "Different title"),
    dedup_key: "transport-key-c",
    event_id: 43,
  }));
  assert.equal(conflict.status, 409);

  const cold = createNotifier({ values: structuredClone(values) });
  await cold.ready();
  const coldRetry = await cold.notifier.fetch(emitRequest({
    ...payload,
    dedup_key: "transport-key-d",
  }));
  assert.equal(coldRetry.status, 200);
  assert.deepEqual(await coldRetry.json(), {
    success: true, duplicate: true, eventId: 1,
  });
  const secondNotification = await cold.notifier.fetch(emitRequest(notification(
    "018f2f51-9a70-7dc1-8a14-0b43121b9e21",
  )));
  assert.equal(secondNotification.status, 200);
  assert.equal((await secondNotification.json() as { eventId: number }).eventId, 2);
  const state = await cold.notifier.fetch(new Request("https://notification-journal.test/state"));
  assert.equal((await state.json() as { lastEventId: number }).lastEventId, 2);
  const events = await cold.notifier.fetch(new Request("https://notification-journal.test/events"));
  const archivedInRing = await events.json() as {
    events: Array<{ event_id: string; data: { notification_id: string } }>;
  };
  assert.deepEqual(archivedInRing.events.map(({ event_id, data }) => [event_id, data.notification_id]), [
    ["1", "018f2f51-9a70-7dc1-8a14-0b43121b9e20"],
    ["2", "018f2f51-9a70-7dc1-8a14-0b43121b9e21"],
  ]);
});

test("notification ring-buffer capacity rejects before assigning a new event ID", async () => {
  const values = new Map<string, unknown>([["bufferState", {
    schemaVersion: 1,
    eventBuffer: Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      type: "notification.new",
      data: "x".repeat(995_000),
      timestamp: index + 1,
    })),
    eventIdCounter: 8,
    userId: null,
  }]]);
  const fixture = createNotifier({ values });
  await fixture.ready();
  const writesBefore = fixture.writes;
  const before = structuredClone(values.get("bufferState"));
  const response = await fixture.notifier.fetch(emitRequest({
    type: "notification.new",
    data: { notification_id: "018f2f51-9a70-7dc1-8a14-0b43121b9e22", body: "y".repeat(800_000) },
  }));

  assert.equal(response.status, 503);
  assert.equal((await response.json() as { success: boolean }).success, false);
  const state = await fixture.notifier.fetch(new Request("https://notification-journal.test/state"));
  assert.equal((await state.json() as { lastEventId: number }).lastEventId, 8);
  assert.equal(fixture.writes, writesBefore);
  assert.deepEqual(values.get("bufferState"), before);
});

test("notification refresh receipts stay within the replay window and retired identities get a new cursor", async () => {
  const fixture = createNotifier();
  await fixture.ready();
  const notificationId = (index: number) =>
    `018f2f51-9a70-7dc1-8a14-${index.toString(16).padStart(12, "0")}`;

  for (let index = 0; index < 1_000; index += 1) {
    const response = await fixture.notifier.fetch(emitRequest(notification(notificationId(index))));
    assert.equal(response.status, 200);
  }
  const snapshot = await loadNotifierSnapshot(fixture.binding.storage, "notification") as {
    eventIdCounter: number;
    eventBuffer: Array<{ id: number }>;
    emitReceipts: Array<{ key: string; eventId: number }>;
  };
  assert.equal(snapshot.eventIdCounter, 1_000);
  assert.equal(snapshot.eventBuffer.length, 100);
  assert.equal(snapshot.eventBuffer[0]?.id, 901);
  assert.equal(snapshot.emitReceipts.length, 100);
  assert.equal(snapshot.emitReceipts[0]?.eventId, 901);
  assert.equal(snapshot.emitReceipts.at(-1)?.eventId, 1_000);

  const cold = createNotifier({ values: structuredClone(fixture.values) });
  await cold.ready();
  const retiredRetry = await cold.notifier.fetch(emitRequest({
    ...notification(notificationId(0)),
    dedup_key: "another-transport-key",
  }));
  assert.equal(retiredRetry.status, 200);
  assert.deepEqual(await retiredRetry.json(), { success: true, clients: 0, eventId: 1_001 });

  const resumed = await loadNotifierSnapshot(cold.binding.storage, "notification") as {
    eventIdCounter: number;
    eventBuffer: Array<{ id: number; data: { notification_id: string } }>;
    emitReceipts: Array<{ key: string; eventId: number }>;
  };
  assert.equal(resumed.eventIdCounter, 1_001);
  assert.equal(resumed.eventBuffer.length, 100);
  assert.equal(resumed.eventBuffer[0]?.id, 902);
  assert.equal(resumed.eventBuffer.at(-1)?.id, 1_001);
  assert.deepEqual(resumed.eventBuffer.at(-1)?.data, notification(notificationId(0)).data);
  assert.equal(resumed.emitReceipts.length, 100);
  assert.equal(resumed.emitReceipts.at(-1)?.key, `notification:${notificationId(0)}`);
  assert.equal(resumed.emitReceipts.at(-1)?.eventId, 1_001);
});
