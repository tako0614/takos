import { getDb } from "../../../infra/db/index.ts";
import { runEvents } from "../../../infra/db/schema.ts";
import { and, asc, eq, gt } from "drizzle-orm";
import type { Env, RunStatus } from "../../../shared/types/index.ts";
import type { PersistedRunEvent } from "../../../application/services/offload/run-events.ts";
import { getIndexedRunEventsAfter } from "../../../application/services/offload/indexed-run-events.ts";
import { deriveTerminalStatusFromRunEvent } from "../../../application/services/run-notifier/index.ts";
import { isRunTerminalStatus } from "../../../application/services/run-notifier/run-events-contract.ts";

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
  /** A bounded page can end before the terminal event of a completed run. */
  hasMore?: boolean;
};

type RunObservationStreamOptions = {
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  /** Notifications wake the durable reader; their frames are never replay authority. */
  notifications?: ReadableStream<Uint8Array>;
};

const SSE_POLL_INTERVAL_MS = 1000;
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
const sseEncoder = new TextEncoder();

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

async function fetchRunEventsAfter(
  env: Env,
  runId: string,
  afterEventId: number,
  limit?: number,
): Promise<PersistedRunEvent[]> {
  const byId = new Map<number, PersistedRunEvent>();

  // Always read from SQL store as the durable fallback
  const db = getDb(env.DB);
  const query = db
    .select({
      id: runEvents.id,
      runId: runEvents.runId,
      type: runEvents.type,
      data: runEvents.data,
      createdAt: runEvents.createdAt,
    })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.id, afterEventId)))
    .orderBy(asc(runEvents.id));
  const d1Result = await (
    limit === undefined ? query : query.limit(limit)
  ).all();

  for (const e of d1Result) {
    byId.set(e.id, {
      event_id: e.id,
      type: e.type,
      data: e.data,
      created_at: textDate(e.createdAt),
    });
  }

  // The durable index is the replay authority for offloaded history. SQL still
  // contributes terminal evidence when a notifier write failed after commit.
  if (env.TAKOS_OFFLOAD) {
    const indexedEvents = await getIndexedRunEventsAfter(
      env.RUN_NOTIFIER,
      env.TAKOS_OFFLOAD,
      runId,
      afterEventId,
      limit ?? MAX_EVENTS_PER_RESPONSE,
    );
    for (const e of indexedEvents) byId.set(e.event_id, e);
  }

  const ordered = Array.from(byId.values()).sort(
    (a, b) => a.event_id - b.event_id,
  );
  return limit === undefined ? ordered : ordered.slice(0, limit);
}

export async function loadRunObservation(
  env: Env,
  runId: string,
  fallbackStatus: RunStatus,
  lastEventId: number,
  maxEvents?: number,
): Promise<RunObservation> {
  const persistedEvents = await fetchRunEventsAfter(
    env,
    runId,
    lastEventId,
    maxEvents === undefined ? undefined : maxEvents + 1,
  );
  const hasMore = maxEvents !== undefined && persistedEvents.length > maxEvents;
  const page =
    maxEvents === undefined
      ? persistedEvents
      : persistedEvents.slice(0, maxEvents);
  return {
    events: formatRunEvents(page, runId),
    runStatus: deriveRunStatusFromTimelineEvents(fallbackStatus, page),
    ...(maxEvents === undefined ? {} : { hasMore }),
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
  options?: RunObservationStreamOptions,
): ReadableStream<Uint8Array> {
  const pollIntervalMs = options?.pollIntervalMs ?? SSE_POLL_INTERVAL_MS;
  const heartbeatIntervalMs =
    options?.heartbeatIntervalMs ?? SSE_HEARTBEAT_INTERVAL_MS;
  let closed = false;
  let sleepTimer: ReturnType<typeof setTimeout> | undefined;
  let wakePoll: (() => void) | undefined;
  let notificationPending = false;
  let lastEventId = initialLastEventId;
  let lastHeartbeatAt = Date.now();
  let page: FormattedRunEvent[] = [];
  let pageOffset = 0;
  let terminalPage = false;
  const notificationReader = options?.notifications?.getReader();

  const cleanup = () => {
    closed = true;
    wakePoll?.();
    // Cancellation releases the Node notifier's subscriber and heartbeat.
    void notificationReader?.cancel().catch(() => {});
  };

  const sleep = (ms: number) => {
    if (closed || notificationPending) {
      notificationPending = false;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      wakePoll = () => {
        if (sleepTimer !== undefined) clearTimeout(sleepTimer);
        sleepTimer = undefined;
        wakePoll = undefined;
        notificationPending = false;
        resolve();
      };
      sleepTimer = setTimeout(wakePoll, ms);
    });
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(formatSseComment("connected"));
      if (notificationReader) {
        void (async () => {
          try {
            while (!closed) {
              const result = await notificationReader.read();
              if (closed || result.done) return;
              notificationPending = true;
              wakePoll?.();
            }
          } catch {
            // Redis/local notifications can fail or miss a delivery. Polling
            // still observes the persisted timeline without losing its cursor.
          } finally {
            notificationReader.releaseLock();
          }
        })();
      }
    },
    async pull(controller) {
      try {
        while (!closed) {
          // One frame per pull keeps slow clients from buffering the entire
          // run history and keeps subsequent page reads behind client demand.
          if (pageOffset < page.length) {
            const event = page[pageOffset++];
            lastEventId = event.id;
            controller.enqueue(formatRunSseEvent(event));
            lastHeartbeatAt = Date.now();
            if (pageOffset === page.length && terminalPage) {
              cleanup();
              controller.close();
            }
            return;
          }

          const observation = await source(lastEventId);
          if (closed) return;
          page = observation.events;
          pageOffset = 0;
          terminalPage =
            isRunTerminalStatus(observation.runStatus) &&
            observation.hasMore !== true;
          if (page.length > 0) continue;

          if (terminalPage) {
            cleanup();
            controller.close();
            return;
          }

          const now = Date.now();
          if (now - lastHeartbeatAt >= heartbeatIntervalMs) {
            controller.enqueue(formatSseComment("heartbeat"));
            lastHeartbeatAt = now;
            return;
          }

          await sleep(pollIntervalMs);
        }
      } catch (error) {
        if (!closed) {
          cleanup();
          controller.error(error);
        }
      }
    },
    cancel() {
      cleanup();
    },
  });
}

export function createRunObservationSseStream(
  env: Env,
  runId: string,
  fallbackStatus: RunStatus,
  lastEventId: number,
  options?: RunObservationStreamOptions,
): ReadableStream<Uint8Array> {
  return createPollingRunObservationStream(
    (afterEventId) =>
      loadRunObservation(
        env,
        runId,
        fallbackStatus,
        afterEventId,
        MAX_EVENTS_PER_RESPONSE,
      ),
    lastEventId,
    options,
  );
}
