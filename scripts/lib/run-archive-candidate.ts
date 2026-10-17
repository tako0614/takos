/** Offline, one-way conversion of an operator export into a new isolated archive. */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createGunzip, gzipSync } from "node:zlib";
import type { DurableObjectStorageBinding, DurableObjectStateBinding, DurableNamespaceBinding, ObjectStoreBinding } from "../../src/worker/shared/types/bindings.ts";
import type { Env } from "../../src/worker/shared/types/index.ts";
import type { PersistedRunEvent } from "../../src/worker/application/services/offload/run-events.ts";
import { buildRunEventSegmentKey } from "../../src/worker/application/services/offload/run-events.ts";
import { getIndexedRunEventsAfter, inspectRunArchiveSegment } from "../../src/worker/application/services/offload/indexed-run-events.ts";
import { loadNotifierSnapshot, persistNotifierSnapshot, readNotifierBlob, assertNotifierSnapshotBudget } from "../../src/worker/runtime/durable-objects/notifier-journal.ts";
import { parseRunNotifierJournalState, type RunNotifierJournalState } from "../../src/worker/runtime/durable-objects/run-notifier-journal-state.ts";
import { RunNotifierDO } from "../../src/worker/runtime/durable-objects/run-notifier.ts";
import { newRunArchiveState } from "../../src/worker/runtime/durable-objects/run-archive-maintenance.ts";
import { archiveNodeKey, hashArchiveJSON, prepareArchiveInsert, queryArchive, stageArchiveInsert } from "../../src/worker/runtime/durable-objects/run-archive-index.ts";
import {
  parseReceiptEntry,
  prepareReceiptBootstrap,
  prepareReceiptInsert,
  readReceiptBootstrapProgress,
  receiptBootstrapProgressKey,
  receiptNodeKey,
  stageReceiptBootstrapBatch,
  validateReceiptNode,
  visitReceiptIndexClosure,
  type ReceiptNodeRef,
  type ReceiptEntry,
} from "../../src/worker/runtime/durable-objects/run-receipt-index.ts";
import {
  newReceiptIndexState,
  parseReceiptRetiredRecord,
  receiptRetiredKey,
} from "../../src/worker/runtime/durable-objects/run-receipt-maintenance.ts";
import type { ArchiveDescriptor, ArchiveRoot } from "../../src/worker/shared/contracts/run-archive.ts";

const MiB = 1024 * 1024;
const MAX_SOURCE_COMPRESSED = 256 * MiB;
const MAX_SOURCE_EXPANDED = 200 * MiB;
const MAX_CANDIDATE_BYTES = 8 * MiB;
const SHA = /^[a-f0-9]{64}$/;
const RUN_ID = /^[a-zA-Z0-9_-]{1,64}$/;
const encoder = new TextEncoder();

export type ArchiveObject = { key: string; bytes: number; sha256: string };
export type CandidateInput = {
  runId: string;
  storage: DurableObjectStorageBinding;
  objects: ArchiveObject[];
  readObject(key: string): Promise<Uint8Array>;
  writeObject(key: string, bytes: Uint8Array): Promise<void>;
  readCandidateObject(key: string): Promise<Uint8Array>;
};
export type CandidateVerification = {
  eventCount: number;
  firstEventId: number;
  lastEventId: number;
  eventDigest: string;
  preservedStateDigest: string;
  root: ArchiveRoot;
  /** Forward-packed legacy receipt identities, independent of their old layout. */
  receiptDigest?: string;
};
export type CandidateSource = {
  sourceHeadDigest: string;
  sourceEventDigest: string;
  sourceObjectDigest: string;
};
export type CandidateResult = {
  values: Map<string, unknown>;
  objects: ArchiveObject[];
  verification: CandidateVerification;
  source: CandidateSource;
};
export type VerifyCandidateInput = Pick<CandidateInput, "runId" | "storage" | "objects" | "readObject"> & {
  verification: CandidateVerification;
};

function fail(reason: string): never { throw new Error(`Archive candidate: ${reason}`); }
function digest(bytes: Uint8Array | string): string { return createHash("sha256").update(bytes).digest("hex"); }
function safeJSON(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) fail("unserializable state");
  return encoded;
}
function canonical(event: PersistedRunEvent): PersistedRunEvent {
  return { event_id: event.event_id, type: event.type, data: event.data, created_at: event.created_at };
}
function line(event: PersistedRunEvent): string { return safeJSON(canonical(event)) + "\n"; }
function segmentIndex(key: string, runId: string, kind: "events" | "usage"): number {
  const prefix = `runs/${runId}/${kind}/`;
  if (!key.startsWith(prefix)) fail("foreign object key");
  const suffix = key.slice(prefix.length);
  if (!/^\d+\.jsonl\.gz$/.test(suffix)) fail("noncanonical object key");
  const index = Number(suffix.slice(0, -9));
  if (!Number.isSafeInteger(index) || index < 1 ||
    key !== `${prefix}${String(index).padStart(6, "0")}.jsonl.gz`) fail("noncanonical object key");
  return index;
}
function validateObjectInventory(runId: string, objects: ArchiveObject[]): ArchiveObject[] {
  if (!RUN_ID.test(runId) || !Array.isArray(objects) || objects.length > 100_000) fail("invalid source inventory");
  const seen = new Set<string>();
  for (const item of objects) {
    if (!item || typeof item.key !== "string" || seen.has(item.key) ||
      !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > MAX_SOURCE_COMPRESSED ||
      typeof item.sha256 !== "string" || !SHA.test(item.sha256)) fail("invalid source inventory");
    seen.add(item.key);
    segmentIndex(item.key, runId, item.key.includes("/events/") ? "events" : "usage");
  }
  return [...objects].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
async function sourceBytes(item: ArchiveObject, readObject: CandidateInput["readObject"]): Promise<Uint8Array> {
  const bytes = await readObject(item.key);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== item.bytes || digest(bytes) !== item.sha256) {
    fail("source object digest or length mismatch");
  }
  return bytes;
}

