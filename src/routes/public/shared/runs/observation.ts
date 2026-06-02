import type {
  DurableNamespaceBinding,
  ObjectStoreBinding,
  RunStatus,
  SqlDatabaseBinding,
} from "takos-api-contract/shared/types";

export type FormattedRunEvent = {
  id: number;
  event_id: string;
  run_id: string;
  type: string;
  data: string;
  created_at: string;
};

export type RunObservation = {
  events: FormattedRunEvent[];
  runStatus: RunStatus;
};

export type RunObservationEnv = {
  DB: SqlDatabaseBinding;
  TAKOS_OFFLOAD?: ObjectStoreBinding;
  RUN_NOTIFIER?: DurableNamespaceBinding;
};

type PersistedRunEvent = {
  event_id: number;
  type: string;
  data: string;
  created_at: string;
};

type RunEventRow = {
  id: number;
  type: string;
  data: string;
  createdAt: string | Date;
};

const MAX_EVENTS_PER_RESPONSE = 2000;
const RUN_EVENT_SEGMENT_SIZE = 100;
const RUN_NOTIFIER_FETCH_TIMEOUT_MS = 2000;
const SSE_POLL_INTERVAL_MS = 1000;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const RUN_TERMINAL_STATUS_BY_EVENT_TYPE: Record<
  string,
  "completed" | "failed" | "cancelled"
> = {
  completed: "completed",
  error: "failed",
  cancelled: "cancelled",
  "run.failed": "failed",
};
const sseEncoder = new TextEncoder();

export async function loadRunObservation(
  env: RunObservationEnv,
  runId: string,
  fallbackStatus: RunStatus,
  lastEventId: number,
): Promise<RunObservation> {
  const persistedEvents = await fetchRunEventsAfter(env, runId, lastEventId);
  return {
    events: formatRunEvents(persistedEvents, runId),
    runStatus: deriveRunStatusFromTimelineEvents(
      fallbackStatus,
      persistedEvents,
    ),
  };
}

export function createRunObservationSseStream(
  env: RunObservationEnv,
  runId: string,
  fallbackStatus: RunStatus,
  lastEventId: number,
  options?: {
    pollIntervalMs?: number;
    heartbeatIntervalMs?: number;
  },
): ReadableStream<Uint8Array> {
  return createPollingRunObservationStream(
    (afterEventId) =>
      loadRunObservation(env, runId, fallbackStatus, afterEventId),
    lastEventId,
    options,
  );
}

export function createPollingRunObservationStream(
  source: (afterEventId: number) => Promise<RunObservation>,
  initialLastEventId: number,
  options?: {
    pollIntervalMs?: number;
    heartbeatIntervalMs?: number;
  },
): ReadableStream<Uint8Array> {
  const pollIntervalMs = options?.pollIntervalMs ?? SSE_POLL_INTERVAL_MS;
  const heartbeatIntervalMs = options?.heartbeatIntervalMs ??
    SSE_HEARTBEAT_INTERVAL_MS;
  let closed = false;
  let sleepTimer: ReturnType<typeof setTimeout> | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let lastEventId = initialLastEventId;
      let lastHeartbeatAt = Date.now();

      const close = () => {
        if (closed) return;
        closed = true;
        if (sleepTimer) {
          clearTimeout(sleepTimer);
          sleepTimer = undefined;
        }
        controller.close();
      };

      const sleep = (ms: number) =>
        new Promise<void>((resolve) => {
          sleepTimer = setTimeout(() => {
            sleepTimer = undefined;
            resolve();
          }, ms);
        });

      void (async () => {
        controller.enqueue(formatSseComment("connected"));

        while (!closed) {
          const observation = await source(lastEventId);

          if (observation.events.length > 0) {
            for (const event of observation.events) {
              lastEventId = event.id;
              controller.enqueue(formatRunSseEvent(event));
            }
            lastHeartbeatAt = Date.now();
            if (isRunTerminalStatus(observation.runStatus)) {
              close();
              return;
            }
            continue;
          }

          if (isRunTerminalStatus(observation.runStatus)) {
            close();
            return;
          }

          const now = Date.now();
          if (now - lastHeartbeatAt >= heartbeatIntervalMs) {
            controller.enqueue(formatSseComment("heartbeat"));
            lastHeartbeatAt = now;
          }

          await sleep(pollIntervalMs);
        }
      })().catch((error) => {
        if (!closed) controller.error(error);
      });
    },
    cancel() {
      closed = true;
      if (sleepTimer) {
        clearTimeout(sleepTimer);
        sleepTimer = undefined;
      }
    },
  });
}

function encodeSseFrame(lines: string[]): Uint8Array {
  return sseEncoder.encode(`${lines.join("\n")}\n`);
}

