import { getDb } from '../../../infra/db';
import { runEvents } from '../../../infra/db/schema';
import { eq, and, gt, asc } from 'drizzle-orm';
import type { Env, RunStatus } from '../../../shared/types';
import { toIsoString } from '../../../shared/utils';
import type { PersistedRunEvent } from '../../../application/services/offload/run-events';
import { getRunEventsAfterFromR2 } from '../../../application/services/offload/run-events';
import {
  deriveTerminalStatusFromRunEvent,
} from '../../../application/services/run-notifier';
import { buildDurableObjectUrl } from '../../../shared/utils';
import {
  fetchWithTimeout,
} from '../../../application/services/execution/run-events';
import { MAX_EVENTS_PER_RESPONSE } from '../../../shared/config/limits';

type RunNotifierNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: unknown, init?: unknown): Promise<Response> };
};

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

function stringifyPersistedData(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    // Circular references or non-serializable values -- coerce to string
    return String(value);
  }
}

function formatRunEvents(persisted: PersistedRunEvent[], runId: string): FormattedRunEvent[] {
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
    const terminalStatus = deriveTerminalStatusFromRunEvent(event.type, event.data);
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
  const namespace = env.RUN_NOTIFIER as unknown as RunNotifierNamespace;
  const id = namespace.idFromName(runId);
  const stub = namespace.get(id);
  const res = await fetchWithTimeout(
    stub,
    new Request(buildDurableObjectUrl(`/events?after=${afterEventId}`), {
      headers: { 'X-Takos-Internal': '1' },
    }),
  );
  if (!res.ok) return [];
  const json = await res.json() as {
    events?: Array<{ id: number; type: string; data: unknown; timestamp: number; event_id?: string }>;
  };
  const events = Array.isArray(json.events) ? json.events : [];
  return events
    .filter((e) => typeof e?.id === 'number' && Number.isFinite(e.id))
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
    and(eq(runEvents.runId, runId), gt(runEvents.id, afterEventId))
  ).orderBy(asc(runEvents.id)).all();

  for (const e of d1Result) {
    byId.set(e.id, {
      event_id: e.id,
      type: e.type,
      data: e.data,
      created_at: toIsoString(e.createdAt),
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
      const buffered = await getNotifierBufferedEvents(env, runId, afterEventId);
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
    runStatus: deriveRunStatusFromTimelineEvents(fallbackStatus, persistedEvents),
  };
}
