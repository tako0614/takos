import { APP_USAGE_METER_TYPES, type AppUsageMeterType } from "../../application/services/app-usage/usage-types.ts";
import type { PersistedUsageEvent } from "../../application/services/offload/usage-events.ts";
import { usageSegmentKey } from "../../application/services/offload/usage-events.ts";
import { gzipDecompressToString } from "../../shared/utils/gzip.ts";

export type UsageTotals = Partial<Record<AppUsageMeterType, number>>;

export interface UsageLedgerBuild {
  frontier: number;
  pendingCount: number;
  intentKey: string | null;
  intentDigest: string | null;
  stage: "inventory" | "fold";
  cursor: string | null;
  lastKey: string | null;
  scanned: number;
  nextIndex: number;
}

export interface UsageLedgerState {
  phase: "building" | "ready" | "repair";
  totals: UsageTotals;
  revision: number;
  projectedRevision: number;
  build: UsageLedgerBuild | null;
  error: string | null;
}

const METERS: readonly string[] = APP_USAGE_METER_TYPES;
const MAX_SEGMENT_BYTES = 8 * 1024 * 1024;
const MAX_ERROR_LENGTH = 512;
const HEX_SHA256 = /^[0-9a-f]{64}$/;

export class UsageLedgerIntegrityError extends Error {}

