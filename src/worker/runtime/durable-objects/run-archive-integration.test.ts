import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type {
  DurableObjectStorageBinding,
  ObjectStoreBinding,
} from "../../shared/types/bindings.ts";
import type { Env } from "../../shared/types/index.ts";
import * as schema from "../../infra/db/schema.ts";
import { gzipCompressString, gzipDecompressToString } from "../../shared/utils/gzip.ts";
import { createInMemoryObjectStore } from "../../local-platform/in-memory-r2.ts";
import { loadNotifierSnapshot } from "./notifier-journal.ts";
import { RunNotifierDO } from "./run-notifier.ts";
import {
  archiveNodeKey,
  prepareArchiveInsert,
  stageArchiveInsert,
} from "./run-archive-index.ts";
import { emptyArchiveRoot } from "../../shared/contracts/run-archive.ts";
import type { RunArchiveState } from "./run-archive-maintenance.ts";
import { getIndexedRunEventsAfter } from "../../application/services/offload/indexed-run-events.ts";

const RUN_ID = "run-archive-regression";
const CREATED_AT = "2026-10-01T00:00:00.000Z";

type Event = {
  event_id: number;
  type: string;
  data: string;
  created_at: string;
};

type HeadHook = (
  value: unknown,
  attempt: number,
  values: Map<string, unknown>,
) => void | Promise<void>;

type FixtureOptions = {
  values?: Map<string, unknown>;
  bucket?: ReturnType<typeof createArchiveBucket>;
  beforeHeadPut?: HeadHook;
  afterHeadPut?: HeadHook;
};

function event(eventId: number, data: unknown = { sequence: eventId }): Event {
  return {
    event_id: eventId,
    type: "run.progress",
    data: JSON.stringify(data),
    created_at: CREATED_AT,
  };
}

function ringEvent(item: Event) {
  return {
    id: item.event_id,
    type: item.type,
    data: JSON.parse(item.data),
    timestamp: Date.parse(item.created_at),
  };
}

async function gzipEvents(events: Event[]): Promise<Uint8Array> {
  return new Uint8Array(await gzipCompressString(
    events.map((item) => JSON.stringify(item)).join("\n") + "\n",
  ));
}