/** The source reader is intentionally different from the 8 MiB live reader. */
async function* legacyEvents(bytes: Uint8Array): AsyncGenerator<PersistedRunEvent> {
  if (bytes.byteLength > MAX_SOURCE_COMPRESSED) fail("legacy compressed size limit");
  const gunzip = Readable.from((function* () {
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) yield bytes.subarray(offset, offset + 64 * 1024);
  })()).pipe(createGunzip());
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let expanded = 0;
  let pending = "";
  let previous = 0;
  try {
    for await (const chunk of gunzip) {
      const part = chunk as Uint8Array;
      expanded += part.byteLength;
      if (expanded > MAX_SOURCE_EXPANDED) fail("legacy expanded size limit");
      pending += decoder.decode(part, { stream: true });
      let boundary: number;
      while ((boundary = pending.indexOf("\n")) >= 0) {
        const raw = pending.slice(0, boundary);
        pending = pending.slice(boundary + 1);
        if (!raw) fail("empty legacy JSONL record");
        let event: unknown;
        try { event = JSON.parse(raw); } catch { fail("malformed legacy JSONL"); }
        const record = event as Record<string, unknown>;
        if (!record || typeof record !== "object" || Array.isArray(record) ||
          Object.keys(record).length !== 4 ||
          !["event_id", "type", "data", "created_at"].every((key) => Object.hasOwn(record, key)) ||
          !Number.isSafeInteger(record.event_id) || (record.event_id as number) <= previous ||
          typeof record.type !== "string" || !record.type || record.type.length > 256 ||
          typeof record.data !== "string" || typeof record.created_at !== "string" ||
          !Number.isFinite(Date.parse(record.created_at))) fail("invalid or out-of-order legacy event");
        const parsed = canonical(record as unknown as PersistedRunEvent);
        if (encoder.encode(line(parsed)).byteLength > MAX_CANDIDATE_BYTES) fail("single event exceeds candidate size limit");
        previous = parsed.event_id;
        yield parsed;
      }
      if (encoder.encode(pending).byteLength > MAX_CANDIDATE_BYTES) fail("single event exceeds candidate size limit");
    }
    pending += decoder.decode();
    if (pending || previous === 0) fail("noncanonical or empty legacy JSONL");
  } catch (error) {
    gunzip.destroy();
    if (error instanceof Error && error.message.startsWith("Archive candidate:")) throw error;
    fail("invalid legacy gzip or UTF-8");
  }
}

function stateWitness(state: RunNotifierJournalState, receiptDigest?: string): string {
  return digest(safeJSON({ runId: state.runId, eventIdCounter: state.eventIdCounter,
    eventBuffer: state.eventBuffer,
    ...(receiptDigest === undefined ? { emitDedupKeys: state.emitDedupKeys,
      emitReceipts: state.emitReceipts, usageReceipts: state.usageReceipts,
      ...(state.receiptIndex ? { receiptIndex: state.receiptIndex } : {}) } : { receiptDigest }),
    usageSegmentIndex: state.usageSegmentIndex,
    usageSegmentBuffer: state.usageSegmentBuffer,
    usageLastFlushedSegmentIndex: state.usageLastFlushedSegmentIndex,
    legacyPendingUsageCount: state.legacyPendingUsageCount,
    usageIntent: state.flushIntents.find((item) => item.kind === "usage") ?? null,
    // Preserve the old witness for pre-ledger exports. A new ledger, including
    // a building/repair fence or unacknowledged revision, is never discarded.
    ...(state.usageLedger ? { usageLedger: state.usageLedger } : {}) }));
}

function legacyReceiptEntries(state: RunNotifierJournalState): ReceiptEntry[] {
  const entries = new Map<string, ReceiptEntry>();
  function retain(raw: ReceiptEntry): void {
    const entry = parseReceiptEntry(raw);
    entries.set(safeJSON([entry.namespace, entry.key]), entry);
  }
  // Exact receipts take precedence over old opaque keys, as in RunNotifier.
  for (const [key, legacyAcceptedAt] of state.emitDedupKeys) retain({ namespace: "emit", key, legacyAcceptedAt });
  for (const entry of state.emitReceipts) retain({ namespace: "emit", ...entry });
  for (const entry of state.usageReceipts) retain({ namespace: "usage", key: entry.requestId, digest: entry.digest });
  return [...entries.values()].sort((a, b) => a.namespace === b.namespace
    ? a.key < b.key ? -1 : a.key > b.key ? 1 : 0 : a.namespace === "emit" ? -1 : 1);
}

function receiptEntriesDigest(entries: Iterable<ReceiptEntry>): string {
  const hash = createHash("sha256");
  for (const entry of entries) hash.update(safeJSON(entry) + "\n");
  return hash.digest("hex");
}

