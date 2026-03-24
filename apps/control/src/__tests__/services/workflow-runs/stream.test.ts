import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  buildSanitizedDOHeaders: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return {
    ...actual,
    getDb: mocks.getDb,
  };
});

vi.mock('@/durable-objects/shared', () => ({
  buildSanitizedDOHeaders: mocks.buildSanitizedDOHeaders,
}));

import { connectWorkflowRunStream } from '@/services/workflow-runs/stream';

function buildDrizzleMock(selectGet: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.get = vi.fn().mockResolvedValue(selectGet);
  return {
    select: vi.fn().mockReturnValue(chain),
  };
}

function makeWebSocketResponse(): Response {
  // Node.js Response constructor doesn't accept status 101,
  // so we create a 200 response and override the status property.
  const res = new Response('ws-stream', { status: 200 });
  Object.defineProperty(res, 'status', { value: 101 });
  return res;
}

function makeEnv(options: { runNotifier?: boolean } = {}): Env {
  const notifierFetch = vi.fn().mockResolvedValue(makeWebSocketResponse());
  const notifierGet = vi.fn().mockReturnValue({ fetch: notifierFetch });
  const notifierIdFromName = vi.fn().mockReturnValue('do-id-1');

  return {
    DB: {} as Env['DB'],
    RUN_NOTIFIER: options.runNotifier ? {
      idFromName: notifierIdFromName,
      get: notifierGet,
    } : undefined,
  } as unknown as Env;
}

function makeRequest(upgrade: boolean, url = 'https://api.example.com/ws'): Request {
  const headers = new Headers();
  if (upgrade) {
    headers.set('Upgrade', 'websocket');
  }
  return new Request(url, { headers });
}

describe('connectWorkflowRunStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildSanitizedDOHeaders.mockReturnValue({
      'X-WS-Auth-Validated': 'true',
      'X-WS-User-Id': 'user-1',
    });
  });

  it('returns 404 when run not found', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock(null));

    const response = await connectWorkflowRunStream(makeEnv({ runNotifier: true }), {
      repoId: 'repo-1',
      runId: 'missing',
      userId: 'user-1',
      request: makeRequest(true),
    });

    expect(response.status).toBe(404);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('Run not found');
  });

  it('returns 426 when Upgrade header is missing', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock({ id: 'run-1' }));

    const response = await connectWorkflowRunStream(makeEnv({ runNotifier: true }), {
      repoId: 'repo-1',
      runId: 'run-1',
      userId: 'user-1',
      request: makeRequest(false),
    });

    expect(response.status).toBe(426);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('Expected WebSocket upgrade');
  });

  it('returns 426 when Upgrade header is not "websocket"', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock({ id: 'run-1' }));

    const headers = new Headers({ Upgrade: 'h2c' });
    const request = new Request('https://api.example.com/ws', { headers });

    const response = await connectWorkflowRunStream(makeEnv({ runNotifier: true }), {
      repoId: 'repo-1',
      runId: 'run-1',
      userId: 'user-1',
      request,
    });

    expect(response.status).toBe(426);
  });

  it('proxies to the RUN_NOTIFIER durable object on valid request', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock({ id: 'run-1' }));

    const env = makeEnv({ runNotifier: true });
    const request = makeRequest(true, 'https://api.example.com/ws/run-1');

    const response = await connectWorkflowRunStream(env, {
      repoId: 'repo-1',
      runId: 'run-1',
      userId: 'user-1',
      request,
    });

    expect(response.status).toBe(101);

    const notifier = env.RUN_NOTIFIER as unknown as {
      idFromName: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
    };
    expect(notifier.idFromName).toHaveBeenCalledWith('run-1');
    expect(notifier.get).toHaveBeenCalled();

    const fetcher = notifier.get.mock.results[0].value as { fetch: ReturnType<typeof vi.fn> };
    expect(fetcher.fetch).toHaveBeenCalledWith(
      'https://api.example.com/ws/run-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Object),
      }),
    );
  });

  it('passes sanitized headers with auth metadata', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock({ id: 'run-1' }));

    const env = makeEnv({ runNotifier: true });
    const request = makeRequest(true);

    await connectWorkflowRunStream(env, {
      repoId: 'repo-1',
      runId: 'run-1',
      userId: 'user-42',
      request,
    });

    expect(mocks.buildSanitizedDOHeaders).toHaveBeenCalledWith(
      request.headers,
      {
        'X-WS-Auth-Validated': 'true',
        'X-WS-User-Id': 'user-42',
      },
    );
  });

  it('uses "anonymous" for userId when null', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock({ id: 'run-1' }));

    const env = makeEnv({ runNotifier: true });
    const request = makeRequest(true);

    await connectWorkflowRunStream(env, {
      repoId: 'repo-1',
      runId: 'run-1',
      userId: null,
      request,
    });

    expect(mocks.buildSanitizedDOHeaders).toHaveBeenCalledWith(
      request.headers,
      {
        'X-WS-Auth-Validated': 'true',
        'X-WS-User-Id': 'anonymous',
      },
    );
  });

  it('uses "anonymous" for userId when undefined', async () => {
    mocks.getDb.mockReturnValue(buildDrizzleMock({ id: 'run-1' }));

    const env = makeEnv({ runNotifier: true });
    const request = makeRequest(true);

    await connectWorkflowRunStream(env, {
      repoId: 'repo-1',
      runId: 'run-1',
      userId: undefined,
      request,
    });

    expect(mocks.buildSanitizedDOHeaders).toHaveBeenCalledWith(
      request.headers,
      expect.objectContaining({
        'X-WS-User-Id': 'anonymous',
      }),
    );
  });
});
