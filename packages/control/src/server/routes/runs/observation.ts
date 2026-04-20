import { getDb } from "../../../infra/db/index.ts";
import { runEvents } from "../../../infra/db/schema.ts";
import { and, asc, eq, gt } from "drizzle-orm";
import type { Env, RunStatus } from "../../../shared/types/index.ts";
import type { PersistedRunEvent } from "../../../application/services/offload/run-events.ts";
import { getRunEventsAfterFromR2 } from "../../../application/services/offload/run-events.ts";
import { deriveTerminalStatusFromRunEvent } from "../../../application/services/run-notifier/index.ts";
import { isRunTerminalStatus } from "../../../application/services/run-notifier/run-events-contract.ts";

import {
  fetchWithTimeout,
} from "../../../application/services/execution/run-events.ts";
import { MAX_EVENTS_PER_RESPONSE } from "../../../shared/config/limits.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";

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

const SSE_POLL_INTERVAL_MS = 1000;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const sseEncoder = new TextEncoder();

function stringifyPersistedData(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    // Circular references or non-serializable values -- coerce to string
    return String(value);
  }
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
): Promise<PersistedRunEvent[]> {
  const namespace = env.RUN_NOTIFIER;
  const id = namespace.idFromName(runId);
  const stub = namespace.get(id);
  const res = await fetchWithTimeout(
    stub,
    new Request(`https://internal.do/events?after=${afterEventId}`, {
      headers: { "X-Takos-Internal-Marker": "1" },
    }),
  );
  if (!res.ok) return [];
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
  return events
    .filter((e) => typeof e?.id === "number" && Number.isFinite(e.id))
    .map((e) => ({
      event_id: e.id,
      type: e.type,
      data: stringifyPersistedData(e.data),
      created_at: new Date(e.timestamp).toISOString(),
    }));
}

async function fetchRunEventsAfter(
  env: Env,
  runId: string,
  afterEventId: number,
): Promise<PersistedRunEvent[]> {
  const byId = new Map<number, PersistedRunEvent>();

  // Always read from D1 as the durable fallback
  const db = getDb(env.DB);
  const d1Result = await db.select({
    id: runEvents.id,
    runId: runEvents.runId,
    type: runEvents.type,
    data: runEvents.data,
    createdAt: runEvents.createdAt,
  }).from(runEvents).where(
    and(eq(runEvents.runId, runId), gt(runEvents.id, afterEventId)),
  ).orderBy(asc(runEvents.id)).all();

  for (const e of d1Result) {
    byId.set(e.id, {
      event_id: e.id,
      type: e.type,
      data: e.data,
      created_at: textDate(e.createdAt),
    });
  }

  // Merge with R2 offload segments and DO ring buffer (if available)
  if (env.TAKOS_OFFLOAD) {
    const r2Events = await getRunEventsAfterFromR2(
      env.TAKOS_OFFLOAD,
      runId,
      afterEventId,
      MAX_EVENTS_PER_RESPONSE,
    );
    for (const e of r2Events) byId.set(e.event_id, e);

    try {
      const buffered = await getNotifierBufferedEvents(
        env,
        runId,
        afterEventId,
      );
      for (const e of buffered) byId.set(e.event_id, e);
    } catch {
      // DO buffer unavailable — D1 and R2 data is sufficient
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.event_id - b.event_id);
}

export async function loadRunObservation(
  env: Env,
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