function createArchiveBucket() {
  const base = createInMemoryObjectStore();
  let listCalls = 0;
  let getCalls = 0;
  let headCalls = 0;
  let listHook: (() => void | Promise<void>) | undefined;
  let beforeHead: ((key: string) => void | Promise<void>) | undefined;
  let afterHead: ((key: string, result: unknown) => void | Promise<void>) | undefined;
  const bucket = {
    head: async (key: string) => {
      headCalls += 1;
      await beforeHead?.(key);
      const result = await base.head(key);
      await afterHead?.(key, result);
      return result;
    },
    get: async (key: string, options?: Record<string, unknown>) => {
      getCalls += 1;
      return base.get(key, options as never);
    },
    put: (key: string, value: Parameters<typeof base.put>[1], options?: Record<string, unknown>) =>
      base.put(key, value, options as never),
    delete: (key: string | string[]) => base.delete(key),
    list: async (options?: Record<string, unknown>) => {
      listCalls += 1;
      await listHook?.();
      return base.list(options as never);
    },
  };
  return {
    binding: bucket as unknown as ObjectStoreBinding,
    counts: () => ({ listCalls, getCalls, headCalls }),
    setHeadHooks(hooks: {
      before?: (key: string) => void | Promise<void>;
      after?: (key: string, result: unknown) => void | Promise<void>;
    }) {
      beforeHead = hooks.before;
      afterHead = hooks.after;
    },
    setListHook(hook: (() => void | Promise<void>) | undefined) {
      listHook = hook;
    },
    async bytes(key: string): Promise<Uint8Array | null> {
      const object = await base.get(key);
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
  };
}

function createStorage(
  values = new Map<string, unknown>(),
  options: Pick<FixtureOptions, "beforeHeadPut" | "afterHeadPut"> = {},
) {
  let serial = Promise.resolve();
  let alarm: number | null = null;
  let alarmSetCalls = 0;
  let headPutAttempts = 0;
  async function deleteStorage(key: string): Promise<void>;
  async function deleteStorage(keys: string[]): Promise<number>;
  async function deleteStorage(keyOrKeys: string | string[]): Promise<void | number> {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    let deleted = 0;
    for (const key of keys) if (values.delete(key)) deleted += 1;
    return Array.isArray(keyOrKeys) ? deleted : undefined;
  }
  const storage: DurableObjectStorageBinding = {
    async get<T>(key: string): Promise<T | undefined> {
      const value = values.get(key);
      return value === undefined ? undefined : structuredClone(value) as T;
    },
    async put(keyOrEntries: string | Record<string, unknown>, value?: unknown): Promise<void> {
      if (typeof keyOrEntries === "string") {
        if (keyOrEntries === "bufferState") {
          headPutAttempts += 1;
          await options.beforeHeadPut?.(value, headPutAttempts, values);
        }
        values.set(keyOrEntries, structuredClone(value));
        if (keyOrEntries === "bufferState") {
          await options.afterHeadPut?.(value, headPutAttempts, values);
        }
        return;
      }
      for (const [key, entry] of Object.entries(keyOrEntries)) {
        values.set(key, structuredClone(entry));
      }
    },
    delete: deleteStorage,
    async list<T = unknown>(options?: Record<string, unknown>): Promise<Map<string, T>> {
      const prefix = typeof options?.prefix === "string" ? options.prefix : "";
      const start = typeof options?.start === "string" ? options.start : undefined;
      const startAfter = typeof options?.startAfter === "string" ? options.startAfter : undefined;
      const end = typeof options?.end === "string" ? options.end : undefined;
      const reverse = options?.reverse === true;
      const limit = typeof options?.limit === "number" && Number.isSafeInteger(options.limit)
        ? Math.max(1, options.limit)
        : Number.POSITIVE_INFINITY;
      let keys = [...values.keys()].filter((key) => key.startsWith(prefix));
      if (start !== undefined) keys = keys.filter((key) => key >= start);
      if (startAfter !== undefined) keys = keys.filter((key) => key > startAfter);
      if (end !== undefined) keys = keys.filter((key) => key < end);
      keys.sort((left, right) => reverse ? right.localeCompare(left) : left.localeCompare(right));
      return new Map(keys.slice(0, limit).map((key) => [key, structuredClone(values.get(key)) as T]));
    },
    async getAlarm(): Promise<number | null> {
      return alarm;
    },
    async setAlarm(value: number | Date): Promise<void> {
      alarmSetCalls += 1;
      alarm = value instanceof Date ? value.getTime() : value;
    },
    async deleteAlarm(): Promise<void> {
      alarm = null;
    },
  };
  const state = {
    storage,
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const operation = serial.then(callback);
      serial = operation.then(() => undefined, () => undefined);
      return operation;
    },
    getWebSockets: () => [],
    getTags: () => [],
    acceptWebSocket: () => undefined,
  };
  return {
    binding: state as never,
    storage,
    values,
    headPuts: () => headPutAttempts,
    alarmSetCalls: () => alarmSetCalls,
    alarm: () => alarm,
  };
}

async function createFixture(options: FixtureOptions = {}) {
  const client = createClient({ url: ":memory:" });
  await client.execute("CREATE TABLE runs (id TEXT PRIMARY KEY, last_event_id INTEGER)");
  await client.execute("INSERT INTO runs (id, last_event_id) VALUES (?, 0)", [RUN_ID]);
  const db = drizzle(client, { schema });
  const store = createStorage(options.values, options);
  const notifier = new RunNotifierDO(store.binding, {
    DB: db,
    ...(options.bucket ? { TAKOS_OFFLOAD: options.bucket.binding } : {}),
  } as unknown as Env);
  await (notifier as unknown as { initialized: Promise<void> }).initialized;
  return {
    client,
    notifier,
    store,
    bucket: options.bucket,
    close: () => client.close(),
  };
}

async function emit(notifier: RunNotifierDO, eventId: number): Promise<Response> {
  return notifier.fetch(new Request("https://run-notifier.test/emit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runId: RUN_ID,
      type: "run.progress",
      data: { sequence: eventId },
      event_id: eventId,
    }),
  }));
}

function archiveRequest(notifier: RunNotifierDO, after = 0): Promise<Response> {
  const url = new URL("https://run-notifier.test/archive");
  url.searchParams.set("runId", RUN_ID);
  url.searchParams.set("after", String(after));
  url.searchParams.set("limit", "500");
  return notifier.fetch(new Request(url));
}

