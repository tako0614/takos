import type { NotifierBlobRef } from "./notifier-journal.ts";
import { parseRunArchiveState, type RunArchiveState } from "./run-archive-maintenance.ts";
import { parseUsageLedgerState, type UsageLedgerState } from "./run-usage-ledger.ts";
import { APP_USAGE_METER_TYPES, type AppUsageMeterType } from "../../application/services/app-usage/usage-types.ts";
import {
  parseRunNotifierState,
  type RunNotifierState,
} from "./notifier-state.ts";

export type RunFlushKind = "run" | "usage";

export interface RunFlushIntent {
  kind: RunFlushKind;
  origin: "journal" | "legacy";
  segmentIndex: number;
  key: string;
  count: number;
  blob: NotifierBlobRef;
}

export interface EmitReceipt {
  key: string;
  digest: string;
  eventId: number;
}

export interface UsageReceipt {
  requestId: string;
  digest: string;
}

export type RunNotifierJournalState = RunNotifierState & {
  flushIntents: RunFlushIntent[];
  emitReceipts: EmitReceipt[];
  usageReceipts: UsageReceipt[];
  legacyPendingRunCount: number;
  legacyPendingUsageCount: number;
  archive: RunArchiveState | null;
  usageLedger: UsageLedgerState | null;
};

const BASE_KEYS = [
  "eventBuffer", "eventIdCounter", "runId", "r2SegmentIndex",
  "r2SegmentBuffer", "r2LastFlushedSegmentIndex", "usageSegmentIndex",
  "usageSegmentBuffer", "usageLastFlushedSegmentIndex", "emitDedupKeys",
];
const HEX_SHA256 = /^[a-f0-9]{64}$/;

function fail(field: string): never {
  throw new Error(`Invalid persisted run notifier journal: ${field}`);
}

function object(raw: unknown, field: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail(field);
  return raw as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: string[], field: string): void {
  if (Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))) fail(field);
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) fail(field);
  return value;
}

function digest(value: unknown, field: string): string {
  if (typeof value !== "string" || !HEX_SHA256.test(value)) fail(field);
  return value;
}

function blobRef(raw: unknown): NotifierBlobRef {
  const value = object(raw, "blob");
  exactKeys(value, ["bytes", "digest", "chunks"], "blob.fields");
  const bytes = positiveInt(value.bytes, "blob.bytes");
  if (bytes > 8 * 1024 * 1024 || !Array.isArray(value.chunks) ||
    value.chunks.length !== Math.ceil(bytes / (64 * 1024))) fail("blob.chunks");
  return {
    bytes,
    digest: digest(value.digest, "blob.digest"),
    chunks: value.chunks.map((chunk) => digest(chunk, "blob.chunk")),
  };
}

function nonnegativeInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(field);
  return value;
}

function flushIntents(
  raw: unknown, state: RunNotifierState,
  legacyPendingRunCount: number, legacyPendingUsageCount: number,
): RunFlushIntent[] {
  if (!Array.isArray(raw) || raw.length > 2) fail("flushIntents");
  const seen = new Set<RunFlushKind>();
  return raw.map((entry): RunFlushIntent => {
    const value = object(entry, "flushIntent");
    exactKeys(value, ["kind", "origin", "segmentIndex", "key", "count", "blob"], "flushIntent.fields");
    const kind = value.kind;
    if (kind !== "run" && kind !== "usage") fail("flushIntent.kind");
    if (seen.has(kind)) fail("flushIntent.kind");
    seen.add(kind);
    if (value.origin !== "journal" && value.origin !== "legacy") fail("flushIntent.origin");
    const segmentIndex = positiveInt(value.segmentIndex, "flushIntent.segmentIndex");
    const count = positiveInt(value.count, "flushIntent.count");
    const pending = kind === "run" ? state.r2SegmentBuffer : state.usageSegmentBuffer;
    const lastFlushed = kind === "run"
      ? state.r2LastFlushedSegmentIndex
      : state.usageLastFlushedSegmentIndex;
    if (!state.runId || segmentIndex <= lastFlushed || count > pending.length ||
      count > (kind === "run" ? 100 : 200)) {
      fail("flushIntent.pending");
    }
    const expectedIndex = kind === "run"
      ? Math.max(state.r2SegmentIndex, state.r2LastFlushedSegmentIndex + 1,
        Math.floor((state.r2SegmentBuffer[0]!.event_id - 1) / 100) + 1)
      : state.usageSegmentIndex;
    if (segmentIndex !== expectedIndex) fail("flushIntent.segmentIndex");
    if (value.origin === "legacy" && count >
      (kind === "run" ? legacyPendingRunCount : legacyPendingUsageCount)) {
      fail("flushIntent.legacyPending");
    }
    const expectedKey = `runs/${state.runId}/${kind === "run" ? "events" : "usage"}/${String(segmentIndex).padStart(6, "0")}.jsonl.gz`;
    if (value.key !== expectedKey) fail("flushIntent.key");
    return { kind, origin: value.origin, segmentIndex, key: expectedKey,
      count, blob: blobRef(value.blob) };
  });
}

