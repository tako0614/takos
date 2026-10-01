import { expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { DurableObjectStorageBinding } from "../../src/worker/shared/types/bindings.ts";
import { inspectRunArchiveSegment, parseIndexedRunSegment } from "../../src/worker/application/services/offload/indexed-run-events.ts";
import { loadNotifierSnapshot, persistNotifierSnapshot, stageNotifierBlob } from "../../src/worker/runtime/durable-objects/notifier-journal.ts";
import { prepareArchiveInsert, stageArchiveInsert, queryArchive } from "../../src/worker/runtime/durable-objects/run-archive-index.ts";
import { newRunArchiveState } from "../../src/worker/runtime/durable-objects/run-archive-maintenance.ts";
import { emptyArchiveRoot } from "../../src/worker/shared/contracts/run-archive.ts";
import { convertRunArchiveCandidate, verifyRunArchiveCandidate, type ArchiveObject } from "./run-archive-candidate.ts";

const RUN = "candidate-test";
const DATE = "2026-10-01T00:00:00.000Z";
type Event = { event_id: number; type: string; data: string; created_at: string };
const event = (id: number, data: unknown = { id }): Event =>
  ({ event_id: id, type: "run.progress", data: typeof data === "string" ? data : JSON.stringify(data), created_at: DATE });
const key = (index: number) => `runs/${RUN}/events/${String(index).padStart(6, "0")}.jsonl.gz`;
const usageKey = (index: number) => `runs/${RUN}/usage/${String(index).padStart(6, "0")}.jsonl.gz`;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const gzip = (events: unknown[]) => new Uint8Array(gzipSync(events.map((value) => JSON.stringify(value)).join("\n") + "\n"));
const object = (key: string, bytes: Uint8Array): ArchiveObject => ({ key, bytes: bytes.length, sha256: hash(bytes) });

function storage(values = new Map<string, unknown>(), readonly = false): DurableObjectStorageBinding {
  return {
    get: async <T>(key: string) => structuredClone(values.get(key)) as T | undefined,
    put: async (key: string | Record<string, unknown>, value?: unknown) => {
      if (readonly) throw new Error("source storage was mutated");
      if (typeof key === "string") values.set(key, structuredClone(value));
      else for (const [name, entry] of Object.entries(key)) values.set(name, structuredClone(entry));
    },
    delete: async (key: string | string[]) => {
      if (readonly) throw new Error("source storage was mutated");
      if (typeof key === "string") return values.delete(key);
      let count = 0;
      for (const name of key) if (values.delete(name)) count++;
      return count;
    },
    list: async <T>(options?: Record<string, unknown>) => new Map([...values]
      .filter(([key]) => key.startsWith(typeof options?.prefix === "string" ? options.prefix : "") &&
        (typeof options?.startAfter !== "string" || key > options.startAfter))
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .slice(0, typeof options?.limit === "number" ? options.limit : undefined)
      .map(([key, value]) => [key, structuredClone(value) as T])),
    getAlarm: async () => null, setAlarm: async () => undefined, deleteAlarm: async () => undefined,
  } as DurableObjectStorageBinding;
}

function snapshot(events: Event[], options: { lastFlushed?: number; pending?: Event[];
  ring?: Event[]; usageFlushed?: number } = {}) {
  const pending = options.pending ?? [];
  const lastFlushed = options.lastFlushed ?? (events.length ? 1 : 0);
  const ring = options.ring ?? events.slice(-1);
  return {
    schemaVersion: 2, runId: RUN, eventIdCounter: Math.max(0, ...events.map((item) => item.event_id)),
    eventBuffer: ring.map((item) => ({ id: item.event_id, type: item.type,
      data: item.data.startsWith("{") ? JSON.parse(item.data) : item.data,
      timestamp: Date.parse(item.created_at) })),
    r2SegmentIndex: lastFlushed + 1, r2SegmentBuffer: pending,
    r2LastFlushedSegmentIndex: lastFlushed,
    usageSegmentIndex: (options.usageFlushed ?? 0) + 1, usageSegmentBuffer: [{ meter_type: "tokens", units: 7,
      reference_type: "run", metadata: "{\"model\":\"opaque\"}", created_at: DATE }],
    usageLastFlushedSegmentIndex: options.usageFlushed ?? 0, emitDedupKeys: [["saved-dedup", Date.parse(DATE)]],
    flushIntents: [], emitReceipts: events.length ? [{ key: "saved-dedup", digest: "a".repeat(64),
      eventId: events.at(-1)!.event_id }] : [],
    usageReceipts: [{ requestId: "saved-usage", digest: "b".repeat(64) }],
    legacyPendingRunCount: pending.length, legacyPendingUsageCount: 1,
  };
}

async function fixture(events: Event[], options: { pending?: Event[]; sourceObjects?: Map<string, Uint8Array>;
  head?: unknown; lastFlushed?: number; ring?: Event[]; usageFlushed?: number } = {}) {
  const values = new Map<string, unknown>();
  const live = storage(values);
  await persistNotifierSnapshot(live, "run", options.head ?? snapshot(events, options));
  const bodies = options.sourceObjects ?? new Map([[key(1), gzip(events.filter((item) =>
    !options.pending?.some((pending) => pending.event_id === item.event_id)))]]);
  const objects = [...bodies].map(([name, bytes]) => object(name, bytes));
  const unchanged = JSON.stringify([...values]);
  const outputBodies = new Map<string, Uint8Array>();
  const input = { runId: RUN, storage: storage(values, true), objects,
    readObject: async (name: string) => {
      const body = bodies.get(name);
      if (!body) throw new Error("missing source body");
      return new Uint8Array(body);
    },
    writeObject: async (name: string, bytes: Uint8Array) => {
      if (outputBodies.has(name)) throw new Error("duplicate candidate write");
      outputBodies.set(name, new Uint8Array(bytes));
    },
    readCandidateObject: async (name: string) => {
      const body = outputBodies.get(name);
      if (!body) throw new Error("candidate body missing");
      return new Uint8Array(body);
    } };
  return { input, values, bodies, outputBodies, unchanged };
}

test("splits a real >8 MiB legacy gzip into bounded segments and preserves state with cold reader", async () => {
  const events = Array.from({ length: 85 }, (_, index) => event(index + 1,
    index === 84 ? { terminal: true } : randomBytes(125_000).toString("base64")));
  const legacy = gzip(events);
  expect(legacy.length).toBeGreaterThan(8 * 1024 * 1024);
  await expect(inspectRunArchiveSegment(legacy.buffer.slice(legacy.byteOffset,
    legacy.byteOffset + legacy.byteLength), key(1), 1, RUN)).rejects.toThrow(/size limit/);
  const usage = gzip([{ meter_type: "tokens", units: 11, reference_type: "run",
    metadata: "{\"price\":\"uninterpreted\"}", created_at: DATE }]);
  const sourceObjects = new Map([[key(1), legacy], [usageKey(1), usage]]);
  const f = await fixture(events, { sourceObjects, usageFlushed: 1 });
  const result = await convertRunArchiveCandidate(f.input);
  expect(result.verification.eventCount).toBe(events.length);
  expect(result.objects.filter((item) => item.key.includes("/events/"))).toHaveLength(2);
  expect(result.objects.every((item) => item.bytes <= 8 * 1024 * 1024)).toBe(true);
  expect(JSON.stringify([...f.values])).toBe(f.unchanged);
  expect(f.bodies.get(key(1))).toEqual(legacy);
  expect(f.outputBodies.get(usageKey(1))).toEqual(usage);
  const candidateState = await loadNotifierSnapshot(storage(result.values, true), "run") as Record<string, unknown>;
  expect(candidateState).toMatchObject({ schemaVersion: 4, usageLedger: null, eventIdCounter: 85,
    r2SegmentBuffer: [], legacyPendingRunCount: 0, r2SegmentIndex: 3,
    r2LastFlushedSegmentIndex: 2, usageSegmentIndex: 2,
    usageLastFlushedSegmentIndex: 1, usageSegmentBuffer: (snapshot(events).usageSegmentBuffer),
    emitDedupKeys: (snapshot(events).emitDedupKeys), emitReceipts: (snapshot(events).emitReceipts),
    usageReceipts: (snapshot(events).usageReceipts) });
  await verifyRunArchiveCandidate({ runId: RUN, storage: storage(result.values, true),
    objects: result.objects, readObject: async (name) => f.outputBodies.get(name)!,
    verification: result.verification });
  const descriptors = (await queryArchive(storage(result.values, true), result.verification.root, 0, 512)).descriptors;
  for (const descriptor of descriptors) {
    const body = f.outputBodies.get(descriptor.key)!;
    expect((await parseIndexedRunSegment(body, descriptor, RUN)).length).toBeGreaterThan(0);
  }
});

test("conversion retains ready usage totals and an unacknowledged projection revision", async () => {
  const events = [event(1)];
  const usageLedger = { phase: "ready", totals: { embedding_count: 9 }, revision: 4,
    projectedRevision: 2, build: null, error: null };
  const f = await fixture(events, { head: { ...snapshot(events), schemaVersion: 4,
    archive: null, usageLedger } });
  const result = await convertRunArchiveCandidate(f.input);
  const candidateStorage = storage(result.values);
  const candidate = await loadNotifierSnapshot(candidateStorage, "run") as Record<string, unknown>;
  expect(candidate.schemaVersion).toBe(4);
  expect(candidate.usageLedger).toEqual(usageLedger);
  expect(JSON.stringify([...f.values])).toBe(f.unchanged);
  await persistNotifierSnapshot(candidateStorage, "run", { ...candidate,
    usageLedger: { ...usageLedger, revision: 5 } });
  await expect(verifyRunArchiveCandidate({ runId: RUN, storage: candidateStorage,
    objects: result.objects, readObject: async (name) => f.outputBodies.get(name)!,
    verification: result.verification })).rejects.toThrow(/preserved state mismatch/);
});

test("conversion retains usage baseline and repair fences without claiming a ready ledger", async () => {
  const events = [event(1)];
  for (const usageLedger of [
    { phase: "building", totals: {}, revision: 0, projectedRevision: 0, error: null,
      build: { frontier: 0, pendingCount: 1, intentKey: null, intentDigest: null,
        stage: "inventory", cursor: null, lastKey: null, scanned: 0, nextIndex: 1 } },
    { phase: "repair", totals: {}, revision: 0, projectedRevision: 0,
      build: null, error: "Unexplained legacy usage object" },
  ]) {
    const f = await fixture(events, { head: { ...snapshot(events), schemaVersion: 4,
      archive: null, usageLedger } });
    const result = await convertRunArchiveCandidate(f.input);
    const candidate = await loadNotifierSnapshot(storage(result.values, true), "run") as Record<string, unknown>;
    expect(candidate.schemaVersion).toBe(4);
    expect(candidate.usageLedger).toEqual(usageLedger);
    expect(JSON.stringify([...f.values])).toBe(f.unchanged);
  }
});

test("accepts sparse preferred IDs and appends accepted pending exactly once", async () => {
  const events = [event(1), event(9), event(20, "literal string payload")];
  const f = await fixture(events, { pending: [events[2]!],
    sourceObjects: new Map([[key(1), gzip(events.slice(0, 2))]]) });
  const result = await convertRunArchiveCandidate(f.input);
  expect(result.verification).toMatchObject({ eventCount: 3, firstEventId: 1, lastEventId: 20 });
  expect(result.objects.filter((item) => item.key.includes("/events/"))).toHaveLength(1);
});

test("validates a partial source root and authentic staged insert copies", async () => {
  const events = [event(1), event(2)];
  const f = await fixture(events, { lastFlushed: 2,
    sourceObjects: new Map([[key(1), gzip([events[0]])], [key(2), gzip([events[1]])]]) });
  const live = storage(f.values);
  const sourceState = await loadNotifierSnapshot(live, "run") as ReturnType<typeof snapshot> & { archive?: unknown };
  const bytes = f.bodies.get(key(1))!;
  const inspected = await inspectRunArchiveSegment(bytes.buffer.slice(bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength) as ArrayBuffer, key(1), 1, RUN);
  const plan = await prepareArchiveInsert(live, emptyArchiveRoot(), inspected.descriptor);
  await stageArchiveInsert(live, plan);
  const archive = { ...newRunArchiveState(), root: plan.root };
  await persistNotifierSnapshot(live, "run", { ...sourceState, schemaVersion: 3, archive });
  const valid = await convertRunArchiveCandidate(f.input);
  expect(valid.verification.eventCount).toBe(2);
  const second = f.bodies.get(key(2))!;
  const nextDescriptor = (await inspectRunArchiveSegment(second.buffer.slice(second.byteOffset,
    second.byteOffset + second.byteLength) as ArrayBuffer, key(2), 2, RUN)).descriptor;
  const nextPlan = await prepareArchiveInsert(live, plan.root, nextDescriptor);
  const staged = { ...archive, build: { ...archive.build!, keys: [key(2)],
    pageLoaded: true, keyIndex: 0 }, stage: { purpose: "build", plan: nextPlan,
    gc: nextPlan.retired.length ? { hash: createHash("sha256").update(JSON.stringify({
      schemaVersion: 1, nodes: nextPlan.retired, previous: null })).digest("hex"),
      json: JSON.stringify({ schemaVersion: 1, nodes: nextPlan.retired, previous: null }) } : null } };
  await persistNotifierSnapshot(live, "run", { ...sourceState, schemaVersion: 3, archive: staged });
  f.outputBodies.clear();
  expect((await convertRunArchiveCandidate(f.input)).verification.eventCount).toBe(2);
  // A crashed source may have staged some immutable nodes already.
  await live.put(`run-archive-v3/nodes/${nextPlan.writes[0]!.hash}`, nextPlan.writes[0]!.json);
  f.outputBodies.clear();
  expect((await convertRunArchiveCandidate(f.input)).verification.eventCount).toBe(2);
  await live.put(`run-archive-v3/nodes/${nextPlan.writes[0]!.hash}`, "corrupt node");
  await expect(convertRunArchiveCandidate(f.input)).rejects.toThrow(/source staged node integrity/);
});

test("refuses malformed, missing, conflicting, and unwitnessed source histories", async () => {
  const events = [event(1), event(2)];
  const badBodies = [
    gzip([{ ...event(1), extra: true }]),
    gzip([event(2), event(1)]),
    new Uint8Array(gzipSync(JSON.stringify(event(1)))),
  ];
  for (const body of badBodies) {
    const f = await fixture(events, { sourceObjects: new Map([[key(1), body]]) });
    await expect(convertRunArchiveCandidate(f.input)).rejects.toThrow();
  }
  const noHead = await fixture(events);
  noHead.values.delete("bufferState");
  await expect(convertRunArchiveCandidate(noHead.input)).rejects.toThrow(/no committed head/);
  const missingRing = await fixture(events, { sourceObjects: new Map([[key(1), gzip([event(1)])]]) });
  await expect(convertRunArchiveCandidate(missingRing.input)).rejects.toThrow();
  const unknown = await fixture(events, { sourceObjects: new Map([[key(1), gzip([event(1)])],
    [key(2), gzip([event(2)])]]) });
  await expect(convertRunArchiveCandidate(unknown.input)).rejects.toThrow(/uncommitted/);
  const oversizeEvent = event(1, randomBytes(7 * 1024 * 1024).toString("base64"));
  const oversize = await fixture([oversizeEvent], { ring: [] });
  await expect(convertRunArchiveCandidate(oversize.input)).rejects.toThrow(/single event/);
});

test("candidate body tampering fails independent cold verification", async () => {
  const events = [event(1), event(2)];
  const f = await fixture(events);
  const result = await convertRunArchiveCandidate(f.input);
  const tampered = new Map(f.outputBodies);
  const first = result.objects.find((item) => item.key.includes("/events/"))!;
  tampered.set(first.key, gzip([event(1)]));
  await expect(verifyRunArchiveCandidate({ runId: RUN, storage: storage(result.values, true),
    objects: result.objects, readObject: async (name) => tampered.get(name)!,
    verification: result.verification })).rejects.toThrow(/digest or length/);
  result.values.set("run-archive-v3/nodes/" + "a".repeat(64), "orphan");
  await expect(verifyRunArchiveCandidate({ runId: RUN, storage: storage(result.values, true),
    objects: result.objects, readObject: async (name) => f.outputBodies.get(name)!,
    verification: result.verification })).rejects.toThrow(/unlisted state/);
});

test("journal intent requires exact compressed bytes and its accepted pending prefix", async () => {
  const finalized = event(1);
  const pending = event(2);
  const f = await fixture([finalized, pending], { pending: [pending],
    sourceObjects: new Map([[key(1), gzip([finalized])]]) });
  const writable = storage(f.values);
  const frozen = gzip([pending]);
  const ref = await stageNotifierBlob(writable, frozen);
  const head = await loadNotifierSnapshot(writable, "run") as ReturnType<typeof snapshot>;
  const intent = { kind: "run", origin: "journal", segmentIndex: 2, key: key(2), count: 1, blob: ref };
  await persistNotifierSnapshot(writable, "run", { ...head, flushIntents: [intent], legacyPendingRunCount: 0 }, [ref]);
  f.bodies.set(key(2), frozen);
  f.input.objects.push(object(key(2), frozen));
  expect((await convertRunArchiveCandidate(f.input)).verification.eventCount).toBe(2);

  const conflicting = gzip([{ ...pending, data: "changed" }]);
  f.bodies.set(key(2), conflicting);
  f.input.objects[1] = object(key(2), conflicting);
  f.outputBodies.clear();
  await expect(convertRunArchiveCandidate(f.input)).rejects.toThrow(/uncommitted event body/);

  f.bodies.set(key(2), frozen);
  f.input.objects[1] = object(key(2), frozen);
  const chunk = `notifier-v2/chunks/${ref.chunks[0]}`;
  f.values.set(chunk, "corrupt-base64");
  await expect(convertRunArchiveCandidate(f.input)).rejects.toThrow(/chunk/);
});

test("corrupt source index and a ready root missing finalized bodies are refused", async () => {
  const first = event(1);
  const second = event(2);
  const f = await fixture([first, second], { lastFlushed: 2,
    sourceObjects: new Map([[key(1), gzip([first])], [key(2), gzip([second])]]) });
  const writable = storage(f.values);
  const bytes = f.bodies.get(key(1))!;
  const descriptor = (await inspectRunArchiveSegment(bytes.buffer.slice(bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength) as ArrayBuffer, key(1), 1, RUN)).descriptor;
  const plan = await prepareArchiveInsert(writable, emptyArchiveRoot(), descriptor);
  await stageArchiveInsert(writable, plan);
  const prior = await loadNotifierSnapshot(writable, "run") as ReturnType<typeof snapshot>;
  const ready = { ...newRunArchiveState(), phase: "ready", build: null, root: plan.root };
  await persistNotifierSnapshot(writable, "run", { ...prior, schemaVersion: 3, archive: ready });
  await expect(convertRunArchiveCandidate(f.input)).rejects.toThrow(/ready source root omits/);
  const building = { ...newRunArchiveState(), root: plan.root };
  await persistNotifierSnapshot(writable, "run", { ...prior, schemaVersion: 3, archive: building });
  f.values.set(`run-archive-v3/nodes/${plan.root.hash}`, "broken");
  await expect(convertRunArchiveCandidate(f.input)).rejects.toThrow(/archive index/);
});

test("retired GC records cannot retire a reachable child node", async () => {
  const events = Array.from({ length: 33 }, (_, index) => event(index + 1));
  const bodies = new Map(events.map((item, index) => [key(index + 1), gzip([item])]));
  const f = await fixture(events, { lastFlushed: 33, sourceObjects: bodies });
  const writable = storage(f.values);
  let root = emptyArchiveRoot();
  for (const [name, bytes] of bodies) {
    const index = Number(name.match(/(\d+)\.jsonl\.gz$/)![1]);
    const descriptor = (await inspectRunArchiveSegment(bytes.buffer.slice(bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength) as ArrayBuffer, name, index, RUN)).descriptor;
    const plan = await prepareArchiveInsert(writable, root, descriptor);
    await stageArchiveInsert(writable, plan);
    root = plan.root;
  }
  const rootNode = JSON.parse(await writable.get<string>(`run-archive-v3/nodes/${root.hash}`) ?? "null") as {
    t: string; children: Array<{ hash: string }>;
  };
  expect(rootNode.t).toBe("branch");
  const retired = JSON.stringify({ schemaVersion: 1, nodes: [rootNode.children[0]!.hash], previous: null });
  const retiredHash = createHash("sha256").update(retired).digest("hex");
  await writable.put(`run-archive-v3/retired/${retiredHash}`, retired);
  const source = await loadNotifierSnapshot(writable, "run") as ReturnType<typeof snapshot>;
  await persistNotifierSnapshot(writable, "run", { ...source, schemaVersion: 3,
    archive: { ...newRunArchiveState(), phase: "ready", build: null, root,
      gcTopHash: retiredHash, gcRecords: 1 } });
  await expect(convertRunArchiveCandidate(f.input)).rejects.toThrow(/retired chain shape/);
});

test("candidate KV inventory reads beyond a short first page", async () => {
  const f = await fixture([event(1)]);
  const result = await convertRunArchiveCandidate(f.input);
  const extra = "zzzz/unlisted";
  result.values.set(extra, "orphan");
  const valid = [...result.values.keys()].filter((key) => key !== extra).sort();
  const lastValid = valid.at(-1)!;
  const base = storage(result.values, true);
  const cursors: Array<string | undefined> = [];
  const paged = { ...base, list: async <T>(options?: Record<string, unknown>) => {
    const cursor = typeof options?.startAfter === "string" ? options.startAfter : undefined;
    cursors.push(cursor);
    if (cursor === undefined) return new Map(valid.map((key) => [key, result.values.get(key) as T]));
    if (cursor === lastValid) return new Map([[extra, "orphan" as T]]);
    if (cursor === extra) return new Map<string, T>();
    throw new Error("unexpected candidate KV cursor");
  } } as DurableObjectStorageBinding;
  await expect(verifyRunArchiveCandidate({ runId: RUN, storage: paged,
    objects: result.objects, readObject: async (name) => f.outputBodies.get(name)!,
    verification: result.verification })).rejects.toThrow(/unlisted state/);
  expect(cursors).toEqual([undefined, lastValid, extra]);
});

test("committed event and usage frontiers require their exact physical keys", async () => {
  const events = [event(1), event(2)];
  const eventFrontier = await fixture(events, { lastFlushed: 2,
    sourceObjects: new Map([[key(1), gzip(events)]]) });
  await expect(convertRunArchiveCandidate(eventFrontier.input)).rejects.toThrow(/event frontier object is missing/);
  const usageFrontier = await fixture(events, { usageFlushed: 1 });
  await expect(convertRunArchiveCandidate(usageFrontier.input)).rejects.toThrow(/usage frontier object is missing/);
});
