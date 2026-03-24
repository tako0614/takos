import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types';
import { createMockEnv } from '../../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

import {
  notifyRunFailedEvent,
  persistRunFailedEvent,
  type PersistedRunFailedEvent,
} from '@/services/run-notifier/run-failure-events';

describe('run-failure-events helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists run.failed event when offload is disabled', async () => {
    // Production code: db.insert(runEvents).values({...}).returning({id: runEvents.id}).get()
    const valuesCapture = vi.fn();
    const insertGet = vi.fn().mockResolvedValue({ id: 42 });
    const insertChain = {
      values: vi.fn().mockImplementation((data: unknown) => {
        valuesCapture(data);
        return insertChain;
      }),
      returning: vi.fn().mockReturnValue({ get: insertGet }),
    };
    mocks.getDb.mockReturnValue({
      insert: vi.fn().mockReturnValue(insertChain),
    });

    const env = createMockEnv({ TAKOS_OFFLOAD: undefined }) as unknown as Env;
    const createdAt = '2026-02-27T00:00:00.000Z';

    const event = await persistRunFailedEvent(env, 'run-1', {
      error: 'boom',
      createdAt,
      permanent: true,
      sessionId: 'sess-1',
    });

    expect(event.eventId).toBe(42);
    expect(event.payload).toEqual({
      status: 'failed',
      run: {
        id: 'run-1',
        session_id: 'sess-1',
      },
      error: 'boom',
      permanent: true,
    });

    expect(valuesCapture).toHaveBeenCalledTimes(1);
    const inserted = valuesCapture.mock.calls[0][0] as {
      runId: string; type: string; data: string; createdAt: string;
    };
    expect(inserted.runId).toBe('run-1');
    expect(inserted.type).toBe('run.failed');
    expect(inserted.createdAt).toBe(createdAt);
    expect(JSON.parse(inserted.data)).toEqual(event.payload);
  });

  it('skips D1 event persistence when offload is enabled', async () => {
    const runEventCreate = vi.fn().mockResolvedValue({ id: 7 });
    mocks.getDb.mockReturnValue({ runEvent: { create: runEventCreate } });

    const env = createMockEnv({ TAKOS_OFFLOAD: { enabled: true } }) as unknown as Env;

    const event = await persistRunFailedEvent(env, 'run-2', {
      error: 'queue failed',
      createdAt: '2026-02-27T00:00:01.000Z',
    });

    expect(event.eventId).toBeNull();
    expect(event.payload.status).toBe('failed');
    expect(runEventCreate).not.toHaveBeenCalled();
  });

  it('notifies run notifier with event_id when present', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('ok'));
    const runNotifier = {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'run-3' }),
      get: vi.fn().mockReturnValue({ fetch: fetchSpy }),
    };
    const env = createMockEnv({ RUN_NOTIFIER: runNotifier }) as unknown as Env;

    const event: PersistedRunFailedEvent = {
      payload: {
        status: 'failed',
        run: { id: 'run-3', session_id: 'sess-3' },
        error: 'fatal',
        permanent: true,
      },
      eventId: 99,
    };

    await notifyRunFailedEvent(env, 'run-3', event);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = fetchSpy.mock.calls[0][0] as Request;
    const body = await request.json() as Record<string, unknown>;
    expect(body).toEqual({
      runId: 'run-3',
      type: 'run.failed',
      data: event.payload,
      event_id: 99,
    });
  });

  it('omits event_id when no persisted id exists', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('ok'));
    const runNotifier = {
      idFromName: vi.fn().mockReturnValue({ toString: () => 'run-4' }),
      get: vi.fn().mockReturnValue({ fetch: fetchSpy }),
    };
    const env = createMockEnv({ RUN_NOTIFIER: runNotifier }) as unknown as Env;

    const event: PersistedRunFailedEvent = {
      payload: {
        status: 'failed',
        run: { id: 'run-4', session_id: null },
        error: 'fatal',
      },
      eventId: null,
    };

    await notifyRunFailedEvent(env, 'run-4', event);

    const request = fetchSpy.mock.calls[0][0] as Request;
    const body = await request.json() as Record<string, unknown>;
    expect(body).toEqual({
      runId: 'run-4',
      type: 'run.failed',
      data: event.payload,
    });
  });
});