async function seedLegacyState(
  values: Map<string, unknown>,
  options: {
    events?: Event[];
    eventIdCounter?: number;
    lastFlushed?: number;
    segmentIndex?: number;
  } = {},
): Promise<void> {
  const events = options.events ?? [];
  const eventIdCounter = options.eventIdCounter ?? events.at(-1)?.event_id ?? 0;
  values.set("bufferState", {
    schemaVersion: 1,
    eventBuffer: events.map(ringEvent),
    eventIdCounter,
    runId: RUN_ID,
    r2SegmentIndex: options.segmentIndex ?? 1,
    r2SegmentBuffer: [],
    r2LastFlushedSegmentIndex: options.lastFlushed ?? 0,
    usageSegmentIndex: 1,
    usageSegmentBuffer: [],
    usageLastFlushedSegmentIndex: 0,
    emitDedupKeys: [],
  });
}

async function seedLegacyObject(
  bucket: ReturnType<typeof createArchiveBucket>,
  segmentIndex: number,
  events: Event[],
  key?: string,
): Promise<{ key: string; bytes: Uint8Array }> {
  const objectKey = key ?? `runs/${RUN_ID}/events/${String(segmentIndex).padStart(6, "0")}.jsonl.gz`;
  const bytes = await gzipEvents(events);
  await bucket.binding.put(objectKey, bytes);
  return { key: objectKey, bytes };
}

async function queryUntilReady(notifier: RunNotifierDO): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await archiveRequest(notifier);
    if (response.ok) return await response.json() as Record<string, unknown>;
    if (response.status !== 503) throw new Error(`Unexpected archive status ${response.status}`);
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === "string" && /repair/iu.test(body.error)) {
      throw new Error(body.error);
    }
  }
  throw new Error("Run archive did not become ready within eight bounded requests");
}

async function expectRepair(
  notifier: RunNotifierDO,
  reason: RegExp,
): Promise<void> {
  let response: Response | undefined;
  let error = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    response = await archiveRequest(notifier);
    if (response.status !== 503) {
      throw new Error(`Expected archive repair response, received ${response.status}`);
    }
    const body = await response.json() as { error?: unknown };
    error = typeof body.error === "string" ? body.error : "";
    if (/repair/iu.test(error)) break;
  }
  expect(response?.status).toBe(503);
  expect(error).toMatch(reason);
}

test("fresh notifier accepts its first event, preserves preferred ID jumps, and queries cold without R2 listing", async () => {
  const bucket = createArchiveBucket();
  const fixture = await createFixture({ bucket });
  try {
    const first = await emit(fixture.notifier, 7);
    expect(first.status).toBe(200);
    expect((await first.json() as { eventId: number }).eventId).toBe(7);
    const second = await emit(fixture.notifier, 42);
    expect(second.status).toBe(200);
    expect((await second.json() as { eventId: number }).eventId).toBe(42);

    const page = await archiveRequest(fixture.notifier);
    expect(page.status).toBe(200);
    expect((await page.json() as { pending: Event[] }).pending.map((item) => item.event_id))
      .toEqual([7, 42]);

    const listsBeforeColdRead = bucket.counts().listCalls;
    const cold = await createFixture({ bucket, values: fixture.store.values });
    try {
      const coldPage = await archiveRequest(cold.notifier);
      expect(coldPage.status).toBe(200);
      expect((await coldPage.json() as { pending: Event[] }).pending.map((item) => item.event_id))
        .toEqual([7, 42]);
      expect(bucket.counts().listCalls).toBe(listsBeforeColdRead);
    } finally {
      cold.close();
    }
  } finally {
    fixture.close();
  }
});

test("a valid small legacy segment migrates and remains indexed across cold replacement", async () => {
  const bucket = createArchiveBucket();
  const legacy = [event(1), event(9)];
  const values = new Map<string, unknown>();
  await seedLegacyState(values, { events: legacy, eventIdCounter: 9, lastFlushed: 1, segmentIndex: 2 });
  const stored = await seedLegacyObject(bucket, 1, legacy);
  const fixture = await createFixture({ bucket, values });
  try {
    const page = await queryUntilReady(fixture.notifier);
    const descriptors = page.descriptors as Array<{ key: string; firstEventId: number; lastEventId: number }>;
    expect(descriptors).toEqual([
      expect.objectContaining({ key: stored.key, firstEventId: 1, lastEventId: 9 }),
    ]);
    expect(bucket.counts().listCalls).toBeGreaterThan(0);

    const listsAfterReady = bucket.counts().listCalls;
    const cold = await createFixture({ bucket, values });
    try {
      const coldPage = await archiveRequest(cold.notifier);
      expect(coldPage.status).toBe(200);
      expect((await coldPage.json() as { descriptors: unknown[] }).descriptors).toHaveLength(1);
      expect(bucket.counts().listCalls).toBe(listsAfterReady);
    } finally {
      cold.close();
    }
  } finally {
    fixture.close();
  }
});

