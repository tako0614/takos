import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { test } from "bun:test";

import { gzipCompressString } from "../../shared/utils/gzip.ts";
import {
  getRunEventsAfterFromR2,
  buildRunEventSegmentKey,
  readRunEventSegmentFromR2,
} from "../../application/services/offload/run-events.ts";
import { getUsageEventsFromR2 } from "../../application/services/offload/usage-events.ts";
import type { DurableObjectStateBinding } from "../../shared/types/bindings.ts";
import { createInMemoryObjectStore } from "../../local-platform/in-memory-r2.ts";
import {
  loadNotifierSnapshot,
  persistNotifierSnapshot,
  stageNotifierBlob,
} from "./notifier-journal.ts";
import { parseRunNotifierJournalState } from "./run-notifier-journal-state.ts";
import { RunNotifierDO } from "./run-notifier.ts";

type PutHook = (key: string, value: unknown) => void | Promise<void>;

function createDurableState(
  initial = new Map<string, unknown>(),
  hooks: { beforePut?: PutHook; afterPut?: PutHook } = {},
) {
  let queue: Promise<unknown> = Promise.resolve();
  let initialized: Promise<unknown> = Promise.resolve();
  let writes = 0;
  const storage = {
    async get<T>(key: string): Promise<T | undefined> {
      const value = initial.get(key);
      return value === undefined ? undefined : structuredClone(value) as T;
    },
    async put(keyOrEntries: string | Record<string, unknown>, value?: unknown): Promise<void> {
      if (typeof keyOrEntries === "string") {
        await hooks.beforePut?.(keyOrEntries, value);
        writes += 1;
        initial.set(keyOrEntries, structuredClone(value));
        await hooks.afterPut?.(keyOrEntries, value);
        return;
      }
      for (const [key, item] of Object.entries(keyOrEntries)) {
        await hooks.beforePut?.(key, item);
        writes += 1;
        initial.set(key, structuredClone(item));
        await hooks.afterPut?.(key, item);
      }
    },
    async delete(key: string | string[]): Promise<number> {
      const keys = Array.isArray(key) ? key : [key];
      let count = 0;
      for (const item of keys) if (initial.delete(item)) count += 1;
      return count;
    },
    async list(options: { prefix?: string } = {}): Promise<Map<string, unknown>> {
      const prefix = options.prefix ?? "";
      return new Map([...initial].filter(([key]) => key.startsWith(prefix)));
    },
    async setAlarm(): Promise<void> { writes += 1; },
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
    values: initial,
    ready: () => initialized,
    get writes() { return writes; },
  };
}

function createFixture(options: {
  values?: Map<string, unknown>;
  bucket?: ReturnType<typeof createInMemoryObjectStore>;
  hooks?: { beforePut?: PutHook; afterPut?: PutHook };
} = {}) {
  const state = createDurableState(options.values, options.hooks);
  const notifier = new RunNotifierDO(state.binding, {
    DB: {
      select() {},
      insert() {},
      update() { return { set() { return { where: async () => undefined }; } }; },
      delete() {},
    } as never,
    ...(options.bucket ? { TAKOS_OFFLOAD: options.bucket } : {}),
  } as never);
  return {
    binding: state.binding,
    values: state.values,
    ready: state.ready,
    get writes() { return state.writes; },
    notifier,
    bucket: options.bucket,
  };
}

async function rawEmit(
  notifier: RunNotifierDO,
  eventId: number,
  type = "run.progress",
): Promise<Response> {
  return notifier.fetch(new Request("https://journal.test/emit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type,
      data: { sequence: eventId, payload: `event-${eventId}` },
      runId: "run-journal",
      event_id: eventId,
    }),
  }));
}

async function emit(notifier: RunNotifierDO, eventId: number, type?: string): Promise<void> {
  const response = await rawEmit(notifier, eventId, type);
  if (response.status !== 200) assert.fail(await response.text());
  const body = await response.json() as { eventId: number };
  assert.equal(body.eventId, eventId);
}

async function archivedIds(
  bucket: ReturnType<typeof createInMemoryObjectStore>,
): Promise<number[]> {
  return (await getRunEventsAfterFromR2(bucket, "run-journal", 0, 500))
    .map((event) => event.event_id);
}

async function emitThrough(
  notifier: RunNotifierDO,
  start: number,
  end: number,
  terminalIds: number[] = [],
): Promise<void> {
  for (let id = start; id <= end; id += 1) {
    await emit(notifier, id, terminalIds.includes(id) ? "completed" : "run.progress");
  }
}

