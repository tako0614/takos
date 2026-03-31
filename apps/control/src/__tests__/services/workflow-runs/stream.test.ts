import type { Env } from '@/types';

import { assertEquals, assert } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  buildSanitizedDOHeaders: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/durable-objects/shared'
import { connectWorkflowRunStream } from '@/services/workflow-runs/stream';

function buildDrizzleMock(selectGet: unknown) {
  const chain: Record<string, unknown> = {};
  chain.from = (() => chain);
  chain.where = (() => chain);
  chain.get = (async () => selectGet);
  return {
    select: (() => chain),
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
  const notifierFetch = (async () => makeWebSocketResponse());
  const notifierGet = (() => ({ fetch: notifierFetch }));
  const notifierIdFromName = (() => 'do-id-1');

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


  Deno.test('connectWorkflowRunStream - returns 404 when run not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.buildSanitizedDOHeaders = (() => ({
      'X-WS-Auth-Validated': 'true',
      'X-WS-User-Id': 'user-1',
    })) as any;
  mocks.getDb = (() => buildDrizzleMock(null)) as any;

    const response = await connectWorkflowRunStream(makeEnv({ runNotifier: true }), {
      repoId: 'repo-1',
      runId: 'missing',
      userId: 'user-1',
      request: makeRequest(true),
    });

    assertEquals(response.status, 404);
    const body = await response.json() as { error: string };
    assertEquals(body.error, 'Run not found');
})
  Deno.test('connectWorkflowRunStream - returns 426 when Upgrade header is missing', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.buildSanitizedDOHeaders = (() => ({
      'X-WS-Auth-Validated': 'true',
      'X-WS-User-Id': 'user-1',
    })) as any;
  mocks.getDb = (() => buildDrizzleMock({ id: 'run-1' })) as any;

    const response = await connectWorkflowRunStream(makeEnv({ runNotifier: true }), {
      repoId: 'repo-1',
      runId: 'run-1',
      userId: 'user-1',
      request: makeRequest(false),
    });

    assertEquals(response.status, 426);
    const body = await response.json() as { error: string };
    assertEquals(body.error, 'Expected WebSocket upgrade');
})
  Deno.test('connectWorkflowRunStream - returns 426 when Upgrade header is not "websocket"', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.buildSanitizedDOHeaders = (() => ({
      'X-WS-Auth-Validated': 'true',
      'X-WS-User-Id': 'user-1',
    })) as any;
  mocks.getDb = (() => buildDrizzleMock({ id: 'run-1' })) as any;

    const headers = new Headers({ Upgrade: 'h2c' });
    const request = new Request('https://api.example.com/ws', { headers });

    const response = await connectWorkflowRunStream(makeEnv({ runNotifier: true }), {
      repoId: 'repo-1',
      runId: 'run-1',
      userId: 'user-1',
      request,
    });

    assertEquals(response.status, 426);
})
  Deno.test('connectWorkflowRunStream - proxies to the RUN_NOTIFIER durable object on valid request', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.buildSanitizedDOHeaders = (() => ({
      'X-WS-Auth-Validated': 'true',
      'X-WS-User-Id': 'user-1',
    })) as any;
  mocks.getDb = (() => buildDrizzleMock({ id: 'run-1' })) as any;

    const env = makeEnv({ runNotifier: true });
    const request = makeRequest(true, 'https://api.example.com/ws/run-1');

    const response = await connectWorkflowRunStream(env, {
      repoId: 'repo-1',
      runId: 'run-1',
      userId: 'user-1',
      request,
    });

    assertEquals(response.status, 101);

    const notifier = env.RUN_NOTIFIER as unknown as {
      idFromName: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
    };
    assertSpyCallArgs(notifier.idFromName, 0, ['run-1']);
    assert(notifier.get.calls.length > 0);

    const fetcher = notifier.get.calls[0].value as { fetch: ReturnType<typeof vi.fn> };
    assertSpyCallArgs(fetcher.fetch, 0, [
      'https://api.example.com/ws/run-1',
      ({
        method: 'GET',
        headers: /* expect.any(Object) */ {} as any,
      }),
    ]);
})
  Deno.test('connectWorkflowRunStream - passes sanitized headers with auth metadata', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.buildSanitizedDOHeaders = (() => ({
      'X-WS-Auth-Validated': 'true',
      'X-WS-User-Id': 'user-1',
    })) as any;
  mocks.getDb = (() => buildDrizzleMock({ id: 'run-1' })) as any;

    const env = makeEnv({ runNotifier: true });
    const request = makeRequest(true);

    await connectWorkflowRunStream(env, {
      repoId: 'repo-1',
      runId: 'run-1',
      userId: 'user-42',
      request,
    });

    assertSpyCallArgs(mocks.buildSanitizedDOHeaders, 0, [
      request.headers,
      {
        'X-WS-Auth-Validated': 'true',
        'X-WS-User-Id': 'user-42',
      },
    ]);
})
  Deno.test('connectWorkflowRunStream - uses "anonymous" for userId when null', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.buildSanitizedDOHeaders = (() => ({
      'X-WS-Auth-Validated': 'true',
      'X-WS-User-Id': 'user-1',
    })) as any;
  mocks.getDb = (() => buildDrizzleMock({ id: 'run-1' })) as any;

    const env = makeEnv({ runNotifier: true });
    const request = makeRequest(true);

    await connectWorkflowRunStream(env, {
      repoId: 'repo-1',
      runId: 'run-1',
      userId: null,
      request,
    });

    assertSpyCallArgs(mocks.buildSanitizedDOHeaders, 0, [
      request.headers,
      {
        'X-WS-Auth-Validated': 'true',
        'X-WS-User-Id': 'anonymous',
      },
    ]);
})
  Deno.test('connectWorkflowRunStream - uses "anonymous" for userId when undefined', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.buildSanitizedDOHeaders = (() => ({
      'X-WS-Auth-Validated': 'true',
      'X-WS-User-Id': 'user-1',
    })) as any;
  mocks.getDb = (() => buildDrizzleMock({ id: 'run-1' })) as any;

    const env = makeEnv({ runNotifier: true });
    const request = makeRequest(true);

    await connectWorkflowRunStream(env, {
      repoId: 'repo-1',
      runId: 'run-1',
      userId: undefined,
      request,
    });

    assertSpyCallArgs(mocks.buildSanitizedDOHeaders, 0, [
      request.headers,
      ({
        'X-WS-User-Id': 'anonymous',
      }),
    ]);
})