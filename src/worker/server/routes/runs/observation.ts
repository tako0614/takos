import { getDb } from "../../../infra/db/index.ts";
import { runEvents } from "../../../infra/db/schema.ts";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Env, RunStatus } from "../../../shared/types/index.ts";
import type { PersistedRunEvent } from "../../../application/services/offload/run-events.ts";
import {
  getRunEventsAfterPageFromR2,
  MAX_PERSISTED_RUN_EVENT_DATA_BYTES,
  RUN_EVENT_TRUNCATED_DATA,
} from "../../../application/services/offload/run-events.ts";
import { deriveTerminalStatusFromRunEvent } from "../../../application/services/run-notifier/index.ts";
import { isRunTerminalStatus } from "../../../application/services/run-notifier/run-events-contract.ts";

import { fetchWithTimeout } from "../../../application/services/execution/run-events.ts";
import { MAX_EVENTS_PER_RESPONSE } from "../../../shared/config/limits.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";

export type FormattedRunEvent = {
  id: number;
  event_id: string;
  run_id: string;
  type: string;
  data: string;
  data_truncated: boolean;
  created_at: string;
};

export type RunObservation = {
  events: FormattedRunEvent[];
  runStatus: RunStatus;
  truncation: {
    events: boolean;
    event_data: boolean;
    archive: boolean;
  };
};

const SSE_POLL_INTERVAL_MS = 1000;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const sseEncoder = new TextEncoder();
const observationEncoder = new TextEncoder();

