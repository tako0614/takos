import type { ObjectStoreBinding } from "../../../shared/types/bindings.ts";
import {
  gzipCompressString,
  gzipDecompressToString,
} from "../../../shared/utils/gzip.ts";
import { logWarn } from "../../../shared/utils/logger.ts";

export type PersistedUsageEvent = {
  meter_type: string;
  units: number;
  reference_type?: string | null;
  metadata?: string | null;
  created_at: string;
};

export type UsageEventArchiveManifest = {
  version: 1;
  segment_count: number;
  event_count: number;
  completed_at: string;
};

export type UsageEventArchiveRead = {
  events: PersistedUsageEvent[];
  complete: boolean;
  reason:
    | null
    | "manifest_missing"
    | "manifest_invalid"
    | "event_limit"
    | "segment_missing"
    | "segment_invalid"
    | "event_count_mismatch";
};

export const USAGE_EVENT_SEGMENT_SIZE = 200;
export const MAX_USAGE_EVENT_METADATA_BYTES = 4 * 1024;
export const MAX_USAGE_EVENT_SEGMENT_COMPRESSED_BYTES = 1024 * 1024;
export const MAX_USAGE_EVENT_SEGMENT_DECOMPRESSED_BYTES = 1024 * 1024;
const MAX_USAGE_ARCHIVE_MANIFEST_BYTES = 2 * 1024;
const MAX_USAGE_ARCHIVE_READ_EVENTS = 100_000;
const MAX_USAGE_EVENT_FIELD_BYTES = 128;
const MAX_RUN_ID_CHARACTERS = 64;
const usageEncoder = new TextEncoder();

export const usageEventsDeps = {
  gzipCompressString,
  gzipDecompressToString,
};

function utf8Bytes(value: string): number {
  return usageEncoder.encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactFields(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value).sort();
  const fields = [...expected].sort();
  return keys.length === fields.length &&
    keys.every((key, index) => key === fields[index]);
}

function assertRunIdentity(runId: string): void {
  if (
    runId.length === 0 || runId.length > MAX_RUN_ID_CHARACTERS ||
    !/^[A-Za-z0-9_-]+$/u.test(runId)
  ) {
    throw new Error("Invalid offloaded usage Run identity");
  }
}

function assertSegmentIndex(segmentIndex: number): void {
  if (!Number.isSafeInteger(segmentIndex) || segmentIndex <= 0) {
    throw new Error("Invalid usage event segment index");
  }
}

function expectedSegmentCount(eventCount: number): number {
  return Math.ceil(eventCount / USAGE_EVENT_SEGMENT_SIZE);
}

function parseMetadata(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    utf8Bytes(value) > MAX_USAGE_EVENT_METADATA_BYTES
  ) return undefined;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? value : undefined;
  } catch {
    return undefined;
  }
}

function parseUsageEvent(value: unknown): PersistedUsageEvent | null {
  if (
    !isRecord(value) ||
    !hasExactFields(value, [
      "meter_type",
      "units",
      "reference_type",
      "metadata",
      "created_at",
    ]) ||
    typeof value.meter_type !== "string" ||
    value.meter_type.length === 0 ||
    utf8Bytes(value.meter_type) > MAX_USAGE_EVENT_FIELD_BYTES ||
    typeof value.units !== "number" ||
    !Number.isFinite(value.units) || value.units <= 0 ||
    value.units > Number.MAX_SAFE_INTEGER ||
    !(
      value.reference_type === null ||
      (typeof value.reference_type === "string" &&
        utf8Bytes(value.reference_type) <= MAX_USAGE_EVENT_FIELD_BYTES)
    ) ||
    typeof value.created_at !== "string" ||
    value.created_at.length === 0 || value.created_at.length > 64 ||
    !Number.isFinite(Date.parse(value.created_at))
  ) return null;
  const metadata = parseMetadata(value.metadata);
  if (metadata === undefined) return null;
  return {
    meter_type: value.meter_type,
    units: value.units,
    reference_type: value.reference_type,
    metadata,
    created_at: value.created_at,
  };
}

