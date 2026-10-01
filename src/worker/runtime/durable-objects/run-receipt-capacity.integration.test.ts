import { expect, test } from "bun:test";
import { createInMemoryObjectStore } from "../../local-platform/in-memory-r2.ts";
import type { DurableObjectStateBinding } from "../../shared/types/bindings.ts";
import type { Env } from "../../shared/types/index.ts";
import {
  assertNotifierSnapshotBudget,
  digestNotifierPayload,
  loadNotifierSnapshot,
  persistNotifierSnapshot,
} from "./notifier-journal.ts";
import { emptyArchiveRoot } from "./run-archive-index.ts";
import {
  prepareReceiptBootstrap,
  readReceiptBootstrapProgress,
  RECEIPT_BOOTSTRAP_STAGE_NODES,
  type ReceiptBulkPlan,
  validateReceiptBootstrapPrefix,
  visitReceiptIndexClosure,
} from "./run-receipt-index.ts";
import { RunNotifierDO } from "./run-notifier.ts";

const RUN_ID = "receipt-capacity-run";
const RESERVE_BYTES = 3 * 1024 * 1024;
const MAX_HEAD_BYTES = 8 * 1024 * 1024;
const EMIT_FIRST = "emit-history-first";
const EMIT_LAST = "emit-history-last";
const USAGE_FIRST = "usage-history-first";
const USAGE_LAST = "usage-history-last";
const RECEIPT_NODE_PREFIX = "run-receipt-v1/nodes/";
const JOURNAL_CHUNK_PREFIX = "notifier-v2/chunks/";

type ReceiptSnapshot = {
  schemaVersion: 4;
  eventBuffer: unknown[];
  eventIdCounter: number;
  runId: string;
  r2SegmentIndex: number;
  r2SegmentBuffer: unknown[];
  r2LastFlushedSegmentIndex: number;
  usageSegmentIndex: number;
  usageSegmentBuffer: unknown[];
  usageLastFlushedSegmentIndex: number;
  emitDedupKeys: unknown[];
  flushIntents: unknown[];
  emitReceipts: { key: string; digest: string; eventId: number }[];
  usageReceipts: { requestId: string; digest: string }[];
  legacyPendingRunCount: number;
  legacyPendingUsageCount: number;
  archive: Record<string, unknown>;
  usageLedger: Record<string, unknown>;
};

function durableState(values = new Map<string, unknown>()) {
  let serial = Promise.resolve();
  let alarm: number | null = null;
  let listCalls = 0;
  let listPrefixes: string[] = [];
  let receiptNodePutCalls = 0;
  const storage = {
    async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined; },
    async put(key: string | Record<string, unknown>, value?: unknown) {
      if (typeof key === "string") {
        if (key.startsWith(RECEIPT_NODE_PREFIX)) receiptNodePutCalls++;
        values.set(key, structuredClone(value));
      } else for (const [name, entry] of Object.entries(key)) {
        if (name.startsWith(RECEIPT_NODE_PREFIX)) receiptNodePutCalls++;
        values.set(name, structuredClone(entry));
      }
    },
    async delete(key: string | string[]) {
      let removed = 0;
      for (const item of Array.isArray(key) ? key : [key]) if (values.delete(item)) removed++;
      return removed;
    },
    async list<T>(options?: { prefix?: string }) {
      listCalls++;
      listPrefixes.push(options?.prefix ?? "");
      return new Map([...values.entries()].filter(([key]) => key.startsWith(options?.prefix ?? "")) as [string, T][]);
    },
    async getAlarm() { return alarm; },
    async setAlarm(when: number | Date) { alarm = when instanceof Date ? when.getTime() : when; },
    async deleteAlarm() { alarm = null; },
  };
  const binding = {
    storage,
    blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
      const work = serial.then(callback);
      serial = work.then(() => undefined, () => undefined);
      return work;
    },
    getWebSockets: () => [], getTags: () => [], acceptWebSocket: () => undefined,
  };
  return { storage, binding: binding as unknown as DurableObjectStateBinding, values,
    alarm: () => alarm, listCalls: () => listCalls,
    listPrefixes: () => listPrefixes.slice(),
    resetListCalls: () => { listCalls = 0; listPrefixes = []; },
    receiptNodePutCalls: () => receiptNodePutCalls,
    resetReceiptNodePutCalls: () => { receiptNodePutCalls = 0; } };
}