function emitReceipts(raw: unknown, counter: number): EmitReceipt[] {
  if (!Array.isArray(raw) || raw.length > 100_000) fail("emitReceipts");
  const seen = new Set<string>();
  return raw.map((entry): EmitReceipt => {
    const value = object(entry, "emitReceipt");
    exactKeys(value, ["key", "digest", "eventId"], "emitReceipt.fields");
    if (typeof value.key !== "string" || !value.key || value.key.length > 512 ||
      value.key !== value.key.trim() || seen.has(value.key)) fail("emitReceipt.key");
    seen.add(value.key);
    const eventId = positiveInt(value.eventId, "emitReceipt.eventId");
    if (eventId > counter) fail("emitReceipt.eventId");
    return { key: value.key, digest: digest(value.digest, "emitReceipt.digest"), eventId };
  });
}

function usageReceipts(raw: unknown): UsageReceipt[] {
  if (!Array.isArray(raw) || raw.length > 100_000) fail("usageReceipts");
  const seen = new Set<string>();
  return raw.map((entry): UsageReceipt => {
    const value = object(entry, "usageReceipt");
    exactKeys(value, ["requestId", "digest"], "usageReceipt.fields");
    if (typeof value.requestId !== "string" || !value.requestId ||
      value.requestId.length > 512 || value.requestId !== value.requestId.trim() ||
      seen.has(value.requestId)) fail("usageReceipt.requestId");
    seen.add(value.requestId);
    return { requestId: value.requestId, digest: digest(value.digest, "usageReceipt.digest") };
  });
}