async function indexedReceiptDigest(storage: DurableObjectStorageBinding,
  state: RunNotifierJournalState): Promise<string> {
  if (!state.receiptIndex || state.receiptIndex.phase !== "ready" ||
    state.receiptIndex.bootstrapStage || state.receiptIndex.stage ||
    state.emitReceipts.length || state.usageReceipts.length ||
    state.emitDedupKeys.length || state.receiptIndex.gcTopHash || state.receiptIndex.gcCleanupHash) {
    fail("forward-packed receipt state is incomplete");
  }
  const hash = createHash("sha256");
  await visitReceiptIndexClosure(storage, state.receiptIndex.root, {
    entry: (entry) => { hash.update(safeJSON(entry) + "\n"); },
  });
  return hash.digest("hex");
}

function mapStorage(values: Map<string, unknown>): DurableObjectStorageBinding {
  return {
    get: async <T>(key: string) => structuredClone(values.get(key)) as T | undefined,
    put: async (key: string | Record<string, unknown>, value?: unknown) => {
      if (typeof key === "string") values.set(key, structuredClone(value));
      else for (const [name, entry] of Object.entries(key)) values.set(name, structuredClone(entry));
    },
    delete: async (key: string | string[]) => {
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

async function allDescriptors(storage: DurableObjectStorageBinding, root: ArchiveRoot): Promise<ArchiveDescriptor[]> {
  const result: ArchiveDescriptor[] = [];
  const indexes = new Set<number>();
  let cursor = 0;
  while (true) {
    const page = await queryArchive(storage, root, cursor, 512);
    for (const item of page.descriptors) {
      if (item.firstEventId <= cursor || indexes.has(item.segmentIndex)) {
        fail("source index overlaps or repeats a segment");
      }
      result.push(item);
      indexes.add(item.segmentIndex);
      if (result.length > 100_000) fail("source index descriptor limit");
      cursor = item.lastEventId;
    }
    if (!page.hasMore) return result;
    if (!page.descriptors.length) fail("source index made no progress");
  }
}

async function reachableNodeHashes(storage: DurableObjectStorageBinding, root: ArchiveRoot): Promise<Set<string>> {
  const reachable = new Set<string>();
  const pending = root.hash ? [root.hash] : [];
  while (pending.length) {
    const nodeHash = pending.pop()!;
    const key = archiveNodeKey(nodeHash);
    if (reachable.has(nodeHash)) continue;
    reachable.add(nodeHash);
    if (reachable.size > 100_000) fail("archive node count limit");
    const raw = await storage.get<unknown>(key);
    if (typeof raw !== "string" || await hashArchiveJSON(raw) !== nodeHash) fail("archive node inventory");
    let node: unknown;
    try { node = JSON.parse(raw); } catch { fail("archive node JSON"); }
    const value = node as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value) || value.v !== 1 ||
      (value.t !== "leaf" && value.t !== "branch")) fail("archive node shape");
    if (value.t === "branch") {
      if (!Array.isArray(value.children)) fail("archive branch children");
      for (const child of value.children) {
        const hash = (child as { hash?: unknown })?.hash;
        if (typeof hash !== "string" || !SHA.test(hash)) fail("archive child hash");
        pending.push(hash);
      }
    }
  }
  return reachable;
}

/** Copy only authenticated receipt state; absent retired copies can be partial GC. */
async function receiptClosure(
  storage: DurableObjectStorageBinding, state: RunNotifierJournalState,
): Promise<{ values: Map<string, string>; emitIds: Set<number> }> {
  const values = new Map<string, string>();
  const emitIds = new Set<number>();
  const index = state.receiptIndex;
  if (!index) return { values, emitIds };
  function retain(key: string, json: string): void {
    if (values.has(key) && values.get(key) !== json) fail("receipt inventory collision");
    values.set(key, json);
    if (values.size > 100_000) fail("receipt KV inventory limit");
  }
  await visitReceiptIndexClosure(storage, index.root, {
    node: (ref, json) => retain(receiptNodeKey(ref.hash), json),
    entry: (entry) => {
      if (entry.namespace === "emit" && "eventId" in entry) {
        if (entry.eventId > state.eventIdCounter) fail("receipt event exceeds committed counter");
        emitIds.add(entry.eventId);
      }
    },
  });
  async function retiredNode(ref: ReceiptNodeRef): Promise<void> {
    const raw = await storage.get<unknown>(receiptNodeKey(ref.hash));
    if (raw === undefined) return;
    if (typeof raw !== "string") fail("retired receipt node shape");
    // A hash may legitimately become live again after a later split. Verify
    // it; the runtime collector must skip it rather than delete active bytes.
    await validateReceiptNode(ref, raw);
    retain(receiptNodeKey(ref.hash), raw);
  }
  async function retiredRecord(recordHash: string, optional: boolean): Promise<
    ReturnType<typeof parseReceiptRetiredRecord> | null
  > {
    const raw = await storage.get<unknown>(receiptRetiredKey(recordHash));
    if (raw === undefined && optional) return null;
    if (typeof raw !== "string" || digest(raw) !== recordHash) fail("receipt retired record integrity");
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { fail("receipt retired record JSON"); }
    const record = parseReceiptRetiredRecord(parsed);
    if (safeJSON(record) !== raw) fail("receipt retired record canonical shape");
    retain(receiptRetiredKey(recordHash), raw);
    for (const ref of record.nodes) await retiredNode(ref);
    return record;
  }
  let recordHash = index.gcTopHash;
  let records = 0;
  const seen = new Set<string>();
  while (recordHash !== null) {
    if (seen.has(recordHash) || records >= index.gcRecords) fail("receipt retired chain cycle/count");
    seen.add(recordHash);
    const record = await retiredRecord(recordHash, false);
    recordHash = record!.previous;
    records++;
  }
  if (records !== index.gcRecords) fail("receipt retired chain count");
  if (index.gcCleanupHash !== null) await retiredRecord(index.gcCleanupHash, true);
  if (index.bootstrapStage) {
    const stage = index.bootstrapStage;
    const expected = await prepareReceiptBootstrap(state);
    if (safeJSON(expected.plan) !== safeJSON(stage.plan)) fail("receipt bootstrap plan integrity");
    const progress = await readReceiptBootstrapProgress(storage, stage.plan);
    if (progress.json !== null) retain(receiptBootstrapProgressKey(stage.plan.sourceDigest), progress.json);
    const completed = Math.max(stage.cursor, progress.cursor);
    for (let position = 0; position < expected.writes.length; position++) {
      const write = expected.writes[position]!;
      const raw = await storage.get<unknown>(receiptNodeKey(write.hash));
      if (raw === undefined && position >= completed) continue;
      if (raw !== write.json || digest(write.json) !== write.hash) fail("receipt bootstrap node integrity");
      retain(receiptNodeKey(write.hash), write.json);
    }
  }
  if (index.stage) {
    const stage = index.stage;
    const expected = await prepareReceiptInsert(storage, stage.plan.previousRoot, stage.plan.entry);
    if (safeJSON(expected.plan) !== safeJSON(stage.plan)) fail("receipt staged plan integrity");
    for (const write of expected.writes) {
      const raw = await storage.get<unknown>(receiptNodeKey(write.hash));
      if (raw === undefined) continue;
      if (raw !== write.json || digest(write.json) !== write.hash) fail("receipt staged node integrity");
      retain(receiptNodeKey(write.hash), write.json);
    }
    if (stage.gc) {
      let parsed: unknown;
      try { parsed = JSON.parse(stage.gc.json); } catch { fail("receipt staged retired JSON"); }
      const record = parseReceiptRetiredRecord(parsed);
      if (digest(stage.gc.json) !== stage.gc.hash || safeJSON(record) !== stage.gc.json ||
        safeJSON(record.nodes) !== safeJSON(stage.plan.retired) || record.previous !== index.gcTopHash) {
        fail("receipt staged retired integrity");
      }
      const raw = await storage.get<unknown>(receiptRetiredKey(stage.gc.hash));
      if (raw !== undefined && raw !== stage.gc.json) fail("receipt staged retired collision");
      if (raw !== undefined) retain(receiptRetiredKey(stage.gc.hash), stage.gc.json);
    }
  }
  return { values, emitIds };
}

async function assertExactCandidateKV(
  storage: DurableObjectStorageBinding, root: ArchiveRoot, receipts: Map<string, string>,
): Promise<void> {
  const head = await storage.get<unknown>("bufferState") as Record<string, unknown> | undefined;
  if (!head || typeof head !== "object" || !Array.isArray(head.blobs)) fail("candidate head inventory");
  const allowed = new Set<string>(["bufferState"]);
  for (const ref of [head.snapshot, ...head.blobs]) {
    const chunks = (ref as { chunks?: unknown }).chunks;
    if (!Array.isArray(chunks) || chunks.some((item) => typeof item !== "string" || !SHA.test(item))) {
      fail("candidate chunk inventory");
    }
    for (const hash of chunks) allowed.add(`notifier-v2/chunks/${hash}`);
  }
  for (const node of await reachableNodeHashes(storage, root)) allowed.add(archiveNodeKey(node));
  for (const key of receipts.keys()) allowed.add(key);
  const actual = new Set<string>();
  let startAfter: string | undefined;
  while (true) {
    const page = await storage.list({ startAfter, limit: 1000 });
    if (page.size > 1000) fail("candidate KV page limit");
    let last = startAfter;
    for (const key of page.keys()) {
      if (last !== undefined && key <= last || actual.has(key)) fail("candidate KV pagination did not progress");
      actual.add(key);
      last = key;
    }
    if (actual.size > 100_000) fail("candidate KV inventory limit");
    if (page.size === 0) break;
    startAfter = last;
  }
  if (actual.size !== allowed.size || [...actual].some((key) => !allowed.has(key))) {
    fail("candidate KV contains missing or unlisted state");
  }
}

async function validateSourceArchive(
  storage: DurableObjectStorageBinding, state: RunNotifierJournalState,
  finalized: Map<string, ArchiveDescriptor>,
): Promise<void> {
  const archive = state.archive;
  if (!archive) return;
  const indexed = await allDescriptors(storage, archive.root);
  const reachable = await reachableNodeHashes(storage, archive.root);
  for (const descriptor of indexed) {
    const known = finalized.get(descriptor.key);
    if (!known || safeJSON(known) !== safeJSON(descriptor)) fail("source index conflicts with finalized body");
  }
  if (archive.phase === "ready" && indexed.length !== finalized.size) fail("ready source root omits finalized body");
  if (archive.stage) {
    const stage = archive.stage;
    const expected = await prepareArchiveInsert(storage, stage.plan.previousRoot, stage.plan.descriptor);
    if (safeJSON(expected) !== safeJSON(stage.plan) ||
      stage.gc && await hashArchiveJSON(stage.gc.json) !== stage.gc.hash) fail("source stage plan integrity");
    if (stage.purpose === "build") {
      const known = finalized.get(stage.plan.descriptor.key);
      if (!known || safeJSON(known) !== safeJSON(stage.plan.descriptor)) {
        fail("source build stage conflicts with finalized body");
      }
    }
    // New immutable nodes and the retired record are staged before head
    // publication; any subset may be absent after a crash. Present copies must
    // match the authenticated plan exactly. The candidate re-packs independently.
    for (const write of stage.plan.writes) {
      const raw = await storage.get<unknown>(archiveNodeKey(write.hash));
      if (raw !== undefined && (raw !== write.json || await hashArchiveJSON(raw as string) !== write.hash)) {
        fail("source staged node integrity");
      }
    }
    if (stage.gc) {
      const raw = await storage.get<unknown>(`run-archive-v3/retired/${stage.gc.hash}`);
      if (raw !== undefined && raw !== stage.gc.json) fail("source staged retired record integrity");
    }
  }
  let gcHash = archive.gcTopHash;
  let count = 0;
  const visited = new Set<string>();
  while (gcHash) {
    if (visited.has(gcHash)) fail("source retired chain cycle");
    visited.add(gcHash);
    const raw = await storage.get<unknown>(`run-archive-v3/retired/${gcHash}`);
    if (typeof raw !== "string" || raw.length > 8192 || await hashArchiveJSON(raw) !== gcHash) fail("source retired chain integrity");
    let record: unknown;
    try { record = JSON.parse(raw); } catch { fail("source retired chain JSON"); }
    const r = record as Record<string, unknown>;
    if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).length !== 3 ||
      r.schemaVersion !== 1 || !Array.isArray(r.nodes) || r.nodes.length < 1 || r.nodes.length > 32 ||
      r.nodes.some((value) => typeof value !== "string" || !SHA.test(value)) ||
      new Set(r.nodes).size !== r.nodes.length ||
      !(r.previous === null || typeof r.previous === "string" && SHA.test(r.previous)) ||
      r.nodes.some((node) => reachable.has(node))) fail("source retired chain shape");
    gcHash = r.previous as string | null;
    count++;
  }
  if (count !== archive.gcRecords) fail("source retired chain count");
  if (archive.gcCleanupHash && await storage.get(`run-archive-v3/retired/${archive.gcCleanupHash}`) !== undefined) {
    // It may still exist after a failed cleanup, but it is outside the live chain.
    const raw = await storage.get(`run-archive-v3/retired/${archive.gcCleanupHash}`);
    if (typeof raw !== "string" || await hashArchiveJSON(raw) !== archive.gcCleanupHash) fail("source cleanup record integrity");
  }
}