function emitReceipt(key: string) {
  return { key, digest: "a".repeat(64), eventId: 1 };
}

function usageReceipt(requestId: string) {
  return { requestId, digest: "b".repeat(64) };
}

function makeSnapshot(): ReceiptSnapshot {
  return {
    schemaVersion: 4,
    eventBuffer: [], eventIdCounter: 1, runId: RUN_ID,
    r2SegmentIndex: 1, r2SegmentBuffer: [], r2LastFlushedSegmentIndex: 0,
    usageSegmentIndex: 1, usageSegmentBuffer: [], usageLastFlushedSegmentIndex: 0,
    emitDedupKeys: [], flushIntents: [], emitReceipts: [], usageReceipts: [],
    legacyPendingRunCount: 0, legacyPendingUsageCount: 0,
    archive: { phase: "ready", root: emptyArchiveRoot(), build: null, stage: null,
      gcTopHash: null, gcRecords: 0, gcCleanupHash: null, error: null },
    usageLedger: { phase: "ready", totals: {}, revision: 1, projectedRevision: 1,
      build: null, error: null },
  };
}

function serializedBytes(snapshot: ReceiptSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).length;
}

/**
 * Retain enough schema-4 receipt witnesses to put the actual serialized head
 * just below its 8 MiB limit after the existing 3 MiB future-plan reserve.
 * Long keys make the fixture bounded in record count and exercise opaque keys.
 */
async function nearCapacitySchema4Snapshot(): Promise<ReceiptSnapshot> {
  const target = MAX_HEAD_BYTES - RESERVE_BYTES - 256;
  const build = (fillerCount: number) => {
    const snapshot = makeSnapshot();
    snapshot.emitReceipts = [{ ...emitReceipt(EMIT_FIRST), eventId: 1 }];
    for (let i = 0; i < fillerCount; i++) {
      const prefix = `emit-history-${i.toString().padStart(5, "0")}-`;
      snapshot.emitReceipts.push({ ...emitReceipt(`${prefix}${"x".repeat(512 - prefix.length)}`),
        eventId: i + 2 });
    }
    snapshot.emitReceipts.push({ ...emitReceipt(EMIT_LAST), eventId: fillerCount + 2 });
    snapshot.usageReceipts = [usageReceipt(USAGE_FIRST), usageReceipt(USAGE_LAST)];
    snapshot.eventIdCounter = fillerCount + 2;
    snapshot.usageLedger = { ...snapshot.usageLedger, totals: { exec_seconds: 3 },
      revision: 3, projectedRevision: 3 };
    return snapshot;
  };
  let low = 0;
  let high = 20_000;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (serializedBytes(build(middle)) <= target) low = middle;
    else high = middle - 1;
  }
  const snapshot = build(low);
  if (serializedBytes(snapshot) > target || serializedBytes(build(low + 1)) <= target) {
    throw new Error("Could not tune schema-4 receipt fixture to reserve boundary");
  }
  snapshot.emitReceipts[0]!.digest = await digestNotifierPayload({
    runId: RUN_ID, type: "progress", data: { historical: "first" },
  });
  snapshot.emitReceipts.at(-1)!.digest = await digestNotifierPayload({
    runId: RUN_ID, type: "progress", data: { historical: "last" },
  });
  snapshot.usageReceipts[0]!.digest = await digestNotifierPayload({
    runId: RUN_ID, meterType: "exec_seconds", units: 1, referenceType: null, metadata: null,
  });
  snapshot.usageReceipts[1]!.digest = await digestNotifierPayload({
    runId: RUN_ID, meterType: "exec_seconds", units: 2, referenceType: null, metadata: null,
  });
  return snapshot;
}

function makeEnv(bucket: Env["TAKOS_OFFLOAD"]): Env {
  return { DB: {} as Env["DB"], TAKOS_OFFLOAD: bucket,
    OIDC_ISSUER_URL: "https://owner.example", OIDC_OWNER_SUBJECT: "owner-subject" } as Env;
}