test("RunNotifier reloads after head put failures before or after commit", async () => {
  for (const outcome of ["before", "after"] as const) {
    let injected = false;
    const hooks = outcome === "before"
      ? { beforePut: (key: string) => {
          if (!injected && key === "bufferState") {
            injected = true;
            throw new Error("injected head failure before commit");
          }
        } }
      : { afterPut: (key: string) => {
          if (!injected && key === "bufferState") {
            injected = true;
            throw new Error("injected head failure after commit");
          }
        } };
    const fixture = createFixture({ hooks });
    await fixture.ready();

    await assert.rejects(rawEmit(fixture.notifier, 1), /head failure/);
    assert.equal(injected, true);
    const state = await fixture.notifier.fetch(new Request("https://journal.test/state"));
    const body = await state.json() as { lastEventId: number };
    assert.equal(body.lastEventId, outcome === "before" ? 0 : 1);

    await emit(fixture.notifier, outcome === "before" ? 1 : 2);
    const afterRetry = await fixture.notifier.fetch(new Request("https://journal.test/state"));
    const recovered = await afterRetry.json() as { lastEventId: number };
    assert.equal(recovered.lastEventId, outcome === "before" ? 1 : 2);
  }
});

test("a committed archive intent survives finalization head failure and a cold replacement", async () => {
  const bucket = createInMemoryObjectStore();
  let armed = false;
  let terminalHeadPuts = 0;
  const values = new Map<string, unknown>();
  const fixture = createFixture({ values, bucket, hooks: {
    beforePut: async (key, value) => {
      if (!armed || key !== "bufferState" || !value || typeof value !== "object" ||
        (value as { schemaVersion?: unknown }).schemaVersion !== 2) return;
      terminalHeadPuts += 1;
      if (terminalHeadPuts >= 2) {
        throw new Error("injected archive finalization head failure");
      }
    },
  } });
  await fixture.ready();
  await emitThrough(fixture.notifier, 1, 99);

  armed = true;
  await emit(fixture.notifier, 100, "completed");
  assert.ok(terminalHeadPuts >= 2);
  assert.deepEqual(await readRunEventSegmentFromR2(bucket, "run-journal", 1)
    .then((events) => events?.map((event) => event.event_id)),
  Array.from({ length: 100 }, (_, index) => index + 1));
  const segmentOneKey = buildRunEventSegmentKey("run-journal", 1);
  const closedBefore = await bucket.get(segmentOneKey);
  assert.ok(closedBefore);
  const closedBytes = new Uint8Array(await closedBefore.arrayBuffer());

  const cold = createFixture({ values: structuredClone(values), bucket });
  await cold.ready();
  await emit(cold.notifier, 101);
  await emitThrough(cold.notifier, 102, 200, [150, 200]);

  const closedAfter = await bucket.get(segmentOneKey);
  assert.ok(closedAfter);
  assert.deepEqual(new Uint8Array(await closedAfter.arrayBuffer()), closedBytes);
  assert.deepEqual(await archivedIds(bucket), Array.from({ length: 200 }, (_, index) => index + 1));
  assert.deepEqual(
    (await getRunEventsAfterFromR2(bucket, "run-journal", 150, 17))
      .map((event) => event.event_id),
    Array.from({ length: 17 }, (_, index) => index + 151),
  );
  assert.deepEqual(
    (await getRunEventsAfterFromR2(bucket, "run-journal", 167, 17))
      .map((event) => event.event_id),
    Array.from({ length: 17 }, (_, index) => index + 168),
  );
  const payloads = (await getRunEventsAfterFromR2(bucket, "run-journal", 0, 500))
    .map((event) => JSON.parse(event.data) as { sequence: number; payload: string });
  assert.deepEqual(payloads.map((event) => event.sequence),
    Array.from({ length: 200 }, (_, index) => index + 1));
  assert.deepEqual(payloads.map((event) => event.payload),
    Array.from({ length: 200 }, (_, index) => `event-${index + 1}`));
});