function canonicalUsageEvent(value: PersistedUsageEvent): PersistedUsageEvent {
  const parsed = parseUsageEvent({
    meter_type: value.meter_type,
    units: value.units,
    reference_type: value.reference_type ?? null,
    metadata: value.metadata ?? null,
    created_at: value.created_at,
  });
  if (!parsed) throw new Error("Invalid offloaded usage event");
  return parsed;
}

export function usageSegmentKey(runId: string, segmentIndex: number): string {
  assertRunIdentity(runId);
  assertSegmentIndex(segmentIndex);
  return `runs/${runId}/usage/${
    String(segmentIndex).padStart(6, "0")
  }.jsonl.gz`;
}

export function usageArchiveManifestKey(runId: string): string {
  assertRunIdentity(runId);
  return `runs/${runId}/usage/manifest.json`;
}

export async function writeUsageEventSegmentToR2(
  bucket: ObjectStoreBinding,
  runId: string,
  segmentIndex: number,
  events: PersistedUsageEvent[],
): Promise<void> {
  const key = usageSegmentKey(runId, segmentIndex);
  if (events.length === 0 || events.length > USAGE_EVENT_SEGMENT_SIZE) {
    throw new Error("Invalid offloaded usage event segment");
  }
  const canonical = events.map(canonicalUsageEvent);
  const jsonl = canonical.map((event) => JSON.stringify(event)).join("\n") +
    "\n";
  if (utf8Bytes(jsonl) > MAX_USAGE_EVENT_SEGMENT_DECOMPRESSED_BYTES) {
    throw new Error("Offloaded usage event segment is too large");
  }
  const compressed = await usageEventsDeps.gzipCompressString(jsonl);
  if (compressed.byteLength > MAX_USAGE_EVENT_SEGMENT_COMPRESSED_BYTES) {
    throw new Error("Compressed usage event segment is too large");
  }
  await bucket.put(key, compressed, {
    httpMetadata: {
      contentType: "application/x-ndjson; charset=utf-8",
      contentEncoding: "gzip",
    },
    customMetadata: {
      kind: "usage_events",
      run_id: runId,
      segment: String(segmentIndex),
    },
  });
}

export async function writeUsageEventArchiveManifestToR2(
  bucket: ObjectStoreBinding,
  runId: string,
  input: { segmentCount: number; eventCount: number; completedAt: string },
): Promise<void> {
  const key = usageArchiveManifestKey(runId);
  if (
    !Number.isSafeInteger(input.segmentCount) || input.segmentCount < 0 ||
    !Number.isSafeInteger(input.eventCount) || input.eventCount < 0 ||
    input.segmentCount !== expectedSegmentCount(input.eventCount) ||
    input.completedAt.length === 0 || input.completedAt.length > 64 ||
    !Number.isFinite(Date.parse(input.completedAt))
  ) {
    throw new Error("Invalid usage event archive manifest");
  }
  const manifest: UsageEventArchiveManifest = {
    version: 1,
    segment_count: input.segmentCount,
    event_count: input.eventCount,
    completed_at: input.completedAt,
  };
  await bucket.put(key, JSON.stringify(manifest), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { kind: "usage_event_manifest", run_id: runId },
  });
}

async function readManifest(
  bucket: ObjectStoreBinding,
  runId: string,
): Promise<UsageEventArchiveManifest | null | undefined> {
  const obj = await bucket.get(usageArchiveManifestKey(runId));
  if (!obj) return null;
  if (
    !Number.isSafeInteger(obj.size) || obj.size < 0 ||
    obj.size > MAX_USAGE_ARCHIVE_MANIFEST_BYTES
  ) return undefined;
  try {
    const raw = JSON.parse(await obj.text());
    if (
      !isRecord(raw) ||
      !hasExactFields(raw, [
        "version",
        "segment_count",
        "event_count",
        "completed_at",
      ]) || raw.version !== 1 ||
      typeof raw.segment_count !== "number" ||
      !Number.isSafeInteger(raw.segment_count) || raw.segment_count < 0 ||
      typeof raw.event_count !== "number" ||
      !Number.isSafeInteger(raw.event_count) || raw.event_count < 0 ||
      raw.segment_count !== expectedSegmentCount(raw.event_count) ||
      typeof raw.completed_at !== "string" || raw.completed_at.length === 0 ||
      raw.completed_at.length > 64 ||
      !Number.isFinite(Date.parse(raw.completed_at))
    ) return undefined;
    return raw as UsageEventArchiveManifest;
  } catch {
    return undefined;
  }
}

