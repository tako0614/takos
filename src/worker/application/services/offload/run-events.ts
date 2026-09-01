import type { ObjectStoreBinding } from "../../../shared/types/bindings.ts";
import {
  gzipCompressString,
  gzipDecompressToString,
} from "../../../shared/utils/gzip.ts";
import { logWarn } from "../../../shared/utils/logger.ts";

export interface PersistedRunEvent {
  event_id: number;
  type: string;
  data: string; // Canonical JSON string
  created_at: string;
}

export interface RunEventSegmentReadResult {
  status: "ok" | "missing" | "invalid";
  events: PersistedRunEvent[];
  size: number;
  dataTruncated: boolean;
}

export interface RunEventReplayPage {
  events: PersistedRunEvent[];
  hasMore: boolean;
  dataTruncated: boolean;
  archiveTruncated: boolean;
}

export const RUN_EVENT_SEGMENT_SIZE = 100;
export const MAX_PERSISTED_RUN_EVENT_DATA_BYTES = 64 * 1024;
export const MAX_RUN_EVENT_SEGMENT_COMPRESSED_BYTES = 8 * 1024 * 1024;
export const MAX_RUN_EVENT_SEGMENT_DECOMPRESSED_BYTES = 8 * 1024 * 1024;
export const RUN_EVENT_TRUNCATED_DATA =
  '{"_takos_observation":"event_data_truncated"}';

const MAX_RUN_ID_CHARACTERS = 64;
const MAX_RUN_EVENT_TYPE_BYTES = 256;
const MAX_RUN_EVENT_TIMESTAMP_CHARACTERS = 64;
const MAX_RUN_EVENT_REPLAY_LIMIT = 5_000;
const textEncoder = new TextEncoder();

export const runEventsDeps = {
  gzipCompressString,
  gzipDecompressToString,
};

function utf8Bytes(value: string): number {
  return textEncoder.encode(value).byteLength;
}

export function serializeRunEventData(value: unknown): {
  data: string;
  truncated: boolean;
} {
  try {
    const serialized = JSON.stringify(value);
    if (
      typeof serialized === "string" &&
      utf8Bytes(serialized) <= MAX_PERSISTED_RUN_EVENT_DATA_BYTES
    ) {
      return { data: serialized, truncated: false };
    }
  } catch {
    // The explicit marker below is also used for legacy/corrupt archive data.
  }
  return { data: RUN_EVENT_TRUNCATED_DATA, truncated: true };
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
    throw new Error("Invalid offloaded Run identity");
  }
}

function assertSegmentIndex(segmentIndex: number): void {
  if (!Number.isSafeInteger(segmentIndex) || segmentIndex <= 0) {
    throw new Error("Invalid Run event segment index");
  }
}

function parsePersistedRunEvent(
  value: unknown,
  allowDataTruncation: boolean,
): { event: PersistedRunEvent; dataTruncated: boolean } | null {
  if (
    !isRecord(value) ||
    !hasExactFields(value, ["event_id", "type", "data", "created_at"]) ||
    typeof value.event_id !== "number" ||
    !Number.isSafeInteger(value.event_id) ||
    value.event_id <= 0 ||
    typeof value.type !== "string" ||
    value.type.length === 0 ||
    utf8Bytes(value.type) > MAX_RUN_EVENT_TYPE_BYTES ||
    typeof value.data !== "string" ||
    typeof value.created_at !== "string" ||
    value.created_at.length === 0 ||
    value.created_at.length > MAX_RUN_EVENT_TIMESTAMP_CHARACTERS ||
    !Number.isFinite(Date.parse(value.created_at))
  ) {
    return null;
  }

  let data = value.data;
  let dataTruncated = utf8Bytes(data) > MAX_PERSISTED_RUN_EVENT_DATA_BYTES;
  if (!dataTruncated) {
    try {
      JSON.parse(data);
    } catch {
      dataTruncated = true;
    }
  }
  if (dataTruncated && !allowDataTruncation) return null;
  if (dataTruncated) data = RUN_EVENT_TRUNCATED_DATA;

  return {
    event: {
      event_id: value.event_id,
      type: value.type,
      data,
      created_at: value.created_at,
    },
    dataTruncated,
  };
}

function parseRunEventSegment(
  jsonl: string,
): Omit<RunEventSegmentReadResult, "status" | "size"> | null {
  const lines = jsonl.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0 || lines.length > RUN_EVENT_SEGMENT_SIZE) return null;

  const events: PersistedRunEvent[] = [];
  let dataTruncated = false;
  let previousEventId = 0;
  for (const line of lines) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      return null;
    }
    const parsed = parsePersistedRunEvent(raw, true);
    if (!parsed || parsed.event.event_id <= previousEventId) return null;
    previousEventId = parsed.event.event_id;
    dataTruncated ||= parsed.dataTruncated;
    events.push(parsed.event);
  }
  return { events, dataTruncated };
}

function pad6(n: number): string {
  return String(n).padStart(6, "0");
}

export function segmentIndexForEventId(eventId: number): number {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return 1;
  return Math.floor((eventId - 1) / RUN_EVENT_SEGMENT_SIZE) + 1;
}

export function buildRunEventSegmentKey(
  runId: string,
  segmentIndex: number,
): string {
  assertRunIdentity(runId);
  assertSegmentIndex(segmentIndex);
  return `runs/${runId}/events/${pad6(segmentIndex)}.jsonl.gz`;
}