test("an ambiguous R2 put is read back and retried without replacing an existing segment", async () => {
  const backing = createInMemoryObjectStore();
  const segmentOneKey = buildRunEventSegmentKey("run-journal", 1);
  let failedAfterPut = false;
  const bucket = new Proxy(backing, {
    get(target, property, receiver) {
      if (property === "put") {
        return async (...args: Parameters<typeof backing.put>) => {
          const result = await backing.put(...args);
          if (!failedAfterPut && args[0] === segmentOneKey) {
            failedAfterPut = true;
            throw new Error("injected ambiguous R2 put failure");
          }
          return result;
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const fixture = createFixture({ bucket });
  await fixture.ready();
  await emitThrough(fixture.notifier, 1, 99);
  await emit(fixture.notifier, 100, "completed");
  assert.equal(failedAfterPut, true);
  const afterAmbiguousWrite = await bucket.get(segmentOneKey);
  assert.ok(afterAmbiguousWrite);
  const firstBytes = new Uint8Array(await afterAmbiguousWrite.arrayBuffer());

  await emit(fixture.notifier, 101);
  await emitThrough(fixture.notifier, 102, 200, [150, 200]);

  const afterRetry = await bucket.get(segmentOneKey);
  assert.ok(afterRetry);
  assert.deepEqual(new Uint8Array(await afterRetry.arrayBuffer()), firstBytes);
  assert.deepEqual(await archivedIds(bucket), Array.from({ length: 200 }, (_, index) => index + 1));
});

test("later events committed while an R2 pump is held survive intent finalization", async () => {
  const backing = createInMemoryObjectStore();
  const segmentOneKey = buildRunEventSegmentKey("run-journal", 1);
  let hold = false;
  let resolveEntered!: () => void;
  const entered = new Promise<void>((resolve) => { resolveEntered = resolve; });
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const bucket = new Proxy(backing, {
    get(target, property, receiver) {
      if (property === "put") {
        return async (...args: Parameters<typeof backing.put>) => {
          if (hold && args[0] === segmentOneKey) {
            resolveEntered();
            await blocked;
          }
          return backing.put(...args);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const fixture = createFixture({ bucket });
  await fixture.ready();
  await emitThrough(fixture.notifier, 1, 99);
  hold = true;
  const terminal = rawEmit(fixture.notifier, 100, "completed");
  await entered;

  const later = rawEmit(fixture.notifier, 101);
  let durableCounter = 0;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await loadNotifierSnapshot(fixture.binding.storage, "run") as {
      eventIdCounter: number;
    };
    durableCounter = snapshot.eventIdCounter;
    if (durableCounter >= 101) break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(durableCounter, 101);
  release();
  assert.equal((await terminal).status, 200);
  assert.equal((await later).status, 200);
  hold = false;
  await emitThrough(fixture.notifier, 102, 200, [150, 200]);

  assert.deepEqual(await archivedIds(bucket), Array.from({ length: 200 }, (_, index) => index + 1));
});

test("missing or corrupt journal chunks reject every RunNotifier entrypoint before writes", async () => {
  for (const damage of ["missing", "corrupt"] as const) {
    const bucket = createInMemoryObjectStore();
    const seed = createFixture({ bucket });
    await seed.ready();
    await emit(seed.notifier, 1);
    const values = structuredClone(seed.values);
    const head = values.get("bufferState") as {
      snapshot: { chunks: string[] };
    };
    const chunkKey = `notifier-v2/chunks/${head.snapshot.chunks[0]}`;
    if (damage === "missing") values.delete(chunkKey);
    else values.set(chunkKey, "corrupt-not-base64");

    const cold = createFixture({ values, bucket });
    let initializationError: unknown;
    await assert.rejects(cold.ready(), (error: unknown) => {
      initializationError = error;
      return true;
    });
    assert.ok(initializationError instanceof Error);
    const before = structuredClone([...values.entries()]);
    const rejectWithInitializationError = (operation: Promise<unknown>) =>
      assert.rejects(operation, (error: unknown) => error === initializationError);
    const socket = { send(_data: string | ArrayBuffer): void {}, close(): void {} };

    await rejectWithInitializationError(cold.notifier.fetch(
      new Request("https://journal.test/state"),
    ));
    await rejectWithInitializationError(rawEmit(cold.notifier, 2));
    await rejectWithInitializationError(cold.notifier.fetch(new Request(
      "https://journal.test/usage",
      { method: "POST", body: JSON.stringify({ runId: "run-journal", meter_type: "tokens", units: 1 }) },
    )));
    await rejectWithInitializationError(cold.notifier.alarm());
    await rejectWithInitializationError(cold.notifier.webSocketMessage(socket, "ping"));
    await rejectWithInitializationError(cold.notifier.webSocketClose(socket));
    await rejectWithInitializationError(cold.notifier.webSocketError(socket, new Error("test")));

    assert.equal(cold.writes, 0);
    assert.deepEqual([...values.entries()], before);
  }
});

test("v2 refuses ownerless Run or usage pending on every write-capable cold path", async () => {
  const createdAt = new Date(Date.UTC(2026, 8, 30)).toISOString();
  for (const kind of ["run", "usage"] as const) {
    const legacy = {
      eventBuffer: [],
      eventIdCounter: kind === "run" ? 1 : 0,
      runId: null,
      r2SegmentIndex: 1,
      r2SegmentBuffer: kind === "run" ? [{
        event_id: 1, type: "run.progress", data: "{}", created_at: createdAt,
      }] : [],
      r2LastFlushedSegmentIndex: 0,
      usageSegmentIndex: 1,
      usageSegmentBuffer: kind === "usage" ? [{
        meter_type: "tokens", units: 1, reference_type: null,
        metadata: null, created_at: createdAt,
      }] : [],
      usageLastFlushedSegmentIndex: 0,
      emitDedupKeys: [],
    };
    const parsedLegacy = parseRunNotifierJournalState(legacy);
    assert.ok(parsedLegacy);
    assert.equal(parsedLegacy.runId, null);
    assert.equal(parsedLegacy.legacyPendingRunCount, kind === "run" ? 1 : 0);
    assert.equal(parsedLegacy.legacyPendingUsageCount, kind === "usage" ? 1 : 0);

    assert.throws(() => parseRunNotifierJournalState({
      ...legacy,
      schemaVersion: 2,
      r2SegmentBuffer: [],
      usageSegmentBuffer: [],
      flushIntents: [{ kind }],
      emitReceipts: [],
      usageReceipts: [],
      legacyPendingRunCount: 0,
      legacyPendingUsageCount: 0,
    }), /runId\.pending/);

    const seed = createDurableState();
    await persistNotifierSnapshot(seed.binding.storage, "run", {
      ...legacy,
      schemaVersion: 2,
      flushIntents: [],
      emitReceipts: [],
      usageReceipts: [],
      legacyPendingRunCount: 0,
      legacyPendingUsageCount: 0,
    });
    const values = structuredClone(seed.values);
    const before = structuredClone([...values.entries()]);
    const bucket = createInMemoryObjectStore();
    const cold = createFixture({ values, bucket });
    let initializationError: unknown;
    await assert.rejects(cold.ready(), (error: unknown) => {
      initializationError = error;
      return error instanceof Error && /runId\.pending/.test(error.message);
    });
    const sameFailure = (operation: Promise<unknown>) =>
      assert.rejects(operation, (error: unknown) => error === initializationError);
    await sameFailure(rawEmit(cold.notifier, 2));
    await sameFailure(cold.notifier.fetch(new Request("https://journal.test/usage", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "run-journal", meter_type: "tokens", units: 1 }),
    })));
    await sameFailure(cold.notifier.fetch(new Request("https://journal.test/state")));
    await sameFailure(cold.notifier.fetch(new Request("https://journal.test/events")));
    await sameFailure(cold.notifier.fetch(new Request("https://journal.test/state", {
      headers: { Upgrade: "websocket" },
    })));
    await sameFailure(cold.notifier.alarm());
    assert.equal(cold.writes, 0);
    assert.deepEqual([...values.entries()], before);
    assert.deepEqual((await bucket.list({ prefix: "runs/" })).objects, []);
  }
});

test("RunNotifier capacity backpressure leaves the last accepted event and pending prefix intact", async () => {
  const pending = {
    event_id: 100,
    type: "run.progress",
    data: "x".repeat(8_300_000),
    created_at: new Date(Date.UTC(2026, 8, 30, 0, 0, 0)).toISOString(),
  };
  const values = new Map<string, unknown>([["bufferState", {
    eventBuffer: [],
    eventIdCounter: 100,
    runId: "run-journal",
    r2SegmentIndex: 1,
    r2SegmentBuffer: [pending],
    r2LastFlushedSegmentIndex: 0,
    usageSegmentIndex: 1,
    usageSegmentBuffer: [],
    usageLastFlushedSegmentIndex: 0,
    emitDedupKeys: [],
  }]]);
  const fixture = createFixture({ values, bucket: createInMemoryObjectStore() });
  await fixture.ready();
  const response = await rawEmit(fixture.notifier, 101);

  assert.equal(response.status, 503);
  assert.equal((await response.json() as { success: boolean }).success, false);
  const state = await fixture.notifier.fetch(new Request("https://journal.test/state"));
  assert.equal((await state.json() as { lastEventId: number }).lastEventId, 100);
  const restored = await loadNotifierSnapshot(fixture.binding.storage, "run") as {
    eventIdCounter: number;
    r2SegmentBuffer: Array<{ event_id: number; data: string }>;
  };
  assert.equal(restored.eventIdCounter, 100);
  const archivedPrefix = await readRunEventSegmentFromR2(fixture.bucket!, "run-journal", 1);
  assert.deepEqual(archivedPrefix?.map((event) => event.event_id), [100]);
  assert.equal(archivedPrefix?.[0]?.data, pending.data);
  assert.equal(restored.r2SegmentBuffer.length, 0);
  assert.equal((await archivedIds(fixture.bucket!)).includes(101), false);
});

test("usage request IDs survive restart while distinct IDs preserve distinct entries", async () => {
  const bucket = createInMemoryObjectStore();
  const fixture = createFixture({ bucket });
  await fixture.ready();
  await emit(fixture.notifier, 1);
  const usage = (requestId: string, units = 3) => fixture.notifier.fetch(new Request(
    "https://journal.test/usage",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: "run-journal", meter_type: "tokens", units, request_id: requestId,
      }),
    },
  ));
  assert.equal((await usage("usage-a")).status, 200);
  assert.equal((await usage("usage-a")).status, 200);
  assert.equal((await usage("usage-b")).status, 200);
  assert.equal((await usage("usage-a", 4)).status, 409);

  const cold = createFixture({ values: structuredClone(fixture.values), bucket });
  await cold.ready();
  const retry = await cold.notifier.fetch(new Request("https://journal.test/usage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: "run-journal", meter_type: "tokens", units: 3, request_id: "usage-a",
    }),
  }));
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { duplicate: boolean }).duplicate, true);
  const recoveryRead = await cold.notifier.fetch(new Request("https://journal.test/state"));
  assert.equal(recoveryRead.status, 200);
  const persisted = await loadNotifierSnapshot(cold.binding.storage, "run") as {
    usageReceipts: Array<{ requestId: string }>;
    usageSegmentBuffer: Array<{ units: number }>;
  };
  assert.deepEqual(persisted.usageReceipts.map(({ requestId }) => requestId), ["usage-a", "usage-b"]);
  const archivedUsage = await getUsageEventsFromR2(bucket, "run-journal");
  assert.equal(persisted.usageSegmentBuffer.length, 0);
  assert.deepEqual(archivedUsage.map(({ units }) => units), [3, 3]);
});

