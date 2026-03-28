/**
 * Agent Runner Event Emission
 *
 * Event emission helpers for the AgentRunner, including sequencing,
 * DB persistence, and Durable Object relay.
 */

import type { RunStatus, Env } from '../../../shared/types';
import type { AgentEvent } from './agent-models';
import type { EventEmissionError } from './runner-utils';
import { getDb, runEvents } from '../../../infra/db';
import type { RunTerminalPayload } from '../run-notifier';
import {
  buildTerminalPayload,
  buildRunNotifierEmitRequest,
  getRunNotifierStub,
  buildRunNotifierEmitPayload,
} from '../run-notifier';
import { logError, logWarn } from '../../../shared/utils/logger';
import {
  MAX_EVENT_EMISSION_ERRORS as MAX_EMISSION_ERRORS,
} from '../../../shared/config/limits';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';

// ── Event emission helpers ──────────────────────────────────────────

const MAX_EVENT_EMISSION_ERRORS = MAX_EMISSION_ERRORS;
const EVENT_EMISSION_MAX_BACKOFF_MS = 4_000;

export interface EventEmitterState {
  eventSequence: number;
  pendingEventEmissions: number;
  eventEmissionErrors: EventEmissionError[];
}

export function buildTerminalEventPayloadImpl(
  runId: string,
  status: 'completed' | 'failed' | 'cancelled',
  details: Record<string, unknown>,
  sessionId: string | null,
): RunTerminalPayload {
  return buildTerminalPayload(runId, status, details, sessionId);
}

/**
 * Emit a sequenced event for the run (to DB and WebSocket).
 */
export async function emitEventImpl(
  state: EventEmitterState,
  env: Env,
  db: SqlDatabaseBinding,
  runId: string,
  spaceId: string,
  getCurrentSessionId: () => Promise<string | null>,
  type: AgentEvent['type'],
  data: Record<string, unknown>,
  options?: { skipDb?: boolean },
  remoteEmit?: (input: {
    runId: string;
    type: AgentEvent['type'];
    data: Record<string, unknown>;
    sequence: number;
    skipDb?: boolean;
  }) => Promise<void>,
): Promise<void> {
  const now = new Date().toISOString();
  const sequence = ++state.eventSequence;
  state.pendingEventEmissions++;

  // For terminal events, ensure we have the latest session_id from DB
  let eventData = data;
  if ((type === 'completed' || type === 'error' || type === 'cancelled') && data.run) {
    const sessionId = await getCurrentSessionId();
    eventData = {
      ...data,
      run: {
        ...(data.run as Record<string, unknown>),
        session_id: sessionId,
      },
    };
  }

  const skipDb = options?.skipDb ?? false;
  const offloadEnabled = Boolean(env.TAKOS_OFFLOAD);
  let legacyEventId: number | null = null;
  const isTerminal = type === 'completed' || type === 'error' || type === 'cancelled';

  try {
    if (remoteEmit) {
      await remoteEmit({
        runId,
        type,
        data: eventData,
        sequence,
        skipDb,
      });
      return;
    }

    // Skip D1 write when R2 offload is enabled — the RunNotifierDO writes
    // events to R2 segments, making D1 redundant.
    if (!skipDb && !offloadEnabled) {
      const drizzleDb = getDb(db);
      const persisted = await drizzleDb.insert(runEvents).values({
        runId,
        type,
        data: JSON.stringify({ ...eventData, _sequence: sequence }),
        createdAt: now,
      }).returning({ id: runEvents.id }).get();
      legacyEventId = persisted?.id ?? null;
    }

    const stub = getRunNotifierStub(env, runId);
    const payload = buildRunNotifierEmitPayload(runId, type, eventData, legacyEventId);

    let emitOk = false;
    const doEmit = async () => {
      const emitRes = await stub.fetch(buildRunNotifierEmitRequest(payload));
      if (!emitRes.ok) {
        const body = await emitRes.text().catch(() => '');
        throw new Error(`DO emit non-OK ${emitRes.status}: ${body}`);
      }
      emitOk = true;
    };

    try {
      await doEmit();
    } catch (firstErr) {
      if (isTerminal) {
        const TERMINAL_MAX_RETRIES = 3;
        for (let attempt = 1; attempt <= TERMINAL_MAX_RETRIES; attempt++) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), EVENT_EMISSION_MAX_BACKOFF_MS);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          try {
            await doEmit();
            break;
          } catch (retryErr) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            if (attempt === TERMINAL_MAX_RETRIES) {
              logError(`CRITICAL: Terminal event '${type}' emit failed after ${TERMINAL_MAX_RETRIES} retries (run=${runId})`, retryMsg, { module: 'emitevent' });
            } else {
              logWarn(`Terminal event '${type}' retry ${attempt}/${TERMINAL_MAX_RETRIES} failed (run=${runId})`, { module: 'emitevent', detail: retryMsg });
            }
          }
        }
      }
      if (!emitOk) {
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        logError(`DO emit failed for ${type}`, msg, { module: 'emitevent' });
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(`Event emission error for ${type} (run=${runId})`, errorMsg, { module: 'emitevent' });
    if (isTerminal) {
      logError(`CRITICAL: Terminal event '${type}' lost for run=${runId}`, undefined, { module: 'emitevent' });
    }

    if (state.eventEmissionErrors.length < MAX_EVENT_EMISSION_ERRORS) {
      state.eventEmissionErrors.push({
        type,
        error: errorMsg,
        timestamp: now,
      });
    }
  } finally {
    state.pendingEventEmissions--;
  }
}
