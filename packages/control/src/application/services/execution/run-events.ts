import { getDb, runEvents } from '../../../infra/db';
import type { Env } from '../../../shared/types';
import { now } from '../../../shared/utils';
import {
  buildRunNotifierEmitPayload,
  buildRunNotifierEmitRequest,
  getRunNotifierStub,
  type RunNotifierEmitPayload,
} from '../run-notifier';
import { logWarn } from '../../../shared/utils/logger';

// ---------------------------------------------------------------------------
// Persist a run event to D1 (when not using R2 offload)
// ---------------------------------------------------------------------------

export async function persistRunEvent(
  env: Env,
  runId: string,
  type: string,
  data: unknown
): Promise<number> {
  const db = getDb(env.DB);
  const event = await db.insert(runEvents).values({
    runId,
    type,
    data: JSON.stringify(data),
    createdAt: now(),
  }).returning({ id: runEvents.id }).get();
  return event.id;
}

// ---------------------------------------------------------------------------
// Emit an event to the RUN_NOTIFIER Durable Object for a given run
// ---------------------------------------------------------------------------

export async function emitToNotifier(
  env: Env,
  runId: string,
  payload: RunNotifierEmitPayload,
  useTimeout: boolean = false
): Promise<Response> {
  const notifierStub = getRunNotifierStub(env, runId);
  const request = buildRunNotifierEmitRequest(payload);

  if (useTimeout) {
    return fetchWithTimeout(notifierStub, request);
  }
  return notifierStub.fetch(request) as unknown as Response;
}

// ---------------------------------------------------------------------------
// Persist an event (when not using R2 offload) and emit it to the notifier DO.
// Silently catches notifier failures so callers can fire-and-forget.
// ---------------------------------------------------------------------------

export async function persistAndEmitEvent(
  env: Env,
  runId: string,
  type: string,
  data: unknown,
  useTimeout: boolean = false
): Promise<void> {
  const eventId = env.TAKOS_OFFLOAD
    ? null
    : await persistRunEvent(env, runId, type, data);

  try {
    await emitToNotifier(
      env,
      runId,
      buildRunNotifierEmitPayload(runId, type, data, eventId),
      useTimeout,
    );
  } catch (notifyErr) {
    logWarn(`Failed to notify WebSocket about ${type}`, { module: 'services/execution/run-events', detail: notifyErr });
  }
}

// ---------------------------------------------------------------------------
// DO fetch with timeout
// ---------------------------------------------------------------------------

const DO_FETCH_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  stub: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> },
  request: Request | URL | string,
  timeoutMs: number = DO_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const req = new Request(request, { signal: controller.signal });
    return await stub.fetch(req);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`DO fetch timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