test("a v2 archive intent does not finalize against different gzip bytes with the same JSONL", async () => {
  const events = Array.from({ length: 100 }, (_, index) => ({
    event_id: index + 1,
    type: "run.progress",
    data: JSON.stringify({ sequence: index + 1, payload: `same-content-${index}` }),
    created_at: new Date(Date.UTC(2026, 8, 30, 0, 0, index)).toISOString(),
  }));
  const jsonl = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const expectedBytes = await gzipCompressString(jsonl);
  const existingBytes = gzipSync(jsonl, { level: 1 });
  assert.notDeepEqual(new Uint8Array(existingBytes), new Uint8Array(expectedBytes));
  assert.equal(gunzipSync(existingBytes).toString("utf8"), jsonl);

  const values = new Map<string, unknown>();
  const state = createDurableState(values);
  const bucket = createInMemoryObjectStore();
  const segmentKey = buildRunEventSegmentKey("run-journal", 1);
  await bucket.put(segmentKey, existingBytes);
  const blob = await stageNotifierBlob(state.binding.storage, expectedBytes);
  const snapshot = {
    schemaVersion: 2,
    eventBuffer: [],
    eventIdCounter: 100,
    runId: "run-journal",
    r2SegmentIndex: 1,
    r2SegmentBuffer: events,
    r2LastFlushedSegmentIndex: 0,
    usageSegmentIndex: 1,
    usageSegmentBuffer: [],
    usageLastFlushedSegmentIndex: 0,
    emitDedupKeys: [],
    flushIntents: [{
      kind: "run", origin: "journal", segmentIndex: 1,
      key: segmentKey, count: 100, blob,
    }],
    emitReceipts: [],
    usageReceipts: [],
    legacyPendingRunCount: 0,
    legacyPendingUsageCount: 0,
  };
  await persistNotifierSnapshot(state.binding.storage, "run", snapshot, [blob]);
  const cold = createFixture({ values, bucket });
  await cold.ready();

  await cold.notifier.alarm();

  const persisted = await loadNotifierSnapshot(cold.binding.storage, "run") as {
    flushIntents: unknown[];
    r2SegmentBuffer: unknown[];
  };
  assert.equal(persisted.flushIntents.length, 1);
  assert.equal(persisted.r2SegmentBuffer.length, 100);
  const after = await bucket.get(segmentKey);
  assert.ok(after);
  assert.deepEqual(new Uint8Array(await after.arrayBuffer()), new Uint8Array(existingBytes));
  assert.deepEqual(
    (await readRunEventSegmentFromR2(bucket, "run-journal", 1))?.map((event) => event.event_id),
    Array.from({ length: 100 }, (_, index) => index + 1),
  );
});