async function readSegment(
  bucket: ObjectStoreBinding,
  runId: string,
  segmentIndex: number,
): Promise<PersistedUsageEvent[] | null | undefined> {
  const obj = await bucket.get(usageSegmentKey(runId, segmentIndex));
  if (!obj) return null;
  if (
    !Number.isSafeInteger(obj.size) || obj.size < 0 ||
    obj.size > MAX_USAGE_EVENT_SEGMENT_COMPRESSED_BYTES
  ) return undefined;
  try {
    const compressed = await obj.arrayBuffer();
    if (compressed.byteLength > MAX_USAGE_EVENT_SEGMENT_COMPRESSED_BYTES) {
      return undefined;
    }
    const jsonl = await usageEventsDeps.gzipDecompressToString(compressed, {
      maxDecompressedBytes: MAX_USAGE_EVENT_SEGMENT_DECOMPRESSED_BYTES,
    });
    const lines = jsonl.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length === 0 || lines.length > USAGE_EVENT_SEGMENT_SIZE) {
      return undefined;
    }
    const events: PersistedUsageEvent[] = [];
    for (const line of lines) {
      const parsed = parseUsageEvent(JSON.parse(line));
      if (!parsed) return undefined;
      events.push(parsed);
    }
    return events;
  } catch (error) {
    logWarn("Invalid usage event archive segment rejected", {
      module: "offload/usage-events",
      runId,
      segmentIndex: String(segmentIndex),
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

export async function readUsageEventArchiveFromR2(
  bucket: ObjectStoreBinding,
  runId: string,
  options: { maxEvents?: number } = {},
): Promise<UsageEventArchiveRead> {
  assertRunIdentity(runId);
  const requestedMaxEvents = options.maxEvents ?? 10_000;
  if (
    !Number.isSafeInteger(requestedMaxEvents) || requestedMaxEvents <= 0
  ) {
    throw new Error("Invalid usage archive event limit");
  }
  const maxEvents = Math.min(
    requestedMaxEvents,
    MAX_USAGE_ARCHIVE_READ_EVENTS,
  );
  const manifest = await readManifest(bucket, runId);
  if (manifest === null) {
    return { events: [], complete: false, reason: "manifest_missing" };
  }
  if (!manifest) {
    return { events: [], complete: false, reason: "manifest_invalid" };
  }
  if (manifest.event_count > maxEvents) {
    return { events: [], complete: false, reason: "event_limit" };
  }
  if (manifest.segment_count === 0) {
    return { events: [], complete: true, reason: null };
  }

  const events: PersistedUsageEvent[] = [];
  // Four in-flight object reads bound latency without materializing every
  // segment at once. The manifest already bounds total event count.
  for (let start = 1; start <= manifest.segment_count; start += 4) {
    const indexes = Array.from(
      { length: Math.min(4, manifest.segment_count - start + 1) },
      (_, offset) => start + offset,
    );
    const segments = await Promise.all(
      indexes.map((index) => readSegment(bucket, runId, index)),
    );
    for (const segment of segments) {
      if (segment === null) {
        return { events: [], complete: false, reason: "segment_missing" };
      }
      if (!segment) {
        return { events: [], complete: false, reason: "segment_invalid" };
      }
      events.push(...segment);
    }
  }
  if (events.length !== manifest.event_count) {
    return { events: [], complete: false, reason: "event_count_mismatch" };
  }
  return { events, complete: true, reason: null };
}
