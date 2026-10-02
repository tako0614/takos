import type { PersistedRunEvent } from "../../application/services/offload/run-events.ts";
import type { PersistedUsageEvent } from "../../application/services/offload/usage-events.ts";
import { RING_BUFFER_SIZE, type RingBufferEvent } from "./do-header-utils.ts";

/** Version 1 has the historical inline shape. No conversion is performed. */
export const NOTIFIER_STATE_VERSION = 1;
const MAX_PENDING_ENTRIES = 10_000;
const MAX_DEDUP_ENTRIES = 10_000;
const MAX_DATE_MS = 8_640_000_000_000_000;

type ReplayState = {
  eventBuffer: RingBufferEvent[];
  eventIdCounter: number;
};

export type RunNotifierState = ReplayState & {
  runId: string | null;
  r2SegmentIndex: number;
  r2SegmentBuffer: PersistedRunEvent[];
  r2LastFlushedSegmentIndex: number;
  usageSegmentIndex: number;
  usageSegmentBuffer: PersistedUsageEvent[];
  usageLastFlushedSegmentIndex: number;
  emitDedupKeys: Array<[string, number]>;
};

export type NotificationNotifierState = ReplayState & {
  userId: string | null;
};

function invalid(field: string): never {
  // Field paths are static identifiers, never stored values or payloads.
  throw new Error(`Invalid persisted notifier state: ${field}`);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(field);
  }
  return value as Record<string, unknown>;
}

function onlyKeys(
  value: Record<string, unknown>,
  keys: string[],
  field: string,
): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) invalid(field);
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    invalid(field);
  }
  return value;
}

function dateMillis(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) ||
    value < 0 || value > MAX_DATE_MS) invalid(field);
  return value;
}

function text(value: unknown, field: string, maxLength?: number): string {
  if (typeof value !== "string" || !value.trim() ||
    (maxLength !== undefined && value.length > maxLength)) invalid(field);
  return value;
}

function dateString(value: unknown, field: string): string {
  if (typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    invalid(field);
  }
  return value;
}

function eventType(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    invalid(field);
  }
  return value;
}

function array(value: unknown, field: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid(field);
  return value;
}

function optional(
  value: Record<string, unknown>,
  key: string,
  fallback: unknown,
): unknown {
  return Object.hasOwn(value, key) ? value[key] : fallback;
}

function replayState(value: Record<string, unknown>): ReplayState {
  if (Object.hasOwn(value, "schemaVersion") &&
    value.schemaVersion !== NOTIFIER_STATE_VERSION) invalid("schemaVersion");
  const eventIdCounter = integer(value.eventIdCounter, "eventIdCounter");
  let previousId = 0;
  const eventBuffer = array(value.eventBuffer, "eventBuffer", RING_BUFFER_SIZE)
    .map((raw): RingBufferEvent => {
      const event = record(raw, "eventBuffer.entry");
      onlyKeys(event, ["id", "type", "data", "timestamp"], "eventBuffer.entry");
      const id = integer(event.id, "eventBuffer.id", 1);
      if (id <= previousId || id > eventIdCounter) invalid("eventBuffer.id");
      previousId = id;
      if (!Object.hasOwn(event, "data") || event.data === undefined) {
        invalid("eventBuffer.data");
      }
      return {
        id,
        type: eventType(event.type, "eventBuffer.type"),
        data: event.data,
        timestamp: dateMillis(event.timestamp, "eventBuffer.timestamp"),
      };
    });
  return { eventBuffer, eventIdCounter };
}

function runEvents(value: unknown, counter: number): PersistedRunEvent[] {
  let previousId = 0;
  return array(value, "r2SegmentBuffer", MAX_PENDING_ENTRIES)
    .map((raw): PersistedRunEvent => {
      const event = record(raw, "r2SegmentBuffer.entry");
      onlyKeys(event, ["event_id", "type", "data", "created_at"], "r2SegmentBuffer.entry");
      const eventId = integer(event.event_id, "r2SegmentBuffer.event_id", 1);
      if (eventId <= previousId || eventId > counter) invalid("r2SegmentBuffer.event_id");
      previousId = eventId;
      if (typeof event.data !== "string") invalid("r2SegmentBuffer.data");
      return {
        event_id: eventId,
        type: eventType(event.type, "r2SegmentBuffer.type"),
        data: event.data,
        created_at: dateString(event.created_at, "r2SegmentBuffer.created_at"),
      };
    });
}