async function post(notifier: RunNotifierDO, path: string, body: unknown) {
  return notifier.fetch(new Request(`http://internal${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

function trackBucket() {
  const raw = createInMemoryObjectStore();
  let listCalls = 0;
  const bucket = new Proxy(raw, {
    get(target, property) {
      if (property === "list") return (...args: Parameters<typeof target.list>) => {
        listCalls++;
        return target.list(...args);
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { bucket, listCalls: () => listCalls, resetListCalls: () => { listCalls = 0; } };
}

async function currentFixture(snapshot: ReceiptSnapshot) {
  const state = durableState();
  const r2 = trackBucket();
  const env = makeEnv(r2.bucket);
  await persistNotifierSnapshot(state.storage as never, "run", snapshot);
  const make = () => new RunNotifierDO(state.binding, env);
  const notifier = make();
  await (notifier as unknown as { initialized: Promise<void> }).initialized;
  return { state, r2, env, make, notifier };
}

async function rawSnapshot(storage: ReturnType<typeof durableState>["storage"]) {
  return await loadNotifierSnapshot(storage as never, "run") as Record<string, unknown>;
}

// These are exact values from the portable Map-backed fixture, not native DO
// serialization or quota evidence.
type HeadWitness = { headJson: string; chunks: Array<{ key: string; value: string }> };

async function captureHeadWitness(storage: ReturnType<typeof durableState>["storage"]): Promise<HeadWitness> {
  const head = await storage.get<unknown>("bufferState");
  if (!head || typeof head !== "object" || Array.isArray(head)) {
    throw new Error("Expected a persisted notifier head");
  }
  const value = head as { snapshot?: { chunks?: unknown[] }; blobs?: Array<{ chunks?: unknown[] }> };
  const hashes = [
    ...(Array.isArray(value.snapshot?.chunks) ? value.snapshot.chunks : []),
    ...(Array.isArray(value.blobs) ? value.blobs.flatMap((blob) =>
      Array.isArray(blob.chunks) ? blob.chunks : []) : []),
  ];
  const chunks: HeadWitness["chunks"] = [];
  for (const digest of new Set(hashes)) {
    if (typeof digest !== "string") throw new Error("Invalid notifier chunk reference");
    const key = JOURNAL_CHUNK_PREFIX + digest;
    const chunk = await storage.get<unknown>(key);
    if (typeof chunk !== "string") throw new Error("Missing referenced notifier chunk");
    // Save only primitive content, never an alias to mutable fixture storage.
    chunks.push({ key, value: chunk });
  }
  return { headJson: JSON.stringify(head), chunks };
}

async function headMatchesWitness(
  storage: ReturnType<typeof durableState>["storage"], witness: HeadWitness,
): Promise<boolean> {
  const head = await storage.get<unknown>("bufferState");
  if (JSON.stringify(head) !== witness.headJson) return false;
  for (const chunk of witness.chunks) {
    if (await storage.get<unknown>(chunk.key) !== chunk.value) return false;
  }
  return true;
}

async function finishReceiptMigration(
  f: Awaited<ReturnType<typeof currentFixture>>, maximumSteps: number,
  source: ReceiptSnapshot,
  prepared: Awaited<ReturnType<typeof prepareReceiptBootstrap>>,
) {
  // Decode source once before bootstrap. Subsequent sidecar-only alarms must
  // retain this exact head and each immutable chunk until the root switch.
  const initial = await rawSnapshot(f.state.storage);
  expect(initial.emitReceipts).toEqual(source.emitReceipts);
  expect(initial.usageReceipts).toEqual(source.usageReceipts);
  let headWitness: HeadWitness | null = null;
  let headCursor = 0;
  let validatedCursor = 0;
  for (let step = 0; step < maximumSteps; step++) {
    if (!headWitness) {
      f.state.resetReceiptNodePutCalls();
      await f.notifier.alarm();
      expect(f.state.receiptNodePutCalls()).toBeLessThanOrEqual(RECEIPT_BOOTSTRAP_STAGE_NODES);
      const after = await rawSnapshot(f.state.storage);
      const next = after.receiptIndex as {
        phase?: unknown;
        bootstrapStage?: { cursor?: unknown; plan?: ReceiptBulkPlan } | null;
      } | undefined;
      expect(next?.phase).toBe("building");
      expect(next?.bootstrapStage?.cursor).toBe(0);
      expect(next?.bootstrapStage?.plan).toEqual(prepared.plan);
      expect(after.emitReceipts).toEqual(source.emitReceipts);
      expect(after.usageReceipts).toEqual(source.usageReceipts);
      headWitness = await captureHeadWitness(f.state.storage);
      headCursor = next?.bootstrapStage?.cursor as number;
      expect(headCursor).toBe(0);
      continue;
    }
    expect(await headMatchesWitness(f.state.storage, headWitness)).toBe(true);
    const beforeProgress = await readReceiptBootstrapProgress(f.state.storage as never, prepared.plan);
    const beforeCursor = Math.max(headCursor, beforeProgress.cursor);
    await validateReceiptBootstrapPrefix(f.state.storage as never, prepared, beforeCursor, validatedCursor);
    validatedCursor = beforeCursor;
    f.state.resetReceiptNodePutCalls();
    await f.notifier.alarm();
    expect(f.state.receiptNodePutCalls()).toBeLessThanOrEqual(RECEIPT_BOOTSTRAP_STAGE_NODES);
    if (await headMatchesWitness(f.state.storage, headWitness)) {
      const progress = await readReceiptBootstrapProgress(f.state.storage as never, prepared.plan);
      const afterCursor = Math.max(headCursor, progress.cursor);
      await validateReceiptBootstrapPrefix(f.state.storage as never, prepared, afterCursor, validatedCursor);
      expect(afterCursor).toBeGreaterThanOrEqual(beforeCursor);
      expect(afterCursor - beforeCursor).toBeLessThanOrEqual(RECEIPT_BOOTSTRAP_STAGE_NODES);
      validatedCursor = afterCursor;
      continue;
    }

    const persisted = await rawSnapshot(f.state.storage);
    const index = persisted.receiptIndex as { phase?: unknown; root: { entries: number } } | undefined;
    if (index?.phase !== "ready") throw new Error("Notifier head changed before receipt root switch");
    expect(persisted.emitReceipts).toEqual([]);
    expect(persisted.usageReceipts).toEqual([]);
    expect(index.root.entries).toBe(source.emitReceipts.length + source.usageReceipts.length);
    expect(prepared.plan.writeHashes.length - beforeCursor)
      .toBeLessThanOrEqual(RECEIPT_BOOTSTRAP_STAGE_NODES);
    // Authenticate the complete staged prefix and installed closure only at
    // the root-switch boundary; intermediate batches are incremental.
    await validateReceiptBootstrapPrefix(f.state.storage as never, prepared,
      prepared.plan.writeHashes.length);
    expect(await visitReceiptIndexClosure(f.state.storage as never, index.root as never))
      .toBe(index.root.entries);
    return step + 1;
  }
  throw new Error("receipt migration did not reach ready within bounded alarm steps");
}

test("schema-4 capacity fixture is a real serialized head at the reserve boundary", async () => {
  const snapshot = await nearCapacitySchema4Snapshot();
  const bytes = serializedBytes(snapshot);
  expect(bytes + RESERVE_BYTES).toBeLessThanOrEqual(MAX_HEAD_BYTES);
  expect(Math.ceil(bytes / (64 * 1024)) + 48).toBeLessThanOrEqual(128);
  expect(snapshot.emitReceipts[0]?.key).toBe(EMIT_FIRST);
  expect(snapshot.emitReceipts.at(-1)?.key).toBe(EMIT_LAST);
  expect(snapshot.usageReceipts.map(({ requestId }) => requestId)).toEqual([USAGE_FIRST, USAGE_LAST]);
  expect(snapshot.emitReceipts.length + snapshot.usageReceipts.length).toBeGreaterThan(5_000);
});

test("head witness detects changed raw stored chunk strings while head JSON is unchanged", async () => {
  const f = await currentFixture(makeSnapshot());
  try {
    const witness = await captureHeadWitness(f.state.storage);
    expect(witness.chunks.length).toBeGreaterThan(0);
    const chunk = witness.chunks[0]!;
    f.state.values.set(chunk.key, chunk.value + "changed");
    expect(JSON.stringify(await f.state.storage.get("bufferState"))).toBe(witness.headJson);
    expect(await headMatchesWitness(f.state.storage, witness)).toBe(false);
  } finally {
    // This fixture is in-memory; no external cleanup is required.
  }
});

const NEW_EMIT = { runId: RUN_ID, type: "progress", data: { step: "after-migration" },
  dedup_key: "emit-new-after-capacity" };
const NEW_USAGE = { runId: RUN_ID, meter_type: "exec_seconds", units: 1,
  request_id: "usage-new-after-capacity" };

test("schema-4 receipt history migrates, then accepts and cold-replays emit and usage receipts", async () => {
  const original = await nearCapacitySchema4Snapshot();
  const expectedEmitCount = original.emitReceipts.length;
  const expectedUsageCount = original.usageReceipts.length;
  const expectedEventId = original.eventIdCounter + 1;
  const f = await currentFixture(original);
  try {
    const expectedReceiptCount = expectedEmitCount + expectedUsageCount;
    const bulkPlan = await prepareReceiptBootstrap({ emitReceipts: original.emitReceipts,
      usageReceipts: original.usageReceipts, emitDedupKeys: [] });
    const maximumMigrationAlarms = 1 +
      Math.ceil(bulkPlan.plan.writeHashes.length / RECEIPT_BOOTSTRAP_STAGE_NODES) + 1;
    const migrationSteps = await finishReceiptMigration(f, maximumMigrationAlarms,
      original, bulkPlan);
    expect(migrationSteps).toBeGreaterThan(1);
    expect(migrationSteps).toBeLessThan(expectedReceiptCount);
    const migrated = await rawSnapshot(f.state.storage);
    const migratedIndex = migrated.receiptIndex as { phase: string; root: { entries: number } };
    expect(migratedIndex.phase).toBe("ready");
    expect(migratedIndex.root.entries).toBe(expectedEmitCount + expectedUsageCount);
    expect(migrated.emitReceipts).toEqual([]);
    expect(migrated.usageReceipts).toEqual([]);
    expect(migrated.eventIdCounter).toBe(original.eventIdCounter);
    expect(migrated.usageLedger).toMatchObject({ totals: { exec_seconds: 3 },
      revision: 3, projectedRevision: 3 });
    expect([...f.state.values.keys()].filter((key) => key.startsWith(RECEIPT_NODE_PREFIX)).length)
      .toBeGreaterThan(0);

    f.state.resetListCalls();
    f.r2.resetListCalls();
    const newEmitResponse = await post(f.notifier, "/emit", NEW_EMIT);
    expect(newEmitResponse.status).toBe(200);
    const newEmit = await newEmitResponse.json() as { success: boolean; eventId: number };
    expect(newEmit).toMatchObject({ success: true, eventId: expectedEventId });
    const newUsageResponse = await post(f.notifier, "/usage", NEW_USAGE);
    expect(newUsageResponse.status).toBe(200);
    const accepted = await rawSnapshot(f.state.storage);
    expect(accepted.emitReceipts).toContainEqual({ key: NEW_EMIT.dedup_key,
      digest: await digestNotifierPayload({ runId: RUN_ID, type: NEW_EMIT.type, data: NEW_EMIT.data }),
      eventId: expectedEventId });
    expect(accepted.usageReceipts).toContainEqual({ requestId: NEW_USAGE.request_id,
      digest: await digestNotifierPayload({ runId: RUN_ID, meterType: NEW_USAGE.meter_type,
        units: NEW_USAGE.units, referenceType: null, metadata: null }) });
    expect(accepted.eventIdCounter).toBe(expectedEventId);
    expect(accepted.usageLedger).toMatchObject({ totals: { exec_seconds: 4 }, revision: 4 });

    const cold = f.make();
    await (cold as unknown as { initialized: Promise<void> }).initialized;
    f.state.resetListCalls();
    f.r2.resetListCalls();
    const eventBeforeRetries = (await rawSnapshot(f.state.storage)).eventIdCounter;
    const usageBeforeRetries = (await rawSnapshot(f.state.storage)).usageLedger as {
      totals: Record<string, number>; revision: number; projectedRevision: number;
    };
    const exactFirst = await (await post(cold, "/emit", {
      runId: RUN_ID, type: "progress", data: { historical: "first" }, dedup_key: EMIT_FIRST,
    })).json() as Record<string, unknown>;
    const exactLast = await (await post(cold, "/emit", {
      runId: RUN_ID, type: "progress", data: { historical: "last" }, dedup_key: EMIT_LAST,
    })).json() as Record<string, unknown>;
    expect(exactFirst).toMatchObject({ success: true, duplicate: true, eventId: 1 });
    expect(exactLast).toMatchObject({ success: true, duplicate: true,
      eventId: original.emitReceipts.at(-1)!.eventId });
    expect((await post(cold, "/emit", {
      runId: RUN_ID, type: "progress", data: { historical: "first", changed: true },
      dedup_key: EMIT_FIRST,
    })).status).toBe(409);
    expect((await post(cold, "/emit", {
      runId: RUN_ID, type: "progress", data: { historical: "last", changed: true },
      dedup_key: EMIT_LAST,
    })).status).toBe(409);
    expect((await post(cold, "/emit", {
      ...NEW_EMIT, data: { step: "changed" },
    })).status).toBe(409);
    const newEmitRetry = await (await post(cold, "/emit", NEW_EMIT)).json() as Record<string, unknown>;
    expect(newEmitRetry).toMatchObject({ success: true, duplicate: true, eventId: expectedEventId });

    const usageFirst = await (await post(cold, "/usage", {
      runId: RUN_ID, meter_type: "exec_seconds", units: 1, request_id: USAGE_FIRST,
    })).json() as Record<string, unknown>;
    const usageLast = await (await post(cold, "/usage", {
      runId: RUN_ID, meter_type: "exec_seconds", units: 2, request_id: USAGE_LAST,
    })).json() as Record<string, unknown>;
    expect(usageFirst).toMatchObject({ success: true, duplicate: true });
    expect(usageLast).toMatchObject({ success: true, duplicate: true });
    expect((await post(cold, "/usage", {
      runId: RUN_ID, meter_type: "exec_seconds", units: 2, request_id: USAGE_FIRST,
    })).status).toBe(409);
    expect((await post(cold, "/usage", {
      runId: RUN_ID, meter_type: "exec_seconds", units: 1, request_id: USAGE_LAST,
    })).status).toBe(409);
    expect((await post(cold, "/usage", {
      ...NEW_USAGE, units: 2,
    })).status).toBe(409);
    expect(await (await post(cold, "/usage", NEW_USAGE)).json())
      .toMatchObject({ success: true, duplicate: true });

    const afterRetries = await rawSnapshot(f.state.storage);
    expect(afterRetries.eventIdCounter).toBe(eventBeforeRetries);
    expect(afterRetries.usageLedger).toMatchObject({ totals: usageBeforeRetries.totals,
      revision: usageBeforeRetries.revision, projectedRevision: usageBeforeRetries.projectedRevision });
    expect(afterRetries.usageLedger).toMatchObject({ totals: { exec_seconds: 4 }, revision: 4 });
    expect(f.state.listPrefixes().some((prefix) => prefix.startsWith("run-receipt-v1/")))
      .toBe(false);
    expect(f.r2.listCalls()).toBe(0);
    assertNotifierSnapshotBudget(afterRetries, [], RESERVE_BYTES);
    expect(afterRetries.emitReceipts).toContainEqual(expect.objectContaining({
      key: NEW_EMIT.dedup_key, eventId: expectedEventId,
    }));
    expect(afterRetries.usageReceipts).toContainEqual(expect.objectContaining({
      requestId: NEW_USAGE.request_id,
    }));
    const head = f.state.values.get("bufferState") as {
      snapshot: { bytes: number; chunks: string[] };
      blobs: { bytes: number; chunks: string[] }[];
    };
    expect(head.snapshot.bytes + head.blobs.reduce((sum, ref) => sum + ref.bytes, 0) +
      RESERVE_BYTES).toBeLessThanOrEqual(MAX_HEAD_BYTES);
    expect(head.snapshot.chunks.length +
      head.blobs.reduce((sum, ref) => sum + ref.chunks.length, 0) + 48).toBeLessThanOrEqual(128);
  } finally {
    // The fixture is entirely in-memory; no external or persistent cleanup is needed.
  }
});