test("legacy gzip adoption commits the exact existing bytes before archive finalization", async () => {
  const events = Array.from({ length: 100 }, (_, index) => ({
    event_id: index + 1,
    type: "run.progress",
    data: JSON.stringify({ sequence: index + 1, payload: `legacy-content-${index}` }),
    created_at: new Date(Date.UTC(2026, 8, 30, 0, 1, index)).toISOString(),
  }));
  const jsonl = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const oldCompressedBytes = gzipSync(jsonl, { level: 1 });
  const values = new Map<string, unknown>([["bufferState", {
    eventBuffer: [],
    eventIdCounter: 100,
    runId: "run-journal",
    r2SegmentIndex: 1,
    r2SegmentBuffer: events,
    r2LastFlushedSegmentIndex: 0,
    usageSegmentIndex: 1,
    usageSegmentBuffer: [],
    usageLastFlushedSegmentIndex: 0,
    emitDedupKeys: [],
  }]]);
  const bucket = createInMemoryObjectStore();
  const segmentKey = buildRunEventSegmentKey("run-journal", 1);
  await bucket.put(segmentKey, oldCompressedBytes);
  let v2HeadPuts = 0;
  const fixture = createFixture({ values, bucket, hooks: {
    beforePut: (key, value) => {
      if (key === "bufferState" && value && typeof value === "object" &&
        (value as { schemaVersion?: unknown }).schemaVersion === 2) {
        v2HeadPuts += 1;
        if (v2HeadPuts === 3) {
          throw new Error("injected legacy adoption finalization failure");
        }
      }
    },
  } });
  await fixture.ready();

  await fixture.notifier.alarm();

  assert.equal(v2HeadPuts, 3);
  const adopted = await loadNotifierSnapshot(fixture.binding.storage, "run") as {
    flushIntents: Array<{ origin: string; blob: { digest: string } }>;
    r2SegmentBuffer: unknown[];
    r2LastFlushedSegmentIndex: number;
    legacyPendingRunCount: number;
  };
  assert.equal(adopted.flushIntents.length, 1);
  assert.equal(adopted.flushIntents[0]?.origin, "journal");
  assert.equal(adopted.flushIntents[0]?.blob.digest,
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", oldCompressedBytes)))
      .map((byte) => byte.toString(16).padStart(2, "0")).join(""));
  assert.equal(adopted.r2SegmentBuffer.length, 100);
  assert.equal(adopted.r2LastFlushedSegmentIndex, 0);
  assert.equal(adopted.legacyPendingRunCount, 100);
  const afterAdoptionFailure = await bucket.get(segmentKey);
  assert.ok(afterAdoptionFailure);
  assert.deepEqual(new Uint8Array(await afterAdoptionFailure.arrayBuffer()),
    new Uint8Array(oldCompressedBytes));

  const cold = createFixture({ values: structuredClone(values), bucket });
  await cold.ready();
  await cold.notifier.alarm();
  const finalized = await loadNotifierSnapshot(cold.binding.storage, "run") as {
    flushIntents: unknown[];
    r2SegmentBuffer: unknown[];
    r2LastFlushedSegmentIndex: number;
    legacyPendingRunCount: number;
  };
  assert.equal(finalized.flushIntents.length, 0);
  assert.equal(finalized.r2SegmentBuffer.length, 0);
  assert.equal(finalized.r2LastFlushedSegmentIndex, 1);
  assert.equal(finalized.legacyPendingRunCount, 0);
  assert.deepEqual(await archivedIds(bucket), Array.from({ length: 100 }, (_, index) => index + 1));
});