function usageEvents(value: unknown): PersistedUsageEvent[] {
  return array(value, "usageSegmentBuffer", MAX_PENDING_ENTRIES)
    .map((raw): PersistedUsageEvent => {
      const event = record(raw, "usageSegmentBuffer.entry");
      onlyKeys(event, ["meter_type", "units", "reference_type", "metadata", "created_at"], "usageSegmentBuffer.entry");
      if (typeof event.units !== "number" || !Number.isFinite(event.units) || event.units <= 0) {
        invalid("usageSegmentBuffer.units");
      }
      const referenceType = optional(event, "reference_type", null);
      const metadata = optional(event, "metadata", null);
      if (referenceType !== null && typeof referenceType !== "string") invalid("usageSegmentBuffer.reference_type");
      if (metadata !== null && typeof metadata !== "string") invalid("usageSegmentBuffer.metadata");
      return {
        meter_type: text(event.meter_type, "usageSegmentBuffer.meter_type"),
        units: event.units,
        reference_type: referenceType,
        metadata,
        created_at: dateString(event.created_at, "usageSegmentBuffer.created_at"),
      };
    });
}

function dedupKeys(value: unknown): Array<[string, number]> {
  const seen = new Set<string>();
  return array(value, "emitDedupKeys", MAX_DEDUP_ENTRIES)
    .map((raw): [string, number] => {
      if (!Array.isArray(raw) || raw.length !== 2) invalid("emitDedupKeys.entry");
      const key = text(raw[0], "emitDedupKeys.key", 512);
      if (key !== key.trim() || seen.has(key)) invalid("emitDedupKeys.key");
      seen.add(key);
      return [key, dateMillis(raw[1], "emitDedupKeys.timestamp")];
    });
}

/** Only an absent key is a fresh object. Validate everything before installation. */
export function parseRunNotifierState(raw: unknown): RunNotifierState | null {
  if (raw === undefined) return null;
  const value = record(raw, "bufferState");
  onlyKeys(value, [
    "schemaVersion", "eventBuffer", "eventIdCounter", "runId",
    "r2SegmentIndex", "r2SegmentBuffer", "r2LastFlushedSegmentIndex",
    "usageSegmentIndex", "usageSegmentBuffer", "usageLastFlushedSegmentIndex",
    "emitDedupKeys",
  ], "bufferState.fields");
  const replay = replayState(value);
  if (value.runId !== null &&
    (typeof value.runId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.runId))) {
    invalid("runId");
  }
  const r2SegmentIndex = integer(optional(value, "r2SegmentIndex", 1), "r2SegmentIndex", 1);
  const r2LastFlushedSegmentIndex = integer(optional(value, "r2LastFlushedSegmentIndex", 0), "r2LastFlushedSegmentIndex");
  const usageSegmentIndex = integer(optional(value, "usageSegmentIndex", 1), "usageSegmentIndex", 1);
  const usageLastFlushedSegmentIndex = integer(optional(value, "usageLastFlushedSegmentIndex", 0), "usageLastFlushedSegmentIndex");
  if (r2LastFlushedSegmentIndex > replay.eventIdCounter) invalid("r2LastFlushedSegmentIndex");
  if (r2SegmentIndex > Math.max(1, replay.eventIdCounter + 1)) invalid("r2SegmentIndex");
  if (usageLastFlushedSegmentIndex >= usageSegmentIndex) invalid("usageLastFlushedSegmentIndex");
  if (value.runId === null &&
    (r2LastFlushedSegmentIndex > 0 || usageLastFlushedSegmentIndex > 0)) {
    invalid("runId");
  }
  return {
    ...replay,
    runId: value.runId,
    r2SegmentIndex,
    r2SegmentBuffer: runEvents(optional(value, "r2SegmentBuffer", []), replay.eventIdCounter),
    r2LastFlushedSegmentIndex,
    usageSegmentIndex,
    usageSegmentBuffer: usageEvents(optional(value, "usageSegmentBuffer", [])),
    usageLastFlushedSegmentIndex,
    emitDedupKeys: dedupKeys(optional(value, "emitDedupKeys", [])),
  };
}

export function parseNotificationNotifierState(raw: unknown): NotificationNotifierState | null {
  if (raw === undefined) return null;
  const value = record(raw, "bufferState");
  onlyKeys(value, ["schemaVersion", "eventBuffer", "eventIdCounter", "userId"], "bufferState.fields");
  const replay = replayState(value);
  const userId = value.userId === null ? null : text(value.userId, "userId");
  return { ...replay, userId };
}