function assertPendingEvent(event: PersistedRunEvent): void {
  if (encoder.encode(line(event)).byteLength > MAX_CANDIDATE_BYTES) fail("single pending event exceeds candidate size limit");
}

export async function convertRunArchiveCandidate(input: CandidateInput): Promise<CandidateResult> {
  const inventory = validateObjectInventory(input.runId, input.objects);
  const rawHead = await input.storage.get<unknown>("bufferState");
  if (rawHead === undefined) fail("source has no committed head");
  const sourceHeadDigest = digest(safeJSON(rawHead));
  const state = parseRunNotifierJournalState(await loadNotifierSnapshot(input.storage, "run"));
  if (!state || state.runId !== input.runId) fail("source run identity mismatch");
  const receipts = await receiptClosure(input.storage, state);
  for (const intent of state.flushIntents) {
    const bytes = new Uint8Array(await readNotifierBlob(input.storage, intent.blob));
    // The accepted frozen prefix is exact JSONL, including field order and newline.
    let plain: string;
    try { plain = new TextDecoder("utf-8", { fatal: true }).decode(await (async () => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of Readable.from([bytes]).pipe(createGunzip())) {
        size += (chunk as Uint8Array).byteLength;
        if (size > MAX_CANDIDATE_BYTES) fail("intent expanded size limit");
        chunks.push(chunk as Uint8Array);
      }
      return Buffer.concat(chunks);
    })()); } catch { fail("intent gzip integrity"); }
    const pending = intent.kind === "run" ? state.r2SegmentBuffer : state.usageSegmentBuffer;
    if (plain !== pending.slice(0, intent.count).map((entry) => safeJSON(entry)).join("\n") + "\n") {
      fail("intent does not match accepted pending prefix");
    }
  }

  const sourceObjectDigest = digest(safeJSON(inventory));
  const eventObjects = inventory.filter((item) => item.key.includes("/events/"))
    .sort((a, b) => segmentIndex(a.key, input.runId, "events") - segmentIndex(b.key, input.runId, "events"));
  const usageObjects = inventory.filter((item) => item.key.includes("/usage/"));
  if (state.r2LastFlushedSegmentIndex > 0 && !eventObjects.some((item) =>
    item.key === buildRunEventSegmentKey(input.runId, state.r2LastFlushedSegmentIndex))) {
    fail("committed event frontier object is missing");
  }
  if (state.usageLastFlushedSegmentIndex > 0 && !usageObjects.some((item) =>
    item.key === `runs/${input.runId}/usage/${String(state.usageLastFlushedSegmentIndex).padStart(6, "0")}.jsonl.gz`)) {
    fail("committed usage frontier object is missing");
  }
  const finalized = new Map<string, ArchiveDescriptor>();
  const eventHash = createHash("sha256");
  const ringById = new Map(state.eventBuffer.map((entry) => [entry.id, entry]));
  const wanted = new Set([...ringById.keys(), ...state.emitReceipts.map((entry) => entry.eventId),
    ...receipts.emitIds]);
  let eventCount = 0;
  let firstEventId = 0;
  let lastEventId = 0;
  const candidateValues = new Map<string, unknown>(receipts.values);
  const candidateStorage = mapStorage(candidateValues);
  const legacyEntries = state.receiptIndex ? null : legacyReceiptEntries(state);
  const forwardPack = legacyEntries !== null && legacyEntries.length > 64;
  const receiptDigest = forwardPack ? receiptEntriesDigest(legacyEntries!) : undefined;
  let candidateReceiptIndex = state.receiptIndex;
  if (forwardPack) {
    const source = { emitReceipts: state.emitReceipts, usageReceipts: state.usageReceipts,
      emitDedupKeys: state.emitDedupKeys };
    const prepared = await prepareReceiptBootstrap(source);
    const { plan } = prepared;
    let cursor = 0;
    while (cursor < plan.writeHashes.length) {
      cursor = await stageReceiptBootstrapBatch(candidateStorage, source, plan, cursor, prepared);
    }
    candidateReceiptIndex = { ...newReceiptIndexState(), root: plan.root };
  }
  const candidateObjects: ArchiveObject[] = [];
  let root = newRunArchiveState().root;
  let segmentNumber = 0;
  let chunk: PersistedRunEvent[] = [];
  let chunkBytes = 0;
  async function emitChunk(events: PersistedRunEvent[]): Promise<void> {
    if (!events.length) return;
    let plain = events.map(line).join("");
    let bytes = gzipSync(plain);
    if (encoder.encode(plain).byteLength > MAX_CANDIDATE_BYTES || bytes.byteLength > MAX_CANDIDATE_BYTES) {
      if (events.length === 1) fail("single event cannot fit candidate segment");
      const middle = Math.floor(events.length / 2);
      await emitChunk(events.slice(0, middle));
      await emitChunk(events.slice(middle));
      return;
    }
    if (candidateObjects.length >= 100_000) fail("candidate object inventory limit");
    segmentNumber++;
    const key = buildRunEventSegmentKey(input.runId, segmentNumber);
    const inspected = await inspectRunArchiveSegment(bytes.buffer.slice(bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength), key, segmentNumber, input.runId);
    if (safeJSON(inspected.events) !== safeJSON(events.map(canonical))) fail("candidate segment roundtrip mismatch");
    const plan = await prepareArchiveInsert(candidateStorage, root, inspected.descriptor);
    if (plan.duplicate) fail("candidate duplicate segment");
    await stageArchiveInsert(candidateStorage, plan);
    root = plan.root;
    for (const old of plan.retired) await candidateStorage.delete(archiveNodeKey(old));
    await input.writeObject(key, bytes);
    candidateObjects.push({ key, bytes: bytes.byteLength, sha256: digest(bytes) });
    plain = "";
  }
  async function accept(event: PersistedRunEvent): Promise<void> {
    assertPendingEvent(event);
    if (event.event_id <= lastEventId || event.event_id > state!.eventIdCounter) fail("source event order or counter mismatch");
    const encoded = line(event);
    const size = encoder.encode(encoded).byteLength;
    if (chunk.length && (chunk.length >= 100 || chunkBytes + size > MAX_CANDIDATE_BYTES)) {
      await emitChunk(chunk);
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(event);
    chunkBytes += size;
    eventHash.update(encoded);
    const ring = ringById.get(event.event_id);
    if (ring && (ring.type !== event.type ||
      (typeof ring.data === "string" ? ring.data : safeJSON(ring.data)) !== event.data)) {
      fail("ring payload conflicts with source history");
    }
    wanted.delete(event.event_id);
    eventCount++;
    if (!firstEventId) firstEventId = event.event_id;
    lastEventId = event.event_id;
  }

  for (const item of eventObjects) {
    const index = segmentIndex(item.key, input.runId, "events");
    const bytes = await sourceBytes(item, input.readObject);
    let objectCount = 0;
    let objectFirst = 0;
    let objectLast = 0;
    let unfinalizedPlain = "";
    for await (const event of legacyEvents(bytes)) {
      objectCount++;
      objectFirst ||= event.event_id;
      objectLast = event.event_id;
      if (index > state.r2LastFlushedSegmentIndex) {
        unfinalizedPlain += line(event);
        if (encoder.encode(unfinalizedPlain).byteLength > MAX_CANDIDATE_BYTES) {
          fail("uncommitted event body exceeds accepted pending budget");
        }
      }
      if (index <= state.r2LastFlushedSegmentIndex) await accept(event);
    }
    if (!objectCount) fail("empty source event object");
    if (index <= state.r2LastFlushedSegmentIndex) {
      finalized.set(item.key, { key: item.key, segmentIndex: index,
        firstEventId: objectFirst, lastEventId: objectLast, count: objectCount,
        sha256: item.sha256, bytes: item.bytes });
    } else {
      const intent = state.flushIntents.find((entry) => entry.kind === "run");
      const pending = state.r2SegmentBuffer.slice(0, objectCount);
      const pendingPlain = pending.map(line).join("");
      const expectedIndex = Math.max(state.r2SegmentIndex, state.r2LastFlushedSegmentIndex + 1,
        Math.floor(((state.r2SegmentBuffer[0]?.event_id ?? 1) - 1) / 100) + 1);
      if (index !== expectedIndex || pending.length !== objectCount ||
        unfinalizedPlain !== pendingPlain || intent &&
        (intent.key !== item.key || intent.count !== objectCount ||
          intent.origin === "journal" && (intent.blob.digest !== item.sha256 || intent.blob.bytes !== item.bytes)) ||
        !intent && objectCount > state.legacyPendingRunCount) fail("uncommitted event body lacks accepted witness");
    }
  }
  await validateSourceArchive(input.storage, state, finalized);
  for (const event of state.r2SegmentBuffer) await accept(event);
  await emitChunk(chunk);
  if (lastEventId !== state.eventIdCounter) fail("accepted event frontier does not reach counter");
  if (wanted.size) fail("ring or emit receipt event missing from source history");
  for (const item of usageObjects) {
    const index = segmentIndex(item.key, input.runId, "usage");
    const bytes = await sourceBytes(item, input.readObject);
    if (index > state.usageLastFlushedSegmentIndex) {
      const intent = state.flushIntents.find((entry) => entry.kind === "usage");
      const expected = state.usageSegmentBuffer.slice(0, intent?.count ?? state.legacyPendingUsageCount)
        .map((entry) => safeJSON(entry)).join("\n") + "\n";
      let plain: string;
      try {
        const chunks: Uint8Array[] = [];
        let expanded = 0;
        for await (const part of Readable.from([bytes]).pipe(createGunzip())) {
          expanded += (part as Uint8Array).byteLength;
          if (expanded > MAX_CANDIDATE_BYTES) fail("uncommitted usage expanded size limit");
          chunks.push(part as Uint8Array);
        }
        plain = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      } catch { fail("uncommitted usage gzip integrity"); }
      if (index !== (intent?.segmentIndex ?? state.usageSegmentIndex) ||
        item.key !== (intent?.key ?? `runs/${input.runId}/usage/${String(state.usageSegmentIndex).padStart(6, "0")}.jsonl.gz`) ||
        plain !== expected || intent && intent.origin === "journal" &&
        (intent.blob.digest !== item.sha256 || intent.blob.bytes !== item.bytes) ||
        !intent && state.legacyPendingUsageCount === 0) fail("uncommitted usage body lacks accepted witness");
    }
    if (candidateObjects.length >= 100_000) fail("candidate object inventory limit");
    await input.writeObject(item.key, bytes);
    candidateObjects.push({ ...item });
  }
  if (segmentNumber >= Number.MAX_SAFE_INTEGER || segmentNumber > state.eventIdCounter) fail("candidate segment sequence exhausted");
  const usageIntent = state.flushIntents.find((entry) => entry.kind === "usage");
  if (usageIntent) {
    const blob = new Uint8Array(await readNotifierBlob(input.storage, usageIntent.blob));
    const ref = await (await import("../../src/worker/runtime/durable-objects/notifier-journal.ts"))
      .stageNotifierBlob(candidateStorage, blob);
    if (safeJSON(ref) !== safeJSON(usageIntent.blob)) fail("usage intent blob changed during copy");
  }
  const archive = { ...newRunArchiveState(), phase: "ready" as const, root, build: null };
  const snapshot = { schemaVersion: candidateReceiptIndex ? 5 : 4, eventBuffer: state.eventBuffer,
    eventIdCounter: state.eventIdCounter, runId: state.runId,
    r2SegmentIndex: segmentNumber + 1, r2SegmentBuffer: [], r2LastFlushedSegmentIndex: segmentNumber,
    usageSegmentIndex: state.usageSegmentIndex, usageSegmentBuffer: state.usageSegmentBuffer,
    usageLastFlushedSegmentIndex: state.usageLastFlushedSegmentIndex,
    emitDedupKeys: forwardPack ? [] : state.emitDedupKeys, flushIntents: usageIntent ? [usageIntent] : [],
    emitReceipts: forwardPack ? [] : state.emitReceipts,
    usageReceipts: forwardPack ? [] : state.usageReceipts,
    legacyPendingRunCount: 0, legacyPendingUsageCount: state.legacyPendingUsageCount,
    archive, usageLedger: state.usageLedger,
    ...(candidateReceiptIndex ? { receiptIndex: candidateReceiptIndex } : {}) };
  if (!parseRunNotifierJournalState(snapshot)) fail("candidate snapshot is absent");
  const reserve = { bytes: 3 * MiB, digest: "0".repeat(64), chunks: Array(48).fill("0".repeat(64)) };
  assertNotifierSnapshotBudget(snapshot, [...(usageIntent ? [usageIntent.blob] : []), reserve]);
  await persistNotifierSnapshot(candidateStorage, "run", snapshot, usageIntent ? [usageIntent.blob] : []);
  const verification: CandidateVerification = { eventCount, firstEventId, lastEventId,
    eventDigest: eventHash.digest("hex"), preservedStateDigest: stateWitness(state, receiptDigest), root,
    ...(receiptDigest === undefined ? {} : { receiptDigest }) };
  await verifyRunArchiveCandidate({ runId: input.runId, storage: candidateStorage,
    objects: candidateObjects, readObject: input.readCandidateObject, verification });
  return { values: candidateValues, objects: candidateObjects, verification,
    source: { sourceHeadDigest, sourceEventDigest: verification.eventDigest, sourceObjectDigest } };
}

