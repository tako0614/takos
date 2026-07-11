import type { Env } from "../../../shared/types/index.ts";
import { getSseNotifier } from "../../../platform/sse-notifier-access.ts";

import {
  buildRunNotifierEmitPayload,
  buildRunNotifierEmitRequest,
  getRunNotifierStub,
  type RunNotifierEmitPayload,
} from "../run-notifier/index.ts";
import { logWarn } from "../../../shared/utils/logger.ts";

// ---------------------------------------------------------------------------
// Emit an event to the RUN_NOTIFIER Durable Object for a given run
// ---------------------------------------------------------------------------

export async function emitToNotifier(
  env: Env,
  runId: string,
  payload: RunNotifierEmitPayload,
  useTimeout: boolean = false,
): Promise<Response> {
  const notifierStub = getRunNotifierStub(env, runId);
  const request = buildRunNotifierEmitRequest(payload);

  if (useTimeout) {
    return fetchWithTimeout(notifierStub, request);
  }
  return notifierStub.fetch(request);
}

/** Emit an event whose SQL row was already committed by the caller. */
export async function emitCommittedRunEvent(
  env: Env,
  runId: string,
  type: string,
  data: unknown,
  eventId: number | null,
  useTimeout: boolean = false,
): Promise<void> {
  try {
    await emitToNotifier(
      env,
      runId,
      buildRunNotifierEmitPayload(runId, type, data, eventId),
      useTimeout,
    );
  } catch (notifyErr) {
    logWarn(`Failed to notify WebSocket about ${type}`, {
      module: "services/execution/run-events",
      detail: notifyErr,
    });
  }

  // Also emit via SSE notifier for Node.js / k8s environments.
  const sseNotifier = getSseNotifier(env);
  if (sseNotifier) {
    try {
      sseNotifier.emit(`run:${runId}`, {
        type,
        data,
        event_id: eventId ?? undefined,
      });
    } catch (sseErr) {
      logWarn(`Failed to emit SSE event for ${type}`, {
        module: "services/execution/run-events",
        detail: sseErr,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// DO fetch with timeout
// ---------------------------------------------------------------------------

const DO_FETCH_TIMEOUT_MS = 10_000;

export async function fetchWithTimeout(
  stub: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  },
  request: Request | URL | string,
  timeoutMs: number = DO_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const req = new Request(request, { signal: controller.signal });
    return await stub.fetch(req);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`DO fetch timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