function formatSseComment(comment: string): Uint8Array {
  return encodeSseFrame([`: ${comment}`, ""]);
}

function formatRunSseEvent(event: FormattedRunEvent): Uint8Array {
  const dataLines = event.data.split(/\r?\n/);
  return encodeSseFrame([
    `id: ${event.id}`,
    `event: ${event.type}`,
    ...dataLines.map((line) => `data: ${line}`),
    "",
  ]);
}

function isRunTerminalStatus(status: unknown): boolean {
  return status === "completed" || status === "failed" ||
    status === "cancelled";
}

function formatRunEvents(
  persisted: PersistedRunEvent[],
  runId: string,
): FormattedRunEvent[] {
  return persisted.map((event) => ({
    id: event.event_id,
    event_id: String(event.event_id),
    run_id: runId,
    type: event.type,
    data: event.data,
    created_at: event.created_at,
  }));
}

function deriveRunStatusFromTimelineEvents(
  fallbackStatus: RunStatus,
  events: PersistedRunEvent[],
): RunStatus {
  let derivedStatus: RunStatus | null = null;
  for (const event of events) {
    const terminalStatus = deriveTerminalStatusFromRunEvent(
      event.type,
      event.data,
    );
    if (terminalStatus) {
      derivedStatus = terminalStatus;
    }
  }
  return derivedStatus ?? fallbackStatus;
}

async function fetchRunEventsAfter(
  env: RunObservationEnv,
  runId: string,
  afterEventId: number,
): Promise<PersistedRunEvent[]> {
  const byId = new Map<number, PersistedRunEvent>();

  const rows = await env.DB.prepare(`
    SELECT
      id,
      type,
      data,
      created_at AS createdAt
    FROM run_events
    WHERE run_id = ? AND id > ?
    ORDER BY id ASC
  `).bind(runId, afterEventId).all<Record<string, unknown>>();

  for (const row of rows.results) {
    const event = toPersistedRunEvent(asRunEventRow(row));
    byId.set(event.event_id, event);
  }

  if (env.TAKOS_OFFLOAD) {
    const r2Events = await getRunEventsAfterFromR2(
      env.TAKOS_OFFLOAD,
      runId,
      afterEventId,
      MAX_EVENTS_PER_RESPONSE,
    );
    for (const event of r2Events) {
      byId.set(event.event_id, event);
    }

    if (env.RUN_NOTIFIER) {
      try {
        const buffered = await getNotifierBufferedEvents(
          env.RUN_NOTIFIER,
          runId,
          afterEventId,
        );
        for (const event of buffered) {
          byId.set(event.event_id, event);
        }
      } catch {
        // SQL and object-store data are durable; notifier buffer is best effort.
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.event_id - b.event_id);
}

async function getNotifierBufferedEvents(
  namespace: DurableNamespaceBinding,
  runId: string,
  afterEventId: number,
): Promise<PersistedRunEvent[]> {
  const id = namespace.idFromName(runId);
  const stub = namespace.get(id);
  const response = await fetchWithTimeout(
    stub,
    new Request(`https://internal.do/events?after=${afterEventId}`, {}),
  );
  if (!response.ok) return [];
  const json = await response.json() as {
    events?: Array<{
      id: number;
      type: string;
      data: unknown;
      timestamp: number;
    }>;
  };
  const events = Array.isArray(json.events) ? json.events : [];
  return events
    .filter((event) =>
      typeof event?.id === "number" && Number.isFinite(event.id)
    )
    .map((event) => ({
      event_id: event.id,
      type: event.type,
      data: stringifyPersistedData(event.data),
      created_at: new Date(event.timestamp).toISOString(),
    }));
}

async function fetchWithTimeout(
  stub: {
    fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
  },
  request: Request,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    RUN_NOTIFIER_FETCH_TIMEOUT_MS,
  );
  try {
    return await stub.fetch(
      new Request(request, { signal: controller.signal }),
    );
  } finally {
    clearTimeout(timeout);
  }
}

function stringifyPersistedData(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function deriveTerminalStatusFromRunEvent(
  eventType: string,
  eventData: unknown,
): "completed" | "failed" | "cancelled" | null {
  if (eventType in RUN_TERMINAL_STATUS_BY_EVENT_TYPE) {
    return RUN_TERMINAL_STATUS_BY_EVENT_TYPE[eventType];
  }
  if (eventType !== "run_status") return null;

  const payload = parseRunEventPayload(eventData);
  const status = payload?.status;
  return status === "completed" || status === "failed" ||
      status === "cancelled"
    ? status
    : null;
}

function parseRunEventPayload(
  data: unknown,
): Record<string, unknown> | null {
  if (typeof data === "string") {
    try {
      return asRecord(JSON.parse(data));
    } catch {
      return null;
    }
  }
  return asRecord(data);
}

async function getRunEventsAfterFromR2(
  bucket: ObjectStoreBinding,
  runId: string,
  afterEventId: number,
  limit: number,
): Promise<PersistedRunEvent[]> {
  const startSegment =
    Math.floor(Math.max(0, afterEventId) / RUN_EVENT_SEGMENT_SIZE) + 1;
  const segmentIndexes = (await listRunEventSegmentIndexes(bucket, runId))
    .filter((index) => index >= startSegment);

  // Read segments sequentially in ascending order and stop as soon as we have
  // `limit` events. This avoids fanning out reads (and decompressing) every
  // remaining segment when only the first one or two are needed. Order and
  // filter match the previous fan-out + post-loop exactly.
  const events: PersistedRunEvent[] = [];
  for (const index of segmentIndexes) {
    const segment = await readRunEventSegment(bucket, runId, index);
    if (!segment) continue;
    for (const event of segment) {
      if (event.event_id <= afterEventId) continue;
      events.push(event);
      if (events.length >= limit) return events;
    }
  }
  return events;
}

async function listRunEventSegmentIndexes(
  bucket: ObjectStoreBinding,
  runId: string,
): Promise<number[]> {
  const prefix = `runs/${runId}/events/`;
  const indexes = new Set<number>();

  let cursor: string | undefined;
  while (true) {
    const result = await bucket.list({ prefix, cursor });
    for (const object of result.objects) {
      const index = parseSegmentIndexFromKey(object.key, prefix);
      if (index) indexes.add(index);
    }
    if (!result.truncated) break;
    cursor = result.cursor;
  }

  return Array.from(indexes).sort((a, b) => a - b);
}

async function readRunEventSegment(
  bucket: ObjectStoreBinding,
  runId: string,
  segmentIndex: number,
): Promise<PersistedRunEvent[] | null> {
  const object = await bucket.get(buildRunEventSegmentKey(runId, segmentIndex));
  if (!object) return null;
  const jsonl = await gzipDecompressToString(await object.arrayBuffer(), {
    maxDecompressedBytes: 200 * 1024 * 1024,
  });

  const events: PersistedRunEvent[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!isPersistedRunEvent(parsed)) continue;
      events.push(parsed);
    } catch {
      continue;
    }
  }

  return events.sort((a, b) => a.event_id - b.event_id);
}