export async function verifyRunArchiveCandidate(input: VerifyCandidateInput): Promise<void> {
  const inventory = validateObjectInventory(input.runId, input.objects);
  const state = parseRunNotifierJournalState(await loadNotifierSnapshot(input.storage, "run"));
  if (!state || state.runId !== input.runId || !state.archive || state.archive.phase !== "ready" ||
    state.archive.stage || state.r2SegmentBuffer.length || state.legacyPendingRunCount ||
    state.r2LastFlushedSegmentIndex !== state.archive.root.entries ||
    state.r2SegmentIndex !== state.archive.root.entries + 1 ||
    safeJSON(state.archive.root) !== safeJSON(input.verification.root) ||
    stateWitness(state, input.verification.receiptDigest) !== input.verification.preservedStateDigest) {
    fail("candidate head or preserved state mismatch");
  }
  if (input.verification.receiptDigest !== undefined &&
    (typeof input.verification.receiptDigest !== "string" || !SHA.test(input.verification.receiptDigest) ||
      await indexedReceiptDigest(input.storage, state) !== input.verification.receiptDigest)) {
    fail("forward-packed receipt identity mismatch");
  }
  const receipts = await receiptClosure(input.storage, state);
  const reserve = { bytes: 3 * MiB, digest: "0".repeat(64), chunks: Array(48).fill("0".repeat(64)) };
  const { receiptIndex, ...preReceiptState } = state;
  assertNotifierSnapshotBudget(receiptIndex
    ? { ...preReceiptState, receiptIndex, schemaVersion: 5 } : { ...preReceiptState, schemaVersion: 4 }, [
    ...state.flushIntents.map((intent) => intent.blob), reserve,
  ]);
  const listed = new Map(inventory.map((item) => [item.key, item]));
  if (state.usageLastFlushedSegmentIndex > 0 && !listed.has(
    `runs/${input.runId}/usage/${String(state.usageLastFlushedSegmentIndex).padStart(6, "0")}.jsonl.gz`)) {
    fail("candidate committed usage frontier object is missing");
  }
  const descriptors = await allDescriptors(input.storage, state.archive.root);
  await assertExactCandidateKV(input.storage, state.archive.root, receipts.values);
  const eventObjects = inventory.filter((item) => item.key.includes("/events/"));
  if (eventObjects.length !== descriptors.length) fail("candidate descriptor inventory mismatch");
  for (let i = 0; i < descriptors.length; i++) {
    const descriptor = descriptors[i]!;
    const item = listed.get(descriptor.key);
    if (!item || descriptor.segmentIndex !== i + 1 ||
      item.bytes !== descriptor.bytes || item.sha256 !== descriptor.sha256) fail("candidate descriptor body mismatch");
  }
  for (const item of inventory) await sourceBytes(item, input.readObject);
  const storage = input.storage;
  const stateBinding = { storage, blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => fn(),
    getWebSockets: () => [], getTags: () => [], acceptWebSocket: () => undefined } as unknown as DurableObjectStateBinding;
  const objectStore = { get: async (key: string) => {
    const item = listed.get(key);
    if (!item) return null;
    const bytes = await sourceBytes(item, input.readObject);
    return { size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength) };
  }, list: async () => fail("candidate cold read attempted R2 LIST") } as unknown as ObjectStoreBinding;
  const notifier = new RunNotifierDO(stateBinding, { DB: {}, TAKOS_OFFLOAD: objectStore } as unknown as Env);
  const namespace = { idFromName: (id: string) => id,
    get: () => ({ fetch: (request: Request) => notifier.fetch(request) }) } as unknown as DurableNamespaceBinding;
  const actual = createHash("sha256");
  let count = 0;
  let first = 0;
  let last = 0;
  const witnesses = new Set([...state.eventBuffer.map((entry) => entry.id),
    ...state.emitReceipts.map((entry) => entry.eventId), ...receipts.emitIds]);
  const ringById = new Map(state.eventBuffer.map((entry) => [entry.id, entry]));
  for (const descriptor of descriptors) {
    const page = await getIndexedRunEventsAfter(namespace, objectStore, input.runId, last, descriptor.count);
    if (page.length !== descriptor.count || page[0]?.event_id !== descriptor.firstEventId ||
      page.at(-1)?.event_id !== descriptor.lastEventId) fail("candidate cold reader segment mismatch");
    for (const event of page) {
      if (event.event_id <= last) fail("candidate cold reader order mismatch");
      actual.update(line(event));
      const ring = ringById.get(event.event_id);
      if (ring && (ring.type !== event.type ||
        (typeof ring.data === "string" ? ring.data : safeJSON(ring.data)) !== event.data)) {
        fail("candidate ring payload mismatch");
      }
      witnesses.delete(event.event_id);
      first ||= event.event_id;
      last = event.event_id;
      count++;
    }
  }
  if ((await getIndexedRunEventsAfter(namespace, objectStore, input.runId, last, 1)).length) {
    fail("candidate cold reader returned unindexed tail");
  }
  if (count !== input.verification.eventCount || first !== input.verification.firstEventId ||
    last !== input.verification.lastEventId || actual.digest("hex") !== input.verification.eventDigest ||
    last !== state.eventIdCounter || witnesses.size) fail("candidate cold reader completeness mismatch");
}