test("migration resumes across cold replacements for more than 32 gzip segments and preserves pending history", async () => {
  const bucket = createArchiveBucket();
  const archived = Array.from({ length: 34 }, (_, index) => event(index + 1));
  const pending = Array.from({ length: 120 }, (_, index) => event(index + 35));
  const retainedRing = pending.slice(-100);
  const values = new Map<string, unknown>();
  await seedLegacyState(values, {
    events: retainedRing,
    eventIdCounter: 154,
    lastFlushed: 34,
    segmentIndex: 35,
  });
  const legacyHead = values.get("bufferState") as Record<string, unknown>;
  legacyHead.r2SegmentBuffer = pending;
  values.set("bufferState", legacyHead);
  for (let index = 0; index < archived.length; index += 1) {
    await seedLegacyObject(bucket, index + 1, [archived[index]!]);
  }

  let fixture = await createFixture({ bucket, values });
  let lastScanned = 0;
  let coldReplacements = 0;
  let readyPage: Record<string, unknown> | undefined;
  try {
    await fixture.notifier.alarm();
    const afterInitialAlarm = await loadNotifierSnapshot(fixture.store.storage, "run") as {
      archive: RunArchiveState;
    };
    expect(afterInitialAlarm.archive.phase).toBe("building");
    expect(afterInitialAlarm.archive.build?.scanned ?? 0).toBeLessThanOrEqual(8);
    expect(bucket.counts().getCalls).toBeLessThanOrEqual(8);
    lastScanned = afterInitialAlarm.archive.build?.scanned ?? 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await archiveRequest(fixture.notifier);
      if (response.ok) {
        readyPage = await response.json() as Record<string, unknown>;
        break;
      }
      expect(response.status).toBe(503);
      const body = await response.json() as { error?: unknown };
      expect(body.error).toMatch(/building/iu);
      const state = await loadNotifierSnapshot(fixture.store.storage, "run") as {
        archive: RunArchiveState;
      };
      expect(state.archive.phase).toBe("building");
      const scanned = state.archive.build?.scanned ?? 0;
      expect(scanned).toBeGreaterThanOrEqual(lastScanned);
      lastScanned = scanned;
      fixture.close();
      fixture = await createFixture({ bucket, values });
      coldReplacements += 1;
    }
    expect(readyPage).toBeDefined();
    expect(coldReplacements).toBeGreaterThanOrEqual(3);
    expect(lastScanned).toBeGreaterThanOrEqual(32);
    const descriptors = readyPage!.descriptors as Array<{ segmentIndex: number; firstEventId: number }>;
    expect(descriptors.map((item) => item.segmentIndex)).toEqual(
      Array.from({ length: 34 }, (_, index) => index + 1),
    );
    expect(descriptors.map((item) => item.firstEventId)).toEqual(
      Array.from({ length: 34 }, (_, index) => index + 1),
    );
    const pendingPage = readyPage!.pending as Event[];
    expect(pendingPage.map((item) => item.event_id)).toEqual(
      Array.from({ length: 120 }, (_, index) => index + 35),
    );
    expect(pendingPage.slice(0, 20).map((item) => item.event_id)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 35),
    );

    const listsAfterReady = bucket.counts().listCalls;
    const namespace = {
      idFromName: (name: string) => name,
      get: () => ({ fetch: (request: Request) => fixture.notifier.fetch(request) }),
    } as never;
    const events = await getIndexedRunEventsAfter(namespace, bucket.binding, RUN_ID, 0, 154);
    expect(events.map((item) => item.event_id)).toEqual(
      Array.from({ length: 154 }, (_, index) => index + 1),
    );
    const cold = await createFixture({ bucket, values });
    try {
      const coldPage = await archiveRequest(cold.notifier);
      expect(coldPage.status).toBe(200);
      expect(bucket.counts().listCalls).toBe(listsAfterReady);
    } finally {
      cold.close();
    }
    expect(bucket.counts().listCalls).toBe(listsAfterReady);
  } finally {
    fixture.close();
  }
});