function exactKeys(value: Record<string, unknown>, names: readonly string[]): boolean {
  return Object.keys(value).length === names.length &&
    Object.keys(value).every((key) => names.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Parse persisted ledger data without trusting any value from a journal head. */
export function parseUsageLedgerState(raw: unknown): UsageLedgerState | null {
  if (raw === null) return null;
  function fail(): never {
    throw new Error("Invalid persisted run notifier journal: usageLedger");
  }
  if (!isRecord(raw) || !exactKeys(raw,
    ["phase", "totals", "revision", "projectedRevision", "build", "error"])) fail();
  if (raw.phase !== "building" && raw.phase !== "ready" && raw.phase !== "repair") fail();
  if (!isRecord(raw.totals) || Object.keys(raw.totals).length > METERS.length) fail();
  const totals: UsageTotals = {};
  for (const [meter, units] of Object.entries(raw.totals)) {
    if (!METERS.includes(meter) || typeof units !== "number" ||
      !Number.isFinite(units) || units <= 0) fail();
    totals[meter as AppUsageMeterType] = units;
  }
  if (!safeInt(raw.revision) || !safeInt(raw.projectedRevision) ||
    raw.projectedRevision > raw.revision) fail();
  let build: UsageLedgerBuild | null = null;
  if (raw.phase === "building") {
    if (raw.revision !== 0 || raw.projectedRevision !== 0 || raw.error !== null ||
      !isRecord(raw.build) || !exactKeys(raw.build, ["frontier", "pendingCount",
        "intentKey", "intentDigest", "stage", "cursor", "lastKey", "scanned", "nextIndex"])) fail();
    const b = raw.build;
    if (!safeInt(b.frontier) || !safeInt(b.pendingCount) || !safeInt(b.scanned) ||
      !safeInt(b.nextIndex) || b.nextIndex < 1 || b.scanned > b.frontier ||
      (b.stage !== "inventory" && b.stage !== "fold") ||
      (b.intentKey !== null && (typeof b.intentKey !== "string" || !b.intentKey)) ||
      (b.intentDigest !== null && (typeof b.intentDigest !== "string" || !HEX_SHA256.test(b.intentDigest))) ||
      (b.intentKey === null) !== (b.intentDigest === null) ||
      (b.cursor !== null && (typeof b.cursor !== "string" || !b.cursor || b.cursor.length > 2048)) ||
      (b.lastKey !== null && (typeof b.lastKey !== "string" || !b.lastKey || b.lastKey.length > 160)) ||
      (b.stage === "inventory" && b.nextIndex !== 1) ||
      (b.stage === "fold" && (b.cursor !== null || b.nextIndex > b.frontier + 1 ||
        b.scanned !== b.frontier))) fail();
    build = b as unknown as UsageLedgerBuild;
  } else if (raw.build !== null ||
    (raw.phase === "ready" && (raw.revision < 1 || raw.error !== null)) ||
    (raw.phase === "repair" && (typeof raw.error !== "string" || !raw.error ||
      raw.error.length > MAX_ERROR_LENGTH))) fail();
  return { phase: raw.phase, totals, revision: raw.revision,
    projectedRevision: raw.projectedRevision, build, error: raw.error as string | null };
}

export function newUsageLedgerBuild(
  frontier: number, pendingCount: number, intentKey: string | null,
  intentDigest: string | null,
): UsageLedgerState {
  return { phase: "building", totals: {}, revision: 0, projectedRevision: 0,
    build: { frontier, pendingCount, intentKey, intentDigest,
      stage: "inventory", cursor: null, lastKey: null, scanned: 0, nextIndex: 1 },
    error: null };
}

export function repairUsageLedger(state: UsageLedgerState, reason: string): UsageLedgerState {
  return { ...state, phase: "repair", build: null,
    error: `Usage ledger migration requires repair: ${reason}`.slice(0, MAX_ERROR_LENGTH) };
}

export function usageSegmentIndex(key: string, runId: string): number {
  const prefix = `runs/${runId}/usage/`;
  if (!key.startsWith(prefix) || !key.endsWith(".jsonl.gz")) {
    throw new UsageLedgerIntegrityError(`Unknown usage object key: ${key}`);
  }
  const text = key.slice(prefix.length, -".jsonl.gz".length);
  if (!/^\d+$/.test(text)) throw new UsageLedgerIntegrityError(`Unknown usage object key: ${key}`);
  const index = Number(text);
  if (!Number.isSafeInteger(index) || index < 1 || usageSegmentKey(runId, index) !== key) {
    throw new UsageLedgerIntegrityError(`Noncanonical usage object key: ${key}`);
  }
  return index;
}

export function addUsageEvents(totals: UsageTotals, events: readonly PersistedUsageEvent[]): UsageTotals {
  const next = { ...totals };
  for (const event of events) {
    if (!isRecord(event) || typeof event.meter_type !== "string" ||
      Object.keys(event).some((key) => !["meter_type", "units", "created_at",
        "reference_type", "metadata"].includes(key)) ||
      !event.meter_type.trim() || typeof event.units !== "number" ||
      !Number.isFinite(event.units) || event.units <= 0 ||
      typeof event.created_at !== "string" || !event.created_at.trim() ||
      !Number.isFinite(Date.parse(event.created_at)) ||
      (event.reference_type !== undefined && event.reference_type !== null &&
        typeof event.reference_type !== "string") ||
      (event.metadata !== undefined && event.metadata !== null &&
        typeof event.metadata !== "string")) {
      throw new UsageLedgerIntegrityError("Malformed archived usage event");
    }
    // Meter names are open for future producers. The SQL projection currently
    // owns eight named meters, so retain other events in the archive only.
    if (!METERS.includes(event.meter_type)) continue;
    const meter = event.meter_type as AppUsageMeterType;
    const previous = next[meter] ?? 0;
    const sum = previous + event.units;
    if (!Number.isFinite(sum) || sum <= previous || previous > 0 && sum <= event.units) {
      throw new UsageLedgerIntegrityError("Usage total cannot represent all accepted units");
    }
    next[meter] = sum;
  }
  return next;
}

export async function decodeUsageSegment(bytes: ArrayBuffer): Promise<PersistedUsageEvent[]> {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_SEGMENT_BYTES) {
    throw new UsageLedgerIntegrityError("Usage segment exceeds byte limit");
  }
  let plain: string;
  try {
    plain = await gzipDecompressToString(bytes, {
      maxDecompressedBytes: MAX_SEGMENT_BYTES, fatalUtf8: true,
    });
  } catch {
    throw new UsageLedgerIntegrityError("Malformed or oversized compressed usage segment");
  }
  if (!plain || !plain.endsWith("\n")) throw new UsageLedgerIntegrityError("Malformed usage segment JSONL");
  const lines = plain.slice(0, -1).split("\n");
  if (lines.length < 1 || lines.some((line) => !line)) {
    throw new UsageLedgerIntegrityError("Malformed usage segment JSONL");
  }
  let parsed: unknown[];
  try { parsed = lines.map((line) => JSON.parse(line)); }
  catch { throw new UsageLedgerIntegrityError("Malformed usage segment JSONL"); }
  addUsageEvents({}, parsed as PersistedUsageEvent[]);
  return parsed as PersistedUsageEvent[];
}
