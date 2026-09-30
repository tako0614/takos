import { expect, test } from "bun:test";

import {
  buildRunEventSegmentKey,
  readRunEventSegmentFromR2,
  writeRunEventSegmentToR2,
} from "../../application/services/offload/run-events.ts";
import { createInMemoryObjectStore } from "../../local-platform/in-memory-r2.ts";
import { NotificationNotifierDO } from "./notification-notifier.ts";
import { RunNotifierDO } from "./run-notifier.ts";

type StorageFixture = ReturnType<typeof createDurableObjectState>;
type Notifier = RunNotifierDO | NotificationNotifierDO;
type Factory = (state: StorageFixture["binding"]) => Notifier;

function createDurableObjectState(values = new Map<string, unknown>()) {
  const calls = {
    get: 0,
    put: 0,
    setAlarm: 0,
    acceptWebSocket: 0,
    getWebSockets: 0,
    getTags: 0,
  };
  let pending: Promise<unknown> = Promise.resolve();
  let queue: Promise<unknown> = Promise.resolve();
  const state = {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        calls.get++;
        const value = values.get(key);
        return value === undefined ? undefined : structuredClone(value) as T;
      },
      async put(keyOrEntries: string | Record<string, unknown>, value?: unknown) {
        calls.put++;
        if (typeof keyOrEntries === "string") {
          values.set(keyOrEntries, structuredClone(value));
        } else {
          for (const [key, entry] of Object.entries(keyOrEntries)) {
            values.set(key, structuredClone(entry));
          }
        }
      },
      async setAlarm() {
        calls.setAlarm++;
      },
      async getAlarm() {
        return null;
      },
    },
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const operation = queue.then(callback);
      queue = operation.then(() => undefined, () => undefined);
      pending = operation;
      return operation;
    },
    getWebSockets() {
      calls.getWebSockets++;
      return [] as WebSocket[];
    },
    getTags(_socket: WebSocket) {
      calls.getTags++;
      return [];
    },
    acceptWebSocket(_socket: WebSocket, _tags?: string[]) {
      calls.acceptWebSocket++;
    },
  };
  return {
    binding: state as never,
    values,
    calls,
    ready: () => pending,
  };
}