test("transient legacy R2 listing failure remains building and resumes successfully from alarm", async () => {
  const bucket = createArchiveBucket();
  const values = new Map<string, unknown>();
  const legacy = [event(1)];
  await seedLegacyState(values, { events: legacy, eventIdCounter: 1, lastFlushed: 1, segmentIndex: 2 });
  await seedLegacyObject(bucket, 1, legacy);
  const fixture = await createFixture({ bucket, values });
  let failList = true;
  bucket.setListHook(() => {
    if (failList) throw new Error("injected transient R2 LIST failure");
  });
  try {
    await expect(archiveRequest(fixture.notifier)).rejects.toThrow(/transient R2 LIST failure/iu);
    let state = await loadNotifierSnapshot(fixture.store.storage, "run") as { archive: RunArchiveState };
    expect(state.archive.phase).toBe("building");
    expect(state.archive.error).toBeNull();
    failList = false;
    await fixture.notifier.alarm();
    state = await loadNotifierSnapshot(fixture.store.storage, "run") as { archive: RunArchiveState };
    expect(state.archive.phase).toBe("ready");
    expect((await archiveRequest(fixture.notifier)).status).toBe(200);
  } finally {
    bucket.setListHook(undefined);
    fixture.close();
  }
});

test("permanently oversized legacy segment enters repair instead of remaining alarm-building", async () => {
  const bucket = createArchiveBucket();
  const oversized = event(1, { payload: "x".repeat(8 * 1024 * 1024 + 1024) });
  const values = new Map<string, unknown>();
  await seedLegacyState(values, { eventIdCounter: 1, lastFlushed: 1, segmentIndex: 2 });
  const stored = await seedLegacyObject(bucket, 1, [oversized]);
  const before = await bucket.bytes(stored.key);
  const fixture = await createFixture({ bucket, values });
  try {
    await expectRepair(fixture.notifier, /exceeds the size limit|repair/iu);
    const listCallsAtRepair = bucket.counts().listCalls;
    const setsAtRepair = fixture.store.alarmSetCalls();
    await fixture.notifier.alarm();
    const state = await loadNotifierSnapshot(fixture.store.storage, "run") as { archive: RunArchiveState };
    expect(state.archive.phase).toBe("repair");
    expect(state.archive.error).toMatch(/exceeds the size limit|repair/iu);
    expect(bucket.counts().listCalls).toBe(listCallsAtRepair);
    expect(fixture.store.alarmSetCalls()).toBe(setsAtRepair);
    expect(await bucket.bytes(stored.key)).toEqual(before);
  } finally {
    fixture.close();
  }
});

test("a missing notifier head with existing R2 objects fails closed and leaves object bytes untouched", async () => {
  const bucket = createArchiveBucket();
  const stored = await seedLegacyObject(bucket, 1, [event(1)]);
  const before = await bucket.bytes(stored.key);
  const fixture = await createFixture({ bucket });
  try {
    await expectRepair(fixture.notifier, /accepted counter|repair/iu);
    const after = await bucket.bytes(stored.key);
    expect(after).toEqual(before);
    const state = await loadNotifierSnapshot(fixture.store.storage, "run") as {
      archive: RunArchiveState;
    };
    expect(state.archive.phase).toBe("repair");
  } finally {
    fixture.close();
  }
});

