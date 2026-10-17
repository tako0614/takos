import type {
  ObjectStoreBinding,
  ObjectStoreObjectBody,
} from "../../../shared/types/bindings.ts";
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

export const USAGE_EVENT_SEGMENT_SIZE = 200;
const USAGE_PREFIX_SUFFIX = "/usage/";

export const usageEventsDeps = {
  gzipCompressString,
  gzipDecompressToString,
};

export function usageSegmentKey(runId: string, segmentIndex: number): string {
  return `runs/${runId}/usage/${
    String(segmentIndex).padStart(6, "0")
  }.jsonl.gz`;
}

export async function writeUsageEventSegmentToR2(
  bucket: ObjectStoreBinding,
  runId: string,
  segmentIndex: number,
  events: PersistedUsageEvent[],
): Promise<void> {
  if (!events.length) return;
  const jsonl = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const gz = await usageEventsDeps.gzipCompressString(jsonl);
  const key = usageSegmentKey(runId, segmentIndex);
  await bucket.put(key, gz, {
    httpMetadata: {
      contentType: "application/jsonl",
      contentEncoding: "gzip",
    },
    customMetadata: {
      kind: "usage_events",
      run_id: runId,
      segment: String(segmentIndex),
    },
  });
}

async function listUsageSegments(
  bucket: ObjectStoreBinding,
  runId: string,
  strict: boolean,
): Promise<string[]> {
  const prefix = `runs/${runId}${USAGE_PREFIX_SUFFIX}`;
  const keys: string[] = [];
  const seenKeys = new Set<string>();
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  while (true) {
    const listed = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const obj of listed.objects) {
      if (strict && seenKeys.has(obj.key)) {
        throw new Error(`Usage segment listing returned a duplicate key: ${obj.key}`);
      }
      if (strict) seenKeys.add(obj.key);
      keys.push(obj.key);
    }
    if (!listed.truncated) break;
    const nextCursor = listed.cursor;
    if (
      typeof nextCursor !== "string" || !nextCursor ||
      nextCursor === cursor || seenCursors.has(nextCursor)
    ) {
      throw new Error("Usage segment listing returned an invalid pagination cursor");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  if (strict) {
    for (const key of keys) {
      if (typeof key !== "string" || !isCanonicalUsageSegmentKey(key, runId)) {
        throw new Error(`Usage segment listing returned a non-canonical key: ${String(key)}`);
      }
    }
  }

  keys.sort();
  return keys;
}

function isCanonicalUsageSegmentKey(key: string, runId: string): boolean {
  const prefix = `runs/${runId}${USAGE_PREFIX_SUFFIX}`;
  if (!key.startsWith(prefix) || !key.endsWith(".jsonl.gz")) return false;
  const indexText = key.slice(prefix.length, -".jsonl.gz".length);
  if (!/^\d+$/.test(indexText)) return false;
  const index = Number(indexText);
  return Number.isSafeInteger(index) && index >= 0 &&
    usageSegmentKey(runId, index) === key;
}

async function readSegmentObject(
  obj: ObjectStoreObjectBody,
  strict: boolean,
): Promise<PersistedUsageEvent[]> {
  const ab = await obj.arrayBuffer();
  const jsonl = await usageEventsDeps.gzipDecompressToString(ab, {
    maxDecompressedBytes: 50 * 1024 * 1024,
  });
  if (strict && jsonl.length === 0) {
    throw new Error("Usage segment is empty");
  }
  const lines = strict ? jsonl.split("\n") : jsonl.split("\n").filter(Boolean);
  if (lines.at(-1) === "") lines.pop();
  const out: PersistedUsageEvent[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as PersistedUsageEvent;
      if (strict) {
        if (!isStrictUsageEvent(parsed)) {
          throw new Error("Usage event has an invalid schema");
        }
      } else {
        if (!parsed || typeof parsed !== "object") continue;
        if (typeof parsed.meter_type !== "string") continue;
        if (typeof parsed.units !== "number" || !Number.isFinite(parsed.units)) {
          continue;
        }
        if (typeof parsed.created_at !== "string") continue;
      }
      out.push(parsed);
    } catch (error) {
      if (strict) {
        throw new Error(
          `Malformed usage event segment line: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      logWarn("Malformed usage event segment line skipped", {
        module: "offload/usage-events",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}

function isStrictUsageEvent(value: unknown): value is PersistedUsageEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  if (typeof event.meter_type !== "string" || !event.meter_type.trim()) return false;
  if (typeof event.units !== "number" || !Number.isFinite(event.units) || event.units <= 0) {
    return false;
  }
  if (typeof event.created_at !== "string" || !event.created_at.trim()) return false;
  if (!Number.isFinite(Date.parse(event.created_at))) return false;
  if (
    Object.hasOwn(event, "reference_type") && event.reference_type !== null &&
    typeof event.reference_type !== "string"
  ) return false;
  if (
    Object.hasOwn(event, "metadata") && event.metadata !== null &&
    typeof event.metadata !== "string"
  ) return false;
  return true;
}

export async function getUsageEventsFromR2(
  bucket: ObjectStoreBinding,
  runId: string,
  options: { maxEvents?: number; strict?: boolean } = {},
): Promise<PersistedUsageEvent[]> {
  const strict = options.strict === true;
  const requestedMaxEvents = options.maxEvents ?? 10_000;
  const maxEvents = Math.max(
    1,
    Math.min(Number.isNaN(requestedMaxEvents) ? 10_000 : requestedMaxEvents, 100_000),
  );
  const keys = await listUsageSegments(bucket, runId, strict);
  const out: PersistedUsageEvent[] = [];
  for (const key of keys) {
    const obj: ObjectStoreObjectBody | null = await bucket.get(key);
    if (!obj) {
      if (strict) throw new Error(`Listed usage segment is missing: ${key}`);
      continue;
    }
    const events = await readSegmentObject(obj, strict);
    for (const ev of events) {
      out.push(ev);
      if (out.length >= maxEvents) return out;
    }
  }

  return out;
}