function createR2Spy() {
  const inner = createInMemoryObjectStore();
  let writes = 0;
  const bucket = new Proxy(inner, {
    get(target, property, receiver) {
      if (property === "put") {
        return (...args: Parameters<typeof target.put>) => {
          writes++;
          return target.put(...args);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { bucket, inner, writes: () => writes };
}

function createSqlSpy() {
  let calls = 0;
  const db = new Proxy({}, {
    get(_target, property) {
      calls++;
      throw new Error(`unexpected SQL access: ${String(property)}`);
    },
  });
  return { db, calls: () => calls };
}

function createFactories(bucket = createR2Spy().bucket) {
  const sql = createSqlSpy();
  return {
    sql,
    run: (state: StorageFixture["binding"]) =>
      new RunNotifierDO(state, {
        DB: sql.db,
        TAKOS_OFFLOAD: bucket,
      } as never),
    notification: (state: StorageFixture["binding"]) =>
      new NotificationNotifierDO(state),
  };
}

const validRingEvent = (id: number) => ({
  id,
  type: "run.progress",
  data: { sequence: id },
  timestamp: Date.parse("2026-09-30T12:00:00.000Z") + id,
});

const validRunState = (overrides: Record<string, unknown> = {}) => ({
  eventBuffer: [],
  eventIdCounter: 0,
  runId: "run-legacy_1",
  ...overrides,
});

const invalidRunStates: Array<{ name: string; state: unknown }> = [
  { name: "null state", state: null },
  { name: "false state", state: false },
  { name: "zero state", state: 0 },
  { name: "empty-string state", state: "" },
  { name: "object-like array state", state: [] },
  { name: "missing event ring", state: { eventIdCounter: 0, runId: null } },
  { name: "null event ring", state: validRunState({ eventBuffer: null }) },
  { name: "non-object ring entry", state: validRunState({ eventBuffer: ["leak-ring"] }) },
  {
    name: "ring event with missing data",
    state: validRunState({ eventIdCounter: 1, eventBuffer: [{ id: 1, type: "run.progress", timestamp: 1 }] }),
  },
  { name: "negative counter", state: validRunState({ eventIdCounter: -1 }) },
  { name: "fractional counter", state: validRunState({ eventIdCounter: 1.5 }) },
  { name: "unsafe counter", state: validRunState({ eventIdCounter: Number.MAX_SAFE_INTEGER + 1 }) },
  { name: "unordered ring IDs", state: validRunState({ eventIdCounter: 2, eventBuffer: [validRingEvent(2), validRingEvent(1)] }) },
  { name: "duplicate ring IDs", state: validRunState({ eventIdCounter: 2, eventBuffer: [validRingEvent(1), validRingEvent(1)] }) },
  { name: "ring ID ahead of counter", state: validRunState({ eventIdCounter: 1, eventBuffer: [validRingEvent(2)] }) },
  { name: "wrong run ID type", state: validRunState({ runId: false }) },
  { name: "invalid run ID shape", state: validRunState({ runId: "bad/run" }) },
  { name: "invalid R2 segment index", state: validRunState({ r2SegmentIndex: 0 }) },
  { name: "R2 segment index ahead of sequence", state: validRunState({ r2SegmentIndex: 2 }) },
  { name: "R2 watermark ahead of sequence", state: validRunState({ r2LastFlushedSegmentIndex: 1 }) },
  { name: "archived events without a run identity", state: validRunState({ eventIdCounter: 1, runId: null, r2LastFlushedSegmentIndex: 1 }) },
  { name: "archived usage without a run identity", state: validRunState({ runId: null, usageLastFlushedSegmentIndex: 1 }) },
  { name: "invalid usage segment index", state: validRunState({ usageSegmentIndex: 1.25 }) },
  { name: "usage watermark ahead of live index", state: validRunState({ usageLastFlushedSegmentIndex: 2 }) },
  { name: "usage live index already closed", state: validRunState({ usageLastFlushedSegmentIndex: 1 }) },
  {
    name: "pending event with non-ISO timestamp",
    state: validRunState({ eventIdCounter: 1, r2SegmentBuffer: [
      { event_id: 1, type: "run.progress", data: "{}", created_at: "t-event-151" },
    ] }),
  },
  { name: "invalid R2 buffer entry", state: validRunState({ r2SegmentBuffer: [{ event_id: 1, type: "x", created_at: "not-date" }] }) },
  { name: "invalid usage buffer entry", state: validRunState({ usageSegmentBuffer: [{ meter_type: " ", units: 1, created_at: "2026-09-30T12:00:00.000Z" }] }) },
  { name: "invalid dedup pair", state: validRunState({ emitDedupKeys: [["dedup-key", Number.NaN]] }) },
  { name: "duplicate dedup pair", state: validRunState({ emitDedupKeys: [["same", 1], ["same", 2]] }) },
  { name: "unknown schema version", state: validRunState({ schemaVersion: 2 }) },
  { name: "unknown future field", state: validRunState({ futureShape: "leak-future" }) },
];

const invalidNotificationStates: Array<{ name: string; state: unknown }> = [
  { name: "null state", state: null },
  { name: "false state", state: false },
  { name: "zero state", state: 0 },
  { name: "empty-string state", state: "" },
  { name: "array state", state: [] },
  { name: "missing event ring", state: { eventIdCounter: 0, userId: null } },
  { name: "missing event counter", state: { eventBuffer: [], userId: null } },
  { name: "null event ring", state: { eventBuffer: null, eventIdCounter: 0, userId: null } },
  { name: "unsafe counter", state: { eventBuffer: [], eventIdCounter: Number.MAX_SAFE_INTEGER + 1, userId: null } },
  { name: "event with invalid type", state: { eventBuffer: [{ id: 1, type: "", data: {}, timestamp: 1 }], eventIdCounter: 1, userId: null } },
  { name: "event with invalid timestamp", state: { eventBuffer: [{ id: 1, type: "event", data: {}, timestamp: Number.NaN }], eventIdCounter: 1, userId: null } },
  { name: "invalid user identity", state: { eventBuffer: [], eventIdCounter: 0, userId: "" } },
  { name: "unknown schema version", state: { eventBuffer: [], eventIdCounter: 0, userId: null, schemaVersion: 2 } },
  { name: "unknown future field", state: { eventBuffer: [], eventIdCounter: 0, userId: null, futureShape: "leak-future" } },
];

const methodsThatRequireReadiness = (notifier: Notifier) => [
  () => notifier.fetch(new Request("https://notifier.test/emit", { method: "POST", body: JSON.stringify({ type: "test.event", data: { secret: "payload-leak" }, event_id: 100 }) })),
  () => notifier.fetch(new Request("https://notifier.test/events")),
  () => notifier.fetch(new Request("https://notifier.test/state")),
  () => notifier.fetch(new Request("https://notifier.test/usage", { method: "POST", body: JSON.stringify({ meter_type: "tokens", units: 1 }) })),
  () => notifier.fetch(new Request("https://notifier.test/websocket", { headers: { Upgrade: "websocket", "X-WS-Auth-Validated": "true", "X-WS-User-Id": "user-1", "X-WS-Run-Id": "run-legacy_1" } })),
  () => notifier.alarm(),
  () => notifier.webSocketMessage(socket, "ping"),
  () => notifier.webSocketClose(socket),
  () => notifier.webSocketError(socket, new Error("socket-error-leak")),
];

const socketCalls = { send: 0, close: 0 };
const socket = {
  send(_message: string | ArrayBuffer) { socketCalls.send++; },
  close(_code?: number, _reason?: string) { socketCalls.close++; },
} as never;

async function expectQuarantined(
  factory: Factory,
  rawState: unknown,
  sqlCalls: () => number,
  r2: ReturnType<typeof createR2Spy>,
) {
  socketCalls.send = 0;
  socketCalls.close = 0;
  const storageValues = new Map<string, unknown>([["bufferState", rawState]]);
  const durable = createDurableObjectState(storageValues);
  const notifier = factory(durable.binding);
  // A pre-existing hibernated socket makes alarm/message behavior observable.
  (notifier.connections as Map<string, typeof socket>).set("sentinel", socket);

  let readinessError: unknown;
  try {
    await durable.ready();
  } catch (error) {
    readinessError = error;
  }
  expect(readinessError).toBeInstanceOf(Error);
  const errorMessage = (readinessError as Error).message;
  expect(errorMessage).not.toContain("payload-leak");
  expect(errorMessage).not.toContain("leak-ring");
  expect(errorMessage).not.toContain("leak-future");
  const errorCalls = [
    ...methodsThatRequireReadiness(notifier),
  ];
  for (const invoke of errorCalls) {
    await expect(invoke()).rejects.toBe(readinessError);
  }

  expect(socketCalls.send).toBe(0);
  expect(socketCalls.close).toBe(0);
  expect(durable.calls.put).toBe(0);
  expect(durable.calls.setAlarm).toBe(0);
  expect(durable.calls.acceptWebSocket).toBe(0);
  expect(sqlCalls()).toBe(0);
  expect(r2.writes()).toBe(0);
  expect(durable.values.get("bufferState")).toEqual(rawState);
}

for (const invalid of invalidRunStates) {
  test(`RunNotifierDO rejects ${invalid.name} before side effects`, async () => {
    const r2 = createR2Spy();
    const { run, sql } = createFactories(r2.bucket);
    await expectQuarantined(run, invalid.state, sql.calls, r2);
  });
}

for (const invalid of invalidNotificationStates) {
  test(`NotificationNotifierDO rejects ${invalid.name} before side effects`, async () => {
    const r2 = createR2Spy();
    const { notification, sql } = createFactories(r2.bucket);
    await expectQuarantined(notification, invalid.state, sql.calls, r2);
  });
}

test("RunNotifierDO rejects legacy corruption without overwriting an existing compressed 100-event archive", async () => {
  const r2 = createR2Spy();
  const archivedEvents = Array.from({ length: 100 }, (_, index) => ({
    event_id: index + 1,
    type: "run.progress",
    data: JSON.stringify({ sequence: index + 1 }),
    created_at: new Date(Date.UTC(2026, 8, 30, 12, 0, index)).toISOString(),
  }));
  await writeRunEventSegmentToR2(r2.inner, "run-legacy_1", 1, archivedEvents);
  const key = buildRunEventSegmentKey("run-legacy_1", 1);
  const before = await (await r2.inner.get(key))!.arrayBuffer();
  // The old permissive loader ignored unknown shape metadata. Emitting event
  // 100 then rewrote immutable segment 1 even though its 100 archived events
  // were already present.
  const corrupt = validRunState({
    eventIdCounter: 99,
    futureShape: "archive-sentinel",
  });
  const { run, sql } = createFactories(r2.bucket);
  await expectQuarantined(run, corrupt, sql.calls, r2);
  const after = await (await r2.inner.get(key))!.arrayBuffer();
  expect(Array.from(new Uint8Array(after))).toEqual(Array.from(new Uint8Array(before)));
  expect((await readRunEventSegmentFromR2(r2.inner, "run-legacy_1", 1))?.length).toBe(100);
  expect(r2.writes()).toBe(0);
});

async function expectReady(factory: Factory, stored: unknown) {
  const durable = createDurableObjectState(new Map([["bufferState", stored]]));
  const notifier = factory(durable.binding);
  await durable.ready();
  const state = await notifier.fetch(new Request("https://notifier.test/state"));
  expect(state.status).toBe(200);
  return { durable, notifier };
}

test("both notifier classes accept legacy optional fields omitted and resume after persisted schemaVersion 1", async () => {
  const { run, notification } = createFactories();
  const legacyRun = await expectReady(run, {
    eventBuffer: [validRingEvent(1)],
    eventIdCounter: 1,
    runId: null,
  });
  expect((await legacyRun.notifier.fetch(new Request("https://notifier.test/events"))).status).toBe(200);
  const versionedRun = await expectReady(run, {
    schemaVersion: 1,
    eventBuffer: [validRingEvent(2)],
    eventIdCounter: 2,
    runId: "run-legacy_1",
    r2SegmentIndex: 1,
    r2SegmentBuffer: [],
    r2LastFlushedSegmentIndex: 0,
    usageSegmentIndex: 1,
    usageSegmentBuffer: [],
    usageLastFlushedSegmentIndex: 0,
    emitDedupKeys: [],
  });
  const runState = await versionedRun.notifier.fetch(new Request("https://notifier.test/state"));
  expect(await runState.json()).toMatchObject({ lastEventId: 2, runId: "run-legacy_1" });
  const runEmit = await versionedRun.notifier.fetch(new Request("https://notifier.test/emit", {
    method: "POST",
    body: JSON.stringify({ type: "run.progress", data: { sequence: 3 }, event_id: 3 }),
  }));
  expect(runEmit.status).toBe(200);
  expect(versionedRun.durable.values.get("bufferState")).toMatchObject({ schemaVersion: 1, eventIdCounter: 3 });
  const resumedRun = await expectReady(run, versionedRun.durable.values.get("bufferState"));
  const resumedRunEvents = await resumedRun.notifier.fetch(new Request("https://notifier.test/events?after=2"));
  expect(await resumedRunEvents.json()).toMatchObject({ lastEventId: 3, events: [{ id: 3 }] });

  const legacyNotification = await expectReady(notification, {
    eventBuffer: [validRingEvent(1)],
    eventIdCounter: 1,
    userId: null,
  });
  expect((await legacyNotification.notifier.fetch(new Request("https://notifier.test/events"))).status).toBe(200);
  const versionedNotification = await expectReady(notification, {
    schemaVersion: 1,
    eventBuffer: [validRingEvent(2)],
    eventIdCounter: 2,
    userId: "user-1",
  });
  const notificationState = await versionedNotification.notifier.fetch(new Request("https://notifier.test/state"));
  expect(await notificationState.json()).toMatchObject({ lastEventId: 2, userId: "user-1" });
  const notificationEmit = await versionedNotification.notifier.fetch(new Request("https://notifier.test/emit", {
    method: "POST",
    body: JSON.stringify({ type: "notification.created", data: { sequence: 3 }, event_id: 3 }),
  }));
  expect(notificationEmit.status).toBe(200);
  expect(versionedNotification.durable.values.get("bufferState")).toMatchObject({ schemaVersion: 1, eventIdCounter: 3 });
  const resumedNotification = await expectReady(notification, versionedNotification.durable.values.get("bufferState"));
  const resumedNotificationEvents = await resumedNotification.notifier.fetch(new Request("https://notifier.test/events?after=2"));
  expect(await resumedNotificationEvents.json()).toMatchObject({ lastEventId: 3, events: [{ id: 3 }] });
});

test("RunNotifierDO accepts a valid legacy closed segment index with pending IDs 151 through 199", async () => {
  const { run } = createFactories();
  const stored = {
    eventBuffer: [],
    eventIdCounter: 199,
    runId: "run-legacy_1",
    r2SegmentIndex: 2,
    r2SegmentBuffer: Array.from({ length: 49 }, (_, index) => ({
      event_id: index + 151,
      type: "run.progress",
      data: JSON.stringify({ sequence: index + 151 }),
      created_at: new Date(Date.UTC(2026, 8, 30, 12, 0, index)).toISOString(),
    })),
    r2LastFlushedSegmentIndex: 2,
  };
  const { notifier } = await expectReady(run, stored);
  const events = await notifier.fetch(new Request("https://notifier.test/events"));
  expect(events.status).toBe(200);
  expect(await events.json()).toMatchObject({ lastEventId: 199, events: [] });
});

test("both notifier writers reject unsafe IDs and exhausted counters before mutation", async () => {
  const { run, notification, sql } = createFactories();
  for (const [factory, identity] of [
    [run, { runId: "run-legacy_1" }],
    [notification, { userId: "user-1" }],
  ] as const) {
    for (const [counter, preferred, status] of [
      [0, Number.MAX_SAFE_INTEGER + 1, 400],
      [Number.MAX_SAFE_INTEGER, 1, 503],
    ] as const) {
      const { durable, notifier } = await expectReady(factory, {
        eventBuffer: [], eventIdCounter: counter, ...identity,
      });
      const before = structuredClone(durable.values.get("bufferState"));
      const response = await notifier.fetch(new Request("https://notifier.test/emit", {
        method: "POST", body: JSON.stringify({ type: "run.progress", data: {}, event_id: preferred }),
      }));
      expect(response.status).toBe(status);
      expect(durable.calls.put).toBe(0);
      expect(durable.values.get("bufferState")).toEqual(before);
      expect(sql.calls()).toBe(0);
    }
  }
});

test("RunNotifier usage rejects wrong identities and invalid units without binding a new run", async () => {
  const r2 = createR2Spy();
  const { run, sql } = createFactories(r2.bucket);
  for (const input of [
    { initialRun: "run-legacy_1", runId: "other-run", units: 1, status: 409 },
    { initialRun: null, runId: "bad/run", units: 1, status: 400 },
    { initialRun: null, runId: "valid-run", units: 0, status: 200 },
  ]) {
    const { durable, notifier } = await expectReady(run, validRunState({ runId: input.initialRun }));
    const before = structuredClone(durable.values.get("bufferState"));
    const response = await notifier.fetch(new Request("https://notifier.test/usage", {
      method: "POST", body: JSON.stringify({ runId: input.runId, meter_type: "tokens", units: input.units }),
    }));
    expect(response.status).toBe(input.status);
    expect(await response.json()).toMatchObject({ success: false });
    expect(durable.calls.put).toBe(0);
    expect(durable.values.get("bufferState")).toEqual(before);
    const readback = await notifier.fetch(new Request("https://notifier.test/state"));
    expect(await readback.json()).toMatchObject({ runId: input.initialRun });
  }
  expect(r2.writes()).toBe(0);
  expect(sql.calls()).toBe(0);
});

test("an exhausted usage index rejects before accepting or dropping usage", async () => {
  const r2 = createR2Spy();
  const { run } = createFactories(r2.bucket);
  const { durable, notifier } = await expectReady(run, validRunState({ usageSegmentIndex: Number.MAX_SAFE_INTEGER }));
  const before = structuredClone(durable.values.get("bufferState"));
  const response = await notifier.fetch(new Request("https://notifier.test/usage", {
    method: "POST", body: JSON.stringify({ meter_type: "tokens", units: 1 }),
  }));
  expect(response.status).toBe(503);
  expect(durable.calls.put).toBe(0);
  expect(durable.values.get("bufferState")).toEqual(before);
  expect(r2.writes()).toBe(0);
});

test("a terminal emit preserves pending usage at an exhausted index before event allocation", async () => {
  const r2 = createR2Spy();
  const { run, sql } = createFactories(r2.bucket);
  const { durable, notifier } = await expectReady(run, validRunState({
    usageSegmentIndex: Number.MAX_SAFE_INTEGER,
    usageSegmentBuffer: [{ meter_type: "tokens", units: 1, created_at: "2026-09-30T12:00:00.000Z" }],
  }));
  const before = structuredClone(durable.values.get("bufferState"));
  const response = await notifier.fetch(new Request("https://notifier.test/emit", {
    method: "POST", body: JSON.stringify({ type: "completed", data: {}, event_id: 1 }),
  }));
  expect(response.status).toBe(503);
  expect(durable.calls.put).toBe(0);
  expect(durable.values.get("bufferState")).toEqual(before);
  expect(r2.writes()).toBe(0);
  expect(sql.calls()).toBe(0);
  const readback = await notifier.fetch(new Request("https://notifier.test/state"));
  expect(await readback.json()).toMatchObject({ lastEventId: 0 });
});