test("malformed, noncanonical, and overlapping legacy objects enter repair without rewriting bytes", async () => {
  const malformedBucket = createArchiveBucket();
  const malformedKey = `runs/${RUN_ID}/events/000001.jsonl.gz`;
  const malformedBytes = new Uint8Array(await gzipCompressString("{broken json\n"));
  await malformedBucket.binding.put(malformedKey, malformedBytes);
  const malformedValues = new Map<string, unknown>();
  await seedLegacyState(malformedValues, { eventIdCounter: 3, lastFlushed: 1, segmentIndex: 2 });
  const malformed = await createFixture({ bucket: malformedBucket, values: malformedValues });
  try {
    await expectRepair(malformed.notifier, /repair|JSON|gzip/iu);
    expect(await malformedBucket.bytes(malformedKey)).toEqual(malformedBytes);
    const state = await loadNotifierSnapshot(malformed.store.storage, "run") as { archive: RunArchiveState };
    expect(state.archive.phase).toBe("repair");
  } finally {
    malformed.close();
  }

  const noncanonicalBucket = createArchiveBucket();
  const noncanonicalKey = `runs/${RUN_ID}/events/01.jsonl.gz`;
  const noncanonicalBytes = await gzipEvents([event(1)]);
  await noncanonicalBucket.binding.put(noncanonicalKey, noncanonicalBytes);
  const noncanonicalValues = new Map<string, unknown>();
  await seedLegacyState(noncanonicalValues, { eventIdCounter: 1, lastFlushed: 1, segmentIndex: 2 });
  const noncanonical = await createFixture({ bucket: noncanonicalBucket, values: noncanonicalValues });
  try {
    await expectRepair(noncanonical.notifier, /canonical|repair/iu);
    expect(await noncanonicalBucket.bytes(noncanonicalKey)).toEqual(noncanonicalBytes);
    const state = await loadNotifierSnapshot(noncanonical.store.storage, "run") as { archive: RunArchiveState };
    expect(state.archive.phase).toBe("repair");
  } finally {
    noncanonical.close();
  }

  const overlapBucket = createArchiveBucket();
  const first = await seedLegacyObject(overlapBucket, 1, [event(1), event(3)]);
  const second = await seedLegacyObject(overlapBucket, 2, [event(3), event(5)]);
  const overlapValues = new Map<string, unknown>();
  await seedLegacyState(overlapValues, { eventIdCounter: 5, lastFlushed: 2, segmentIndex: 3 });
  const overlap = await createFixture({ bucket: overlapBucket, values: overlapValues });
  try {
    await expectRepair(overlap.notifier, /overlap|repair/iu);
    expect(await overlapBucket.bytes(first.key)).toEqual(first.bytes);
    expect(await overlapBucket.bytes(second.key)).toEqual(second.bytes);
    const state = await loadNotifierSnapshot(overlap.store.storage, "run") as { archive: RunArchiveState };
    expect(state.archive.phase).toBe("repair");
  } finally {
    overlap.close();
  }
});

test("migration refuses known ring conflicts and missing retained ring events", async () => {
  const conflictBucket = createArchiveBucket();
  const ring = event(5, { message: "ring value" });
  const conflicting = event(5, { message: "archive value" });
  const conflictObject = await seedLegacyObject(conflictBucket, 1, [conflicting]);
  const conflictValues = new Map<string, unknown>();
  await seedLegacyState(conflictValues, { events: [ring], eventIdCounter: 5, lastFlushed: 1, segmentIndex: 2 });
  const conflict = await createFixture({ bucket: conflictBucket, values: conflictValues });
  try {
    await expectRepair(conflict.notifier, /conflicts with retained ring/iu);
    expect(await conflictBucket.bytes(conflictObject.key)).toEqual(conflictObject.bytes);
    const state = await loadNotifierSnapshot(conflict.store.storage, "run") as { archive: RunArchiveState };
    expect(state.archive.phase).toBe("repair");
  } finally {
    conflict.close();
  }

  const missingBucket = createArchiveBucket();
  const retained = event(27);
  const missingValues = new Map<string, unknown>();
  await seedLegacyState(missingValues, { events: [retained], eventIdCounter: 27 });
  const missing = await createFixture({ bucket: missingBucket, values: missingValues });
  try {
    await expectRepair(missing.notifier, /Known Run ring event is missing/iu);
    const state = await loadNotifierSnapshot(missing.store.storage, "run") as { archive: RunArchiveState };
    expect(state.archive.phase).toBe("repair");
  } finally {
    missing.close();
  }
});

