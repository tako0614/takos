import type { Env } from '../../../shared/types';
import { getDb, runEvents } from '../../../infra/db';
import {
  buildRunFailedPayload,
  type RunTerminalPayload,
} from './run-events-contract';
import { buildRunNotifierEmitRequest, getRunNotifierStub } from './client';
import { buildRunNotifierEmitPayload } from './run-notifier-payload';

export interface PersistedRunFailedEvent {
  payload: RunTerminalPayload;
  eventId: number | null;
}

export interface PersistRunFailedEventOptions {
  error: string;
  createdAt: string;
  sessionId?: string | null;
  permanent?: boolean;
}

export async function persistRunFailedEvent(
  env: Pick<Env, 'DB' | 'TAKOS_OFFLOAD'>,
  runId: string,
  options: PersistRunFailedEventOptions,
): Promise<PersistedRunFailedEvent> {
  const payload = buildRunFailedPayload(
    runId,
    options.error,
    {
      permanent: options.permanent,
      sessionId: options.sessionId ?? null,
    },
  );

  const eventId = env.TAKOS_OFFLOAD
    ? null
    : (await getDb(env.DB).insert(runEvents).values({
        runId,
        type: 'run.failed',
        data: JSON.stringify(payload),
        createdAt: options.createdAt,
      }).returning({ id: runEvents.id }).get()).id;

  return { payload, eventId };
}

export async function notifyRunFailedEvent(
  env: Pick<Env, 'RUN_NOTIFIER'>,
  runId: string,
  event: PersistedRunFailedEvent,
): Promise<void> {
  const notifierStub = getRunNotifierStub(env, runId);
  const payload = buildRunNotifierEmitPayload(
    runId,
    'run.failed',
    event.payload,
    event.eventId,
  );
  const request = buildRunNotifierEmitRequest(payload);
  await notifierStub.fetch(request as unknown as Parameters<typeof notifierStub.fetch>[0]);
}