export function parseRunReplayCursor(
  value: string | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") return 0;
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function boundedPersistedData(value: unknown): string {
  let serialized: string;
  try {
    serialized = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return RUN_EVENT_TRUNCATED_DATA;
  }
  if (observationEncoder.encode(serialized).byteLength >
      MAX_PERSISTED_RUN_EVENT_DATA_BYTES) {
    return RUN_EVENT_TRUNCATED_DATA;
  }
  try {
    JSON.parse(serialized);
  } catch {
    return RUN_EVENT_TRUNCATED_DATA;
  }
  return serialized;
}

function formatRunEvents(
  persisted: PersistedRunEvent[],
  runId: string,
): FormattedRunEvent[] {
  return persisted.map((e) => ({
    id: e.event_id,
    event_id: String(e.event_id),
    run_id: runId,
    type: e.type,
    data: e.data,
    data_truncated: e.data === RUN_EVENT_TRUNCATED_DATA,
    created_at: e.created_at,
  }));
}

export function deriveRunStatusFromTimelineEvents(
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

async function getNotifierBufferedEvents(
  env: Env,
  runId: string,
  afterEventId: number,
): Promise<{ events: PersistedRunEvent[]; archiveTruncated: boolean }> {
  const namespace = env.RUN_NOTIFIER;
  const id = namespace.idFromName(runId);
  const stub = namespace.get(id);
  const res = await fetchWithTimeout(
    stub,
    new Request(`https://internal.do/events?after=${afterEventId}`, {}),
  );
  if (!res.ok) return { events: [], archiveTruncated: false };
  const json = await res.json() as {
    events?: Array<
      {
        id: number;
        type: string;
        data: unknown;
        timestamp: number;
        event_id?: string;
      }
    >;
  };
  const events = Array.isArray(json.events) ? json.events : [];
  let archiveTruncated = events.length > 100;
  const projected: PersistedRunEvent[] = [];
  for (const event of events.slice(0, 100)) {
    if (
      typeof event?.id !== "number" || !Number.isSafeInteger(event.id) ||
      event.id <= afterEventId || typeof event.type !== "string" ||
      event.type.length === 0 || event.type.length > 256 ||
      typeof event.timestamp !== "number" ||
      !Number.isFinite(event.timestamp)
    ) {
      archiveTruncated = true;
      continue;
    }
    const createdAt = new Date(event.timestamp);
    if (!Number.isFinite(createdAt.getTime())) {
      archiveTruncated = true;
      continue;
    }
    projected.push({
      event_id: event.id,
      type: event.type,
      data: boundedPersistedData(event.data),
      created_at: createdAt.toISOString(),
    });
  }
  return { events: projected, archiveTruncated };
}

async function fetchRunEventsAfter(
  env: Env,
  runId: string,
  afterEventId: number,
): Promise<{
  events: PersistedRunEvent[];
  eventsTruncated: boolean;
  archiveTruncated: boolean;
}> {
  const byId = new Map<number, PersistedRunEvent>();
  let eventsTruncated = false;
  let archiveTruncated = false;

  // SQL is authoritative for non-offloaded events and always retains the
  // terminal event. Fetch one sentinel row past the public page size so a
  // completed Run can continue replaying before the SSE stream closes.
  const db = getDb(env.DB);
  const d1Result = await db.select({
    id: runEvents.id,
    runId: runEvents.runId,
    type: runEvents.type,
    data: sql<string>`substr(${runEvents.data}, 1, ${
      MAX_PERSISTED_RUN_EVENT_DATA_BYTES + 1
    })`,
    createdAt: runEvents.createdAt,
  }).from(runEvents).where(
    and(eq(runEvents.runId, runId), gt(runEvents.id, afterEventId)),
  ).orderBy(asc(runEvents.id)).limit(MAX_EVENTS_PER_RESPONSE + 1).all();
  eventsTruncated ||= d1Result.length > MAX_EVENTS_PER_RESPONSE;

  // Object storage is the replay authority for intermediate events when
  // offload is enabled. It is read as a bounded direct segment page rather
  // than by scanning every key under the Run prefix.
  if (env.TAKOS_OFFLOAD) {
    const r2Page = await getRunEventsAfterPageFromR2(
      env.TAKOS_OFFLOAD,
      runId,
      afterEventId,
      MAX_EVENTS_PER_RESPONSE,
    );
    eventsTruncated ||= r2Page.hasMore;
    archiveTruncated ||= r2Page.archiveTruncated;
    for (const event of r2Page.events) byId.set(event.event_id, event);

    try {
      const buffered = await getNotifierBufferedEvents(
        env,
        runId,
        afterEventId,
      );
      archiveTruncated ||= buffered.archiveTruncated;
      for (const event of buffered.events) {
        byId.set(event.event_id, event);
      }
    } catch {
      // DO buffer unavailable — SQL store and object store data is sufficient
    }
  }

  // Durable SQL evidence wins an event-id collision with a cache/archive
  // source (notably a terminal event whose global SQL id advanced the DO
  // counter). Never allow a stale ring entry to mask the committed outcome.
  for (const event of d1Result.slice(0, MAX_EVENTS_PER_RESPONSE)) {
    byId.set(event.id, {
      event_id: event.id,
      type: event.type,
      data: boundedPersistedData(event.data),
      created_at: textDate(event.createdAt),
    });
  }

  const sorted = Array.from(byId.values()).sort((left, right) =>
    left.event_id - right.event_id
  );
  eventsTruncated ||= sorted.length > MAX_EVENTS_PER_RESPONSE;
  return {
    events: sorted.slice(0, MAX_EVENTS_PER_RESPONSE),
    eventsTruncated,
    archiveTruncated,
  };
}

export async function loadRunObservation(
  env: Env,
  runId: string,
  fallbackStatus: RunStatus,
  lastEventId: number,
): Promise<RunObservation> {
  const page = await fetchRunEventsAfter(env, runId, lastEventId);
  return {
    events: formatRunEvents(page.events, runId),
    runStatus: deriveRunStatusFromTimelineEvents(
      fallbackStatus,
      page.events,
    ),
    truncation: {
      events: page.eventsTruncated,
      event_data: page.events.some((event) =>
        event.data === RUN_EVENT_TRUNCATED_DATA
      ),
      archive: page.archiveTruncated,
    },
  };
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
            if (
              isRunTerminalStatus(observation.runStatus) &&
              !observation.truncation.events
            ) {
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
        if (!closed) {
          controller.error(error);
        }
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

export function createRunObservationSseStream(
  env: Env,
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