/** Validate the entire logical state before installing any field in a live DO. */
export function parseRunNotifierJournalState(raw: unknown): RunNotifierJournalState | null {
  if (raw === undefined) return null;
  const value = object(raw, "snapshot");
  if (value.schemaVersion !== 2 && value.schemaVersion !== 3 && value.schemaVersion !== 4) {
    const legacy = parseRunNotifierState(raw);
    return legacy && { ...legacy, flushIntents: [], emitReceipts: [], usageReceipts: [],
      legacyPendingRunCount: legacy.r2SegmentBuffer.length,
      legacyPendingUsageCount: legacy.usageSegmentBuffer.length, archive: null, usageLedger: null };
  }
  exactKeys(value, ["schemaVersion", ...BASE_KEYS, "flushIntents", "emitReceipts", "usageReceipts",
    "legacyPendingRunCount", "legacyPendingUsageCount",
    ...(value.schemaVersion === 3 || value.schemaVersion === 4 ? ["archive"] : []),
    ...(value.schemaVersion === 4 ? ["usageLedger"] : [])], "snapshot.fields");
  const base: Record<string, unknown> = { schemaVersion: 1 };
  for (const key of BASE_KEYS) base[key] = value[key];
  const state = parseRunNotifierState(base);
  if (!state) fail("snapshot.base");
  // V2 never commits unarchiveable pending work. Historical inline snapshots
  // are parsed above without changing their compatibility rules.
  if (state.runId === null &&
    (state.r2SegmentBuffer.length > 0 || state.usageSegmentBuffer.length > 0 ||
      (Array.isArray(value.flushIntents) && value.flushIntents.length > 0))) {
    fail("runId.pending");
  }
  const legacyPendingRunCount = nonnegativeInt(value.legacyPendingRunCount, "legacyPendingRunCount");
  const legacyPendingUsageCount = nonnegativeInt(value.legacyPendingUsageCount, "legacyPendingUsageCount");
  if (legacyPendingRunCount > state.r2SegmentBuffer.length ||
    legacyPendingUsageCount > state.usageSegmentBuffer.length) fail("legacyPending.count");
  const intents = flushIntents(value.flushIntents, state,
    legacyPendingRunCount, legacyPendingUsageCount);
  const archive = value.schemaVersion === 4 && value.archive === null ? null
    : value.schemaVersion === 3 || value.schemaVersion === 4 ? parseRunArchiveState(value.archive) : null;
  const usageLedger = value.schemaVersion === 4 ? parseUsageLedgerState(value.usageLedger) : null;
  if (usageLedger && !state.runId) fail("usageLedger.runId");
  if (usageLedger?.phase === "building") {
    const build = usageLedger.build!;
    const usageIntent = intents.find((intent) => intent.kind === "usage");
    if (build.frontier !== state.usageLastFlushedSegmentIndex ||
      build.pendingCount !== state.usageSegmentBuffer.length ||
      build.intentKey !== (usageIntent?.key ?? null) ||
      build.intentDigest !== (usageIntent?.blob.digest ?? null)) fail("usageLedger.build witness");
    if (build.lastKey !== null && !build.lastKey.startsWith(`runs/${state.runId}/usage/`)) {
      fail("usageLedger.build identity");
    }
  }
  if (usageLedger?.phase === "ready") {
    const pendingTotals = new Map<AppUsageMeterType, number>();
    for (const event of state.usageSegmentBuffer) {
      if (!(APP_USAGE_METER_TYPES as readonly string[]).includes(event.meter_type)) continue;
      const meter = event.meter_type as AppUsageMeterType;
      const total = (pendingTotals.get(meter) ?? 0) + event.units;
      if (!Number.isFinite(total)) fail("usageLedger.pending overflow");
      pendingTotals.set(meter, total);
    }
    for (const [meter, units] of pendingTotals) {
      if ((usageLedger.totals[meter] ?? 0) < units) fail("usageLedger.pending total");
    }
  }
  if (archive) {
    if (!state.runId || archive.root.lastEventId > state.eventIdCounter) fail("archive.run frontier");
    if (archive.phase === "ready" && state.r2SegmentBuffer.length > 0 &&
      state.r2SegmentBuffer[0]!.event_id <= archive.root.lastEventId) fail("archive.pending frontier");
    const stage = archive.stage;
    if (stage) {
      const d = stage.plan.descriptor;
      if (d.key !== `runs/${state.runId}/events/${String(d.segmentIndex).padStart(6, "0")}.jsonl.gz` ||
        d.lastEventId > state.eventIdCounter) fail("archive.stage identity");
      if (stage.purpose === "flush") {
        const intent = intents.find((entry) => entry.kind === "run");
        if (!intent || d.key !== intent.key || d.segmentIndex !== intent.segmentIndex ||
          d.sha256 !== intent.blob.digest || d.bytes !== intent.blob.bytes ||
          d.count !== intent.count || d.firstEventId !== state.r2SegmentBuffer[0]?.event_id ||
          d.lastEventId !== state.r2SegmentBuffer[intent.count - 1]?.event_id) fail("archive.stage intent");
      } else if (!archive.build || archive.build.keys[archive.build.keyIndex] !== d.key ||
        d.segmentIndex > state.r2LastFlushedSegmentIndex) fail("archive.stage build");
    }
  }
  return {
    ...state,
    flushIntents: intents,
    emitReceipts: emitReceipts(value.emitReceipts, state.eventIdCounter),
    usageReceipts: usageReceipts(value.usageReceipts),
    legacyPendingRunCount,
    legacyPendingUsageCount,
    archive,
    usageLedger,
  };
}