export async function writeRunEventSegmentToR2(
  bucket: ObjectStoreBinding,
  runId: string,
  segmentIndex: number,
  events: PersistedRunEvent[],
): Promise<void> {
  const key = buildRunEventSegmentKey(runId, segmentIndex);
  if (events.length === 0 || events.length > RUN_EVENT_SEGMENT_SIZE) {
    throw new Error("Invalid offloaded Run event segment");
  }

  const canonical: PersistedRunEvent[] = [];
  let previousEventId = 0;
  for (const value of events) {
    const parsed = parsePersistedRunEvent(value, false);
    if (!parsed || parsed.event.event_id <= previousEventId) {
      throw new Error("Invalid offloaded Run event segment");
    }
    previousEventId = parsed.event.event_id;
    canonical.push(parsed.event);
  }

  const jsonl = canonical.map((event) => JSON.stringify(event)).join("\n") +
    "\n";
  if (utf8Bytes(jsonl) > MAX_RUN_EVENT_SEGMENT_DECOMPRESSED_BYTES) {
    throw new Error("Offloaded Run event segment is too large");
  }
  const compressed = await runEventsDeps.gzipCompressString(jsonl);
  if (compressed.byteLength > MAX_RUN_EVENT_SEGMENT_COMPRESSED_BYTES) {
    throw new Error("Compressed Run event segment is too large");
  }
  await bucket.put(key, compressed, {
    httpMetadata: {
      contentType: "application/x-ndjson; charset=utf-8",
      contentEncoding: "gzip",
    },
  });
}

export async function readRunEventSegmentRecord(
  bucket: ObjectStoreBinding,
  runId: string,
  segmentIndex: number,
): Promise<RunEventSegmentReadResult> {
  const key = buildRunEventSegmentKey(runId, segmentIndex);
  const obj = await bucket.get(key);
  if (!obj) {
    return { status: "missing", events: [], size: 0, dataTruncated: false };
  }
  if (
    !Number.isSafeInteger(obj.size) || obj.size < 0 ||
    obj.size > MAX_RUN_EVENT_SEGMENT_COMPRESSED_BYTES
  ) {
    return {
      status: "invalid",
      events: [],
      size: obj.size,
      dataTruncated: false,
    };
  }

  try {
    const compressed = await obj.arrayBuffer();
    if (compressed.byteLength > MAX_RUN_EVENT_SEGMENT_COMPRESSED_BYTES) {
      return {
        status: "invalid",
        events: [],
        size: compressed.byteLength,
        dataTruncated: false,
      };
    }
    const jsonl = await runEventsDeps.gzipDecompressToString(compressed, {
      maxDecompressedBytes: MAX_RUN_EVENT_SEGMENT_DECOMPRESSED_BYTES,
    });
    const parsed = parseRunEventSegment(jsonl);
    if (!parsed) {
      return {
        status: "invalid",
        events: [],
        size: obj.size,
        dataTruncated: false,
      };
    }
    return { status: "ok", size: obj.size, ...parsed };
  } catch (error) {
    logWarn("Invalid Run event archive segment rejected", {
      module: "offload/run-events",
      runId,
      segmentIndex: String(segmentIndex),
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      status: "invalid",
      events: [],
      size: obj.size,
      dataTruncated: false,
    };
  }
}

export async function readRunEventSegmentFromR2(
  bucket: ObjectStoreBinding,
  runId: string,
  segmentIndex: number,
): Promise<PersistedRunEvent[] | null> {
  const result = await readRunEventSegmentRecord(bucket, runId, segmentIndex);
  return result.status === "ok" ? result.events : null;
}

export async function getRunEventsAfterPageFromR2(
  bucket: ObjectStoreBinding,
  runId: string,
  afterEventId: number,
  limit: number = 500,
): Promise<RunEventReplayPage> {
  assertRunIdentity(runId);
  const safeAfter = Number.isSafeInteger(afterEventId) && afterEventId >= 0
    ? afterEventId
    : 0;
  const safeLimit = Math.min(
    MAX_RUN_EVENT_REPLAY_LIMIT,
    Math.max(1, Number.isSafeInteger(limit) ? limit : 500),
  );
  if (safeAfter === Number.MAX_SAFE_INTEGER) {
    return {
      events: [],
      hasMore: false,
      dataTruncated: false,
      archiveTruncated: false,
    };
  }
  const startSegment = segmentIndexForEventId(safeAfter + 1);
  // A cursor may land at the end of its first segment. One extra segment and
  // one extra event are sufficient to prove whether another replay page is
  // available without listing the entire Run prefix.
  const maxSegmentReads = Math.ceil((safeLimit + 1) / RUN_EVENT_SEGMENT_SIZE) +
    1;
  const events: PersistedRunEvent[] = [];
  let dataTruncated = false;
  let archiveTruncated = false;

  for (let offset = 0; offset < maxSegmentReads; offset++) {
    const result = await readRunEventSegmentRecord(
      bucket,
      runId,
      startSegment + offset,
    );
    if (result.status === "missing") break;
    if (result.status === "invalid") {
      archiveTruncated = true;
      break;
    }
    dataTruncated ||= result.dataTruncated;
    for (const event of result.events) {
      if (event.event_id <= safeAfter) continue;
      events.push(event);
      if (events.length > safeLimit) {
        return {
          events: events.slice(0, safeLimit),
          hasMore: true,
          dataTruncated,
          archiveTruncated,
        };
      }
    }
  }

  return {
    events,
    hasMore: false,
    dataTruncated,
    archiveTruncated,
  };
}

export async function getRunEventsAfterFromR2(
  bucket: ObjectStoreBinding,
  runId: string,
  afterEventId: number,
  limit: number = 500,
): Promise<PersistedRunEvent[]> {
  return (await getRunEventsAfterPageFromR2(
    bucket,
    runId,
    afterEventId,
    limit,
  )).events;
}