test("a corrupt committed archive tree node makes production archive queries fail", async () => {
  const bucket = createArchiveBucket();
  const values = new Map<string, unknown>();
  const treeStorage = createStorage(values);
  const descriptor = {
    key: `runs/${RUN_ID}/events/000001.jsonl.gz`,
    segmentIndex: 1,
    firstEventId: 1,
    lastEventId: 1,
    count: 1,
    sha256: "a".repeat(64),
    bytes: 1,
  };
  const plan = await prepareArchiveInsert(treeStorage.storage, emptyArchiveRoot(), descriptor);
  await stageArchiveInsert(treeStorage.storage, plan);
  const archive: RunArchiveState = {
    phase: "ready",
    root: plan.root,
    build: null,
    stage: null,
    gcTopHash: null,
    gcRecords: 0,
    gcCleanupHash: null,
    error: null,
  };
  values.set("bufferState", {
    schemaVersion: 3,
    eventBuffer: [],
    eventIdCounter: 1,
    runId: RUN_ID,
    r2SegmentIndex: 2,
    r2SegmentBuffer: [],
    r2LastFlushedSegmentIndex: 1,
    usageSegmentIndex: 1,
    usageSegmentBuffer: [],
    usageLastFlushedSegmentIndex: 0,
    emitDedupKeys: [],
    flushIntents: [],
    emitReceipts: [],
    usageReceipts: [],
    legacyPendingRunCount: 0,
    legacyPendingUsageCount: 0,
    archive,
  });
  values.set(archiveNodeKey(plan.root.hash!), "{corrupt");
  const fixture = await createFixture({ bucket, values });
  try {
    await expect(archiveRequest(fixture.notifier)).rejects.toThrow(/Invalid run archive/iu);
  } finally {
    fixture.close();
  }
});

test("a failed final archive head publication leaves either the old pending head or the committed index", async () => {
  for (const outcome of ["before", "after"] as const) {
    let targetHeadPut = Number.MAX_SAFE_INTEGER;
    const failHead: HeadHook = (_value, attempt) => {
      if (attempt >= targetHeadPut && outcome === "before") {
        throw new Error("injected final archive head failure before commit");
      }
    };
    const afterHead: HeadHook = (_value, attempt) => {
      if (attempt === targetHeadPut && outcome === "after") {
        throw new Error("injected final archive head failure after commit");
      }
    };
    const bucket = createArchiveBucket();
    const fixture = await createFixture({ bucket, beforeHeadPut: failHead, afterHeadPut: afterHead });
    try {
      for (let id = 1; id <= 99; id += 1) {
        const response = await emit(fixture.notifier, id);
        expect(response.status).toBe(200);
      }
      targetHeadPut = fixture.store.headPuts() + 3;
      const response = await emit(fixture.notifier, 100);
      expect(response.status).toBe(200);
      expect((await response.json() as { eventId: number }).eventId).toBe(100);
      targetHeadPut = Number.MAX_SAFE_INTEGER;

      const state = await loadNotifierSnapshot(fixture.store.storage, "run") as {
        r2SegmentBuffer: Event[];
        flushIntents: unknown[];
        archive: RunArchiveState;
      };
      const key = `runs/${RUN_ID}/events/000001.jsonl.gz`;
      const bytes = await bucket.bytes(key);
      expect(bytes).not.toBeNull();
      const digestBytes = new ArrayBuffer(bytes!.byteLength);
      new Uint8Array(digestBytes).set(bytes!);
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", digestBytes)),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("");
      if (outcome === "before") {
        expect(state.r2SegmentBuffer.map((item) => item.event_id)).toEqual(
          Array.from({ length: 100 }, (_, index) => index + 1),
        );
        expect(state.flushIntents).toHaveLength(1);
        expect(state.archive.root.entries).toBe(0);
        expect(state.archive.stage?.purpose).toBe("flush");
        expect(state.archive.stage?.plan.descriptor.sha256).toBe(digest);
        expect(state.archive.stage?.plan.descriptor.bytes).toBe(bytes!.byteLength);
        const plain = await gzipDecompressToString(bytes!.buffer as ArrayBuffer);
        expect(plain).toBe(
          state.r2SegmentBuffer.map((item) => JSON.stringify(item)).join("\n") + "\n",
        );
      } else {
        expect(state.r2SegmentBuffer).toHaveLength(0);
        expect(state.flushIntents).toHaveLength(0);
        expect(state.archive.root.entries).toBe(1);
        const page = await archiveRequest(fixture.notifier);
        expect(page.status).toBe(200);
        const descriptors = (await page.json() as {
          descriptors: Array<{ firstEventId: number; lastEventId: number; sha256: string; bytes: number }>;
        }).descriptors;
        expect(descriptors).toEqual([
          expect.objectContaining({ firstEventId: 1, lastEventId: 100, sha256: digest, bytes: bytes!.byteLength }),
        ]);
      }
    } finally {
      fixture.close();
    }
  }
});