async function gzipDecompressToString(
  data: ArrayBuffer,
  options: { maxDecompressedBytes: number },
): Promise<string> {
  const stream = new Blob([data]).stream();
  const decompressed = stream.pipeThrough(new DecompressionStream("gzip"));
  const reader = decompressed.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > options.maxDecompressedBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Decompressed run event segment exceeds limit");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}

function buildRunEventSegmentKey(runId: string, segmentIndex: number): string {
  return `runs/${runId}/events/${
    String(segmentIndex).padStart(6, "0")
  }.jsonl.gz`;
}

function parseSegmentIndexFromKey(
  key: string,
  prefix: string,
): number | null {
  if (!key.startsWith(prefix)) return null;
  const match = key.slice(prefix.length).match(/^(\d+)\.jsonl\.gz$/);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isFinite(index) && index > 0 ? Math.floor(index) : null;
}

function toPersistedRunEvent(row: RunEventRow): PersistedRunEvent {
  return {
    event_id: row.id,
    type: row.type,
    data: row.data,
    created_at: toIsoString(row.createdAt),
  };
}

function asRunEventRow(row: Record<string, unknown>): RunEventRow {
  return {
    id: numberField(row, "id"),
    type: stringField(row, "type"),
    data: stringField(row, "data"),
    createdAt: dateField(row, "createdAt"),
  };
}

function isPersistedRunEvent(value: unknown): value is PersistedRunEvent {
  const row = asRecord(value);
  return row !== null &&
    typeof row.event_id === "number" &&
    Number.isFinite(row.event_id) &&
    typeof row.type === "string" &&
    typeof row.data === "string" &&
    typeof row.created_at === "string";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberField(
  row: Record<string, unknown>,
  key: keyof RunEventRow,
): number {
  const value = row[key];
  if (typeof value === "number") return value;
  throw new TypeError(`Run event row field ${String(key)} must be a number`);
}

function stringField(
  row: Record<string, unknown>,
  key: keyof RunEventRow,
): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new TypeError(`Run event row field ${String(key)} must be a string`);
}

function dateField(
  row: Record<string, unknown>,
  key: keyof RunEventRow,
): string | Date {
  const value = row[key];
  if (typeof value === "string" || value instanceof Date) return value;
  throw new TypeError(`Run event row field ${String(key)} must be a date`);
}

function toIsoString(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}
