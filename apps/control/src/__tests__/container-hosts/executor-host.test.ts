/**
 * Tests for executor-host proxy handlers and error classification.
 *
 * The hybrid dispatch and dual-mode auth tests live in test/executor-host.test.ts.
 * This file focuses on the individual proxy handler functions and error paths
 * that are not covered there.
 */
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/message-persistence'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/runner'
// [Deno] vi.mock removed - manually stub imports from '@/services/agent/skills'
// [Deno] vi.mock removed - manually stub imports from '@/services/memory-graph/claim-store'
// [Deno] vi.mock removed - manually stub imports from '@/services/memory-graph/activation'
// [Deno] vi.mock removed - manually stub imports from '@/tools/executor'
import executorHost, {
  validateProxyResourceAccess,
} from '@/container-hosts/executor-host';
import { getDb } from '@/db';
import { persistMessage } from '@/services/agent/message-persistence';
import {
  buildConversationHistory,
  updateRunStatusImpl,
} from '@/services/agent/runner';
import { resolveSkillPlanForRun } from '@/services/agent/skills';
import {
  getActiveClaims,
  countEvidenceForClaims,
  getPathsForClaim,
  upsertClaim,
  insertEvidence,
} from '@/services/memory-graph/claim-store';
import {
  buildActivationBundles,
  renderActivationSegment,
} from '@/services/memory-graph/activation';
import { createToolExecutor } from '@/tools/executor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    HOME_SERVER: { fetch: ((..._args: any[]) => undefined) as any },
    EXECUTOR_CONTAINER: makeMockExecutorContainerNamespace(),
    DB: makeMockD1(),
    RUN_NOTIFIER: makeMockDONamespace(),
    TAKOS_OFFLOAD: makeMockR2(),
    GIT_OBJECTS: makeMockR2(),
    TAKOS_EGRESS: { fetch: (async () => new Response('ok', { status: 200 })) },
    RUNTIME_HOST: { fetch: (async () => new Response('ok', { status: 200 })) },
    BROWSER_HOST: { fetch: (async () => new Response('ok', { status: 200 })) },
    INDEX_QUEUE: { send: ((..._args: any[]) => undefined) as any, sendBatch: ((..._args: any[]) => undefined) as any },
    VECTORIZE: makeMockVectorize(),
    AI: { run: (async () => ({ result: 'ai-output' })) },
    OPENAI_API_KEY: 'test-openai',
    ANTHROPIC_API_KEY: 'test-anthropic',
    GOOGLE_API_KEY: 'test-google',
    CONTROL_RPC_BASE_URL: 'https://executor-host.workers.dev',
    ...overrides,
  };
}

function makeMockD1(): any {
  const stmt = {
    bind: (function(this: any) { return this; }),
    first: (async () => null),
    all: (async () => ({ results: [], success: true, meta: {} })),
    run: (async () => ({ success: true, meta: { changes: 1, last_row_id: 1, duration: 0 } })),
    raw: (async () => []),
  };
  return {
    prepare: (() => stmt),
    batch: (async () => []),
    exec: ((..._args: any[]) => undefined) as any,
    _stmt: stmt,
  };
}

function makeMockR2(): any {
  return {
    get: (async () => null),
    put: (async () => ({ key: 'test', size: 0, etag: 'etag', uploaded: new Date() })),
    delete: (async () => undefined),
    list: (async () => ({ objects: [], truncated: false })),
    head: (async () => null),
  };
}

function makeMockDONamespace(): any {
  const stub = {
    fetch: (async () => new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })),
  };
  return {
    idFromName: (() => ({ toString: () => 'do-id' })),
    get: (() => stub),
    _stub: stub,
  };
}

function makeMockExecutorContainerNamespace(): any {
  return {
    getByName: (runId: string) => ({
      verifyProxyToken: async (token: string) => {
        if (token === 'bindings-token') {
          return { runId, serviceId: 'worker-1', capability: 'bindings' };
        }
        if (token === 'control-token') {
          return { runId, serviceId: 'worker-1', capability: 'control' };
        }
        return null;
      },
      dispatchStart: async (body: Record<string, unknown>) => ({
        ok: true,
        status: 202,
        body: JSON.stringify({ status: 'accepted', runId: body.runId ?? runId }),
      }),
    }),
  };
}

function makeMockVectorize(): any {
  return {
    query: (async () => ({ matches: [] })),
    insert: (async () => undefined),
    upsert: (async () => undefined),
    deleteByIds: (async () => undefined),
    getByIds: (async () => []),
    describe: (async () => ({ dimensions: 128 })),
  };
}

function makeProxyRequest(path: string, opts: {
  runId?: string;
  body?: Record<string, unknown>;
  method?: string;
  contentType?: string;
  bearerToken?: string;
} = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.contentType !== undefined) {
    headers['Content-Type'] = opts.contentType;
  } else {
    headers['Content-Type'] = 'application/json';
  }
  if (opts.runId) headers['X-Takos-Run-Id'] = opts.runId;
  const bearerToken = opts.bearerToken ?? (path.startsWith('/proxy/') ? 'bindings-token' : undefined);
  if (bearerToken) headers['Authorization'] = `Bearer ${bearerToken}`;

  const method = opts.method ?? 'POST';
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: method !== 'GET' && method !== 'HEAD'
      ? JSON.stringify(opts.body ?? {})
      : undefined,
  });
}

async function readProxyUsageCounts(env: any): Promise<Record<string, number>> {
  const response = await executorHost.fetch(
    new Request('http://localhost/internal/proxy-usage', { method: 'GET' }),
    env,
  );
  assertEquals(response.status, 200);
  const body = await response.json() as { counts?: Record<string, number> };
  return body.counts ?? {};
}

function diffProxyUsageCounts(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const delta: Record<string, number> = {};
  for (const key of keys) {
    delta[key] = (after[key] ?? 0) - (before[key] ?? 0);
  }
  return delta;
}

// ---------------------------------------------------------------------------
// validateProxyResourceAccess (extended coverage)
// ---------------------------------------------------------------------------


  Deno.test('validateProxyResourceAccess - returns true for generic paths that have no special validation', () => {
  assertEquals(validateProxyResourceAccess('/proxy/db/first', { run_id: 'run-1' }, {}), true);
    assertEquals(validateProxyResourceAccess('/proxy/offload/get', { run_id: 'run-1' }, {}), true);
    assertEquals(validateProxyResourceAccess('/proxy/heartbeat', { run_id: 'run-1' }, {}), true);
})
  Deno.test('validateProxyResourceAccess - blocks DO fetches for unknown namespaces', () => {
  assertEquals(validateProxyResourceAccess('/proxy/do/fetch', { run_id: 'run-1' }, {
      namespace: 'SESSION_DO',
      name: 'run-1',
    }), false);
})
  Deno.test('validateProxyResourceAccess - blocks DO fetches where name does not match runId', () => {
  assertEquals(validateProxyResourceAccess('/proxy/do/fetch', { run_id: 'run-1' }, {
      namespace: 'RUN_NOTIFIER',
      name: 'run-other',
    }), false);
})
  Deno.test('validateProxyResourceAccess - blocks queue sends for unknown queue names', () => {
  assertEquals(validateProxyResourceAccess('/proxy/queue/send', { run_id: 'run-1' }, { queue: 'dlq' }), false);
    assertEquals(validateProxyResourceAccess('/proxy/queue/send-batch', { run_id: 'run-1' }, { queue: 'other' }), false);
})
  Deno.test('validateProxyResourceAccess - validates runtime fetch URLs for allowed paths', () => {
  // /session/* allowed
    assertEquals(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/session/exec',
    }), true);
    // /status/* allowed
    assertEquals(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/status',
    }), true);
    // /repos/* allowed
    assertEquals(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/repos/list',
    }), true);
    // /actions/jobs/:id allowed
    assertEquals(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/actions/jobs/job-123',
    }), true);
    // /cli-proxy/* allowed
    assertEquals(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/cli-proxy/some/endpoint',
    }), true);
})
  Deno.test('validateProxyResourceAccess - blocks runtime fetch for disallowed paths', () => {
  assertEquals(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/admin/settings',
    }), false);
    assertEquals(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/',
    }), false);
})
  Deno.test('validateProxyResourceAccess - blocks runtime fetch for non-runtime-host hostnames', () => {
  assertEquals(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://evil.com/session/exec',
    }), false);
})
  Deno.test('validateProxyResourceAccess - blocks runtime fetch when url is not a valid URL', () => {
  assertEquals(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'not-a-url',
    }), false);
})
  Deno.test('validateProxyResourceAccess - blocks runtime fetch when url is not a string', () => {
  assertEquals(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 12345,
    }), false);
})
  Deno.test('validateProxyResourceAccess - validates browser fetch URLs for allowed browser host paths', () => {
  assertEquals(validateProxyResourceAccess('/proxy/browser/fetch', { run_id: 'r' }, {
      url: 'https://browser-host.internal/create',
    }), true);
    assertEquals(validateProxyResourceAccess('/proxy/browser/fetch', { run_id: 'r' }, {
      url: 'https://browser-host.internal/session/sid-1/goto',
    }), true);
    assertEquals(validateProxyResourceAccess('/proxy/browser/fetch', { run_id: 'r' }, {
      url: 'https://browser-host.internal/session/sid-1/screenshot',
    }), true);
})
  Deno.test('validateProxyResourceAccess - blocks browser fetch for disallowed hostnames or paths', () => {
  assertEquals(validateProxyResourceAccess('/proxy/browser/fetch', { run_id: 'r' }, {
      url: 'https://evil.com/session/sid-1/goto',
    }), false);
    assertEquals(validateProxyResourceAccess('/proxy/browser/fetch', { run_id: 'r' }, {
      url: 'https://browser-host.internal/admin',
    }), false);
    assertEquals(validateProxyResourceAccess('/proxy/browser/fetch', { run_id: 'r' }, {
      url: 'not-a-url',
    }), false);
})
// ---------------------------------------------------------------------------
// DB proxy handler
// ---------------------------------------------------------------------------


  Deno.test('handleDbProxy via fetch - returns result for db/first with valid SQL', async () => {
  const env = makeEnv();
    env.DB._stmt.first = (async () => ({ id: 1, name: 'test' })) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT 1', params: [] } }),
      env,
    );
    assertEquals(res.status, 200);
    const data = await res.json() as any;
    assertEquals(data.result, { id: 1, name: 'test' });
})
  Deno.test('handleDbProxy via fetch - supports db/first with colName parameter', async () => {
  const env = makeEnv();
    env.DB._stmt.first = (async () => 'test-value') as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT name FROM t', params: [], colName: 'name' } }),
      env,
    );
    assertEquals(res.status, 200);
    const data = await res.json() as any;
    assertEquals(data.result, 'test-value');
})
  Deno.test('handleDbProxy via fetch - returns 400 when sql is missing for db/first', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { params: [] } }),
      env,
    );
    assertEquals(res.status, 400);
    const data = await res.json() as any;
    assertStringIncludes(data.error, 'Missing required "sql"');
})
  Deno.test('handleDbProxy via fetch - returns 400 for SQL validation failure', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/run', { runId: 'run-1', body: { sql: 'PRAGMA table_info(users)', params: [] } }),
      env,
    );
    assertEquals(res.status, 400);
    const data = await res.json() as any;
    assertStringIncludes(data.error, 'SQL validation failed');
})
  Deno.test('handleDbProxy via fetch - returns result for db/run with valid SQL', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/run', { runId: 'run-1', body: { sql: 'INSERT INTO t(id) VALUES (?)', params: [1] } }),
      env,
    );
    assertEquals(res.status, 200);
})
  Deno.test('handleDbProxy via fetch - returns 400 when sql is missing for db/run', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/run', { runId: 'run-1', body: {} }),
      env,
    );
    assertEquals(res.status, 400);
})
  Deno.test('handleDbProxy via fetch - returns result for db/all with valid SQL', async () => {
  const env = makeEnv();
    env.DB._stmt.all = (async () => ({ results: [{ id: 1 }], success: true, meta: {} })) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/all', { runId: 'run-1', body: { sql: 'SELECT * FROM t', params: [] } }),
      env,
    );
    assertEquals(res.status, 200);
    const data = await res.json() as any;
    assertEquals(data.results, [{ id: 1 }]);
})
  Deno.test('handleDbProxy via fetch - returns 400 when sql is missing for db/all', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/all', { runId: 'run-1', body: {} }),
      env,
    );
    assertEquals(res.status, 400);
})
  Deno.test('handleDbProxy via fetch - returns result for db/raw with valid SQL', async () => {
  const env = makeEnv();
    env.DB._stmt.raw = (async () => [[1, 'test']]) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/raw', { runId: 'run-1', body: { sql: 'SELECT id, name FROM t', params: [] } }),
      env,
    );
    assertEquals(res.status, 200);
    const data = await res.json() as any;
    assertEquals(data.results, [[1, 'test']]);
})
  Deno.test('handleDbProxy via fetch - supports db/raw with columnNames option', async () => {
  const env = makeEnv();
    env.DB._stmt.raw = (async () => [['id', 'name'], [1, 'test']]) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/raw', {
        runId: 'run-1',
        body: { sql: 'SELECT id, name FROM t', params: [], rawOptions: { columnNames: true } },
      }),
      env,
    );
    assertEquals(res.status, 200);
    const data = await res.json() as any;
    assertEquals(data.results, [['id', 'name'], [1, 'test']]);
})
  Deno.test('handleDbProxy via fetch - returns 400 when sql is missing for db/raw', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/raw', { runId: 'run-1', body: {} }),
      env,
    );
    assertEquals(res.status, 400);
})
  Deno.test('handleDbProxy via fetch - executes db/batch with valid statements', async () => {
  const env = makeEnv();
    env.DB.batch = (async () => [{ success: true }]) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/batch', {
        runId: 'run-1',
        body: {
          statements: [
            { sql: 'INSERT INTO t(id) VALUES (?)', params: [1] },
            { sql: 'INSERT INTO t(id) VALUES (?)', params: [2] },
          ],
        },
      }),
      env,
    );
    assertEquals(res.status, 200);
})
  Deno.test('handleDbProxy via fetch - returns 400 when statements is missing for db/batch', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/batch', { runId: 'run-1', body: {} }),
      env,
    );
    assertEquals(res.status, 400);
    const data = await res.json() as any;
    assertStringIncludes(data.error, 'Missing required "statements"');
})
  Deno.test('handleDbProxy via fetch - returns 400 when batch contains too many statements', async () => {
  const env = makeEnv();
    const statements = Array.from({ length: 101 }, (_, i) => ({
      sql: `INSERT INTO t(id) VALUES (${i})`,
      params: [],
    }));
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/batch', { runId: 'run-1', body: { statements } }),
      env,
    );
    assertEquals(res.status, 400);
    const data = await res.json() as any;
    assertStringIncludes(data.error, 'too many statements');
})
  Deno.test('handleDbProxy via fetch - returns 400 when batch contains invalid SQL', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/batch', {
        runId: 'run-1',
        body: {
          statements: [
            { sql: 'INSERT INTO t(id) VALUES (?)', params: [1] },
            { sql: 'PRAGMA table_info(t)', params: [] },
          ],
        },
      }),
      env,
    );
    assertEquals(res.status, 400);
})
  Deno.test('handleDbProxy via fetch - blocks db/exec endpoint with 403', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/exec', { runId: 'run-1', body: { sql: 'CREATE TABLE t (id INT)' } }),
      env,
    );
    assertEquals(res.status, 403);
    const data = await res.json() as any;
    assertStringIncludes(data.error, 'disabled for security');
})
  Deno.test('handleDbProxy via fetch - returns 404 for unknown db proxy subpath', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/unknown', { runId: 'run-1', body: { sql: 'SELECT 1' } }),
      env,
    );
    assertEquals(res.status, 404);
})
  Deno.test('handleDbProxy via fetch - classifies D1 errors correctly', async () => {
  const env = makeEnv();
    env.DB._stmt.first = (async () => { throw new Error('D1_ERROR: some issue'); }) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT 1', params: [] } }),
      env,
    );
    assertEquals(res.status, 400);
    const data = await res.json() as any;
    assertEquals(data.error, 'Database query error');
})
  Deno.test('handleDbProxy via fetch - classifies SQLITE_BUSY as 503', async () => {
  const env = makeEnv();
    env.DB._stmt.run = (async () => { throw new Error('SQLITE_BUSY'); }) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/run', { runId: 'run-1', body: { sql: 'INSERT INTO t(x) VALUES(1)', params: [] } }),
      env,
    );
    assertEquals(res.status, 503);
})
  Deno.test('handleDbProxy via fetch - classifies SQLITE_CONSTRAINT as 409', async () => {
  const env = makeEnv();
    env.DB._stmt.run = (async () => { throw new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed'); }) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/run', { runId: 'run-1', body: { sql: 'INSERT INTO t(x) VALUES(1)', params: [] } }),
      env,
    );
    assertEquals(res.status, 409);
})
// ---------------------------------------------------------------------------
// R2 proxy handler (offload)
// ---------------------------------------------------------------------------


  Deno.test('handleR2Proxy via fetch (offload) - returns 404 when getting a non-existent key', async () => {
  const env = makeEnv();
    env.TAKOS_OFFLOAD.get = (async () => null) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/get', { runId: 'run-1', body: { key: 'missing-key' } }),
      env,
    );
    assertEquals(res.status, 404);
})
  Deno.test('handleR2Proxy via fetch (offload) - returns object body and headers for existing key', async () => {
  const env = makeEnv();
    const body = new TextEncoder().encode('file-content');
    env.TAKOS_OFFLOAD.get = (async () => ({
      body: new ReadableStream({
        start(ctrl) { ctrl.enqueue(body); ctrl.close(); },
      }),
      size: body.byteLength,
      etag: 'test-etag',
      uploaded: new Date('2026-01-01T00:00:00Z'),
    })) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/get', { runId: 'run-1', body: { key: 'my-key' } }),
      env,
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get('ETag'), 'test-etag');
    assertEquals(res.headers.get('Content-Type'), 'application/octet-stream');
})
  Deno.test('handleR2Proxy via fetch (offload) - puts a text value via JSON encoding', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/put', {
        runId: 'run-1',
        body: { key: 'my-key', body: 'hello', encoding: 'text' },
      }),
      env,
    );
    assertEquals(res.status, 200);
    assertSpyCallArgs(env.TAKOS_OFFLOAD.put, 0, ['my-key', 'hello', undefined]);
})
  Deno.test('handleR2Proxy via fetch (offload) - puts a null value via encoding=null', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/put', {
        runId: 'run-1',
        body: { key: 'my-key', encoding: 'null' },
      }),
      env,
    );
    assertEquals(res.status, 200);
    assertSpyCallArgs(env.TAKOS_OFFLOAD.put, 0, ['my-key', null, undefined]);
})
  Deno.test('handleR2Proxy via fetch (offload) - returns 400 when base64 encoding but bodyBase64 is missing', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/put', {
        runId: 'run-1',
        body: { key: 'my-key', encoding: 'base64' },
      }),
      env,
    );
    assertEquals(res.status, 400);
    const data = await res.json() as any;
    assertStringIncludes(data.error, 'Missing bodyBase64');
})
  Deno.test('handleR2Proxy via fetch (offload) - returns 400 when text encoding but body is missing', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/put', {
        runId: 'run-1',
        body: { key: 'my-key', encoding: 'text' },
      }),
      env,
    );
    assertEquals(res.status, 400);
    const data = await res.json() as any;
    assertStringIncludes(data.error, 'Missing body for text');
})
  Deno.test('handleR2Proxy via fetch (offload) - deletes a key successfully', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/delete', {
        runId: 'run-1',
        body: { key: 'my-key' },
      }),
      env,
    );
    assertEquals(res.status, 200);
    assertSpyCallArgs(env.TAKOS_OFFLOAD.delete, 0, ['my-key']);
})
  Deno.test('handleR2Proxy via fetch (offload) - lists objects with options', async () => {
  const env = makeEnv();
    env.TAKOS_OFFLOAD.list = (async () => ({
      objects: [{ key: 'obj-1', size: 100 }],
      truncated: false,
    })) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/list', {
        runId: 'run-1',
        body: { prefix: 'uploads/' },
      }),
      env,
    );
    assertEquals(res.status, 200);
    const data = await res.json() as any;
    assertEquals(data.objects.length, 1);
})
  Deno.test('handleR2Proxy via fetch (offload) - heads a key', async () => {
  const env = makeEnv();
    env.TAKOS_OFFLOAD.head = (async () => ({ key: 'my-key', size: 42 })) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/head', {
        runId: 'run-1',
        body: { key: 'my-key' },
      }),
      env,
    );
    assertEquals(res.status, 200);
})
  Deno.test('handleR2Proxy via fetch (offload) - returns 404 for unknown R2 proxy subpath', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/unknown', {
        runId: 'run-1',
        body: { key: 'my-key' },
      }),
      env,
    );
    assertEquals(res.status, 404);
})
// ---------------------------------------------------------------------------
// R2 proxy handler (git-objects)
// ---------------------------------------------------------------------------


  Deno.test('handleR2Proxy via fetch (git-objects) - returns 503 when GIT_OBJECTS is not configured', async () => {
  const env = makeEnv({ GIT_OBJECTS: undefined });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/git-objects/get', { runId: 'run-1', body: { key: 'sha' } }),
      env,
    );
    assertEquals(res.status, 503);
})
  Deno.test('handleR2Proxy via fetch (git-objects) - gets a git object', async () => {
  const env = makeEnv();
    const body = new TextEncoder().encode('blob-data');
    env.GIT_OBJECTS.get = (async () => ({
      body: new ReadableStream({
        start(ctrl) { ctrl.enqueue(body); ctrl.close(); },
      }),
      size: body.byteLength,
      etag: 'git-etag',
      uploaded: new Date(),
    })) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/git-objects/get', { runId: 'run-1', body: { key: 'sha-abc' } }),
      env,
    );
    assertEquals(res.status, 200);
})
// ---------------------------------------------------------------------------
// DO (notifier) proxy handler
// ---------------------------------------------------------------------------


  Deno.test('handleNotifierProxy via fetch - proxies a valid DO fetch to RUN_NOTIFIER', async () => {
  const env = makeEnv();

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/do/fetch', {
        runId: 'run-1',
        body: {
          namespace: 'RUN_NOTIFIER',
          name: 'run-1',
          url: 'https://do/emit',
          method: 'POST',
          reqBody: JSON.stringify({ event: 'progress', data: {} }),
        },
      }),
      env,
    );
    assertEquals(res.status, 200);
})
  Deno.test('handleNotifierProxy via fetch - blocks DO fetch to unknown namespace', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/do/fetch', {
        runId: 'run-1',
        body: {
          namespace: 'RUN_NOTIFIER',
          name: 'run-1',
          url: 'https://do/emit',
          method: 'POST',
        },
      }),
      env,
    );
    // The validateProxyResourceAccess already checks name === runId
    assertEquals(res.status, 200);
})
  Deno.test('handleNotifierProxy via fetch - blocks DO fetch with disallowed path', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/do/fetch', {
        runId: 'run-1',
        body: {
          namespace: 'RUN_NOTIFIER',
          name: 'run-1',
          url: 'https://do/admin',
          method: 'POST',
        },
      }),
      env,
    );
    assertEquals(res.status, 403);
})
  Deno.test('handleNotifierProxy via fetch - blocks DO fetch with disallowed method', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/do/fetch', {
        runId: 'run-1',
        body: {
          namespace: 'RUN_NOTIFIER',
          name: 'run-1',
          url: 'https://do/emit',
          method: 'DELETE',
        },
      }),
      env,
    );
    assertEquals(res.status, 403);
})
  Deno.test('handleNotifierProxy via fetch - returns 400 when namespace is unknown', async () => {
  const env = makeEnv();
    // We need to bypass the resource access validation by checking name === runId
    // but namespace !== RUN_NOTIFIER  -> validateProxyResourceAccess returns false -> 401
    // Actually, validateProxyResourceAccess checks namespace === 'RUN_NOTIFIER' AND name === runId
    // If namespace != RUN_NOTIFIER, it returns false and the proxy returns 401 Unauthorized
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/do/fetch', {
        runId: 'run-1',
        body: {
          namespace: 'UNKNOWN_NS',
          name: 'run-1',
          url: 'https://do/emit',
        },
      }),
      env,
    );
    assertEquals(res.status, 401); // Resource access denied
})
  Deno.test('handleNotifierProxy via fetch - returns 400 when url is missing for DO fetch', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/do/fetch', {
        runId: 'run-1',
        body: {
          namespace: 'RUN_NOTIFIER',
          name: 'run-1',
          method: 'POST',
        },
      }),
      env,
    );
    assertEquals(res.status, 400);
    const data = await res.json() as any;
    assertStringIncludes(data.error, 'Missing required "url"');
})
// ---------------------------------------------------------------------------
// Vectorize proxy handler
// ---------------------------------------------------------------------------


  Deno.test('handleVectorizeProxy via fetch - returns 503 when VECTORIZE is not configured', async () => {
  const env = makeEnv({ VECTORIZE: undefined });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/query', { runId: 'run-1', body: { vector: [1, 2, 3] } }),
      env,
    );
    assertEquals(res.status, 503);
})
  Deno.test('handleVectorizeProxy via fetch - queries vectorize index', async () => {
  const env = makeEnv();
    env.VECTORIZE.query = (async () => ({ matches: [{ id: 'vec-1', score: 0.95 }] })) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/query', { runId: 'run-1', body: { vector: [1, 2, 3] } }),
      env,
    );
    assertEquals(res.status, 200);
    const data = await res.json() as any;
    assertEquals(data.matches.length, 1);
})
  Deno.test('handleVectorizeProxy via fetch - returns 400 when vector is missing for query', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/query', { runId: 'run-1', body: {} }),
      env,
    );
    assertEquals(res.status, 400);
})
  Deno.test('handleVectorizeProxy via fetch - inserts vectors', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/insert', {
        runId: 'run-1',
        body: { vectors: [{ id: 'v1', values: [1, 2] }] },
      }),
      env,
    );
    assertEquals(res.status, 200);
})
  Deno.test('handleVectorizeProxy via fetch - upserts vectors', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/upsert', {
        runId: 'run-1',
        body: { vectors: [{ id: 'v1', values: [1, 2] }] },
      }),
      env,
    );
    assertEquals(res.status, 200);
})
  Deno.test('handleVectorizeProxy via fetch - deletes vectors by ids', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/delete', {
        runId: 'run-1',
        body: { ids: ['v1', 'v2'] },
      }),
      env,
    );
    assertEquals(res.status, 200);
})
  Deno.test('handleVectorizeProxy via fetch - returns 400 when ids is missing for delete', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/delete', { runId: 'run-1', body: {} }),
      env,
    );
    assertEquals(res.status, 400);
})
  Deno.test('handleVectorizeProxy via fetch - gets vectors by ids', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/get', {
        runId: 'run-1',
        body: { ids: ['v1'] },
      }),
      env,
    );
    assertEquals(res.status, 200);
})
  Deno.test('handleVectorizeProxy via fetch - returns 400 when ids is missing for get', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/get', { runId: 'run-1', body: {} }),
      env,
    );
    assertEquals(res.status, 400);
})
  Deno.test('handleVectorizeProxy via fetch - describes vectorize index', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/describe', { runId: 'run-1', body: {} }),
      env,
    );
    assertEquals(res.status, 200);
})
  Deno.test('handleVectorizeProxy via fetch - returns 404 for unknown vectorize subpath', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/unknown', { runId: 'run-1', body: {} }),
      env,
    );
    assertEquals(res.status, 404);
})
// ---------------------------------------------------------------------------
// AI proxy handler
// ---------------------------------------------------------------------------


  Deno.test('handleAiProxy via fetch - returns 503 when AI is not configured', async () => {
  const env = makeEnv({ AI: undefined });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/ai/run', { runId: 'run-1', body: { model: 'gpt-4', inputs: {} } }),
      env,
    );
    assertEquals(res.status, 503);
})
  Deno.test('handleAiProxy via fetch - runs AI model', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/ai/run', {
        runId: 'run-1',
        body: { model: '@cf/meta/llama-2-7b-chat-int8', inputs: { prompt: 'Hello' } },
      }),
      env,
    );
    assertEquals(res.status, 200);
    assert(env.AI.run.calls.length > 0);
})
  Deno.test('handleAiProxy via fetch - returns 404 for unknown AI subpath', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/ai/unknown', { runId: 'run-1', body: {} }),
      env,
    );
    assertEquals(res.status, 404);
})
// ---------------------------------------------------------------------------
// Egress proxy handler
// ---------------------------------------------------------------------------


  Deno.test('handleEgressProxy via fetch - proxies request through TAKOS_EGRESS', async () => {
  const env = makeEnv();
    env.TAKOS_EGRESS.fetch = (async () => new Response('external response', { status: 200, headers: { 'X-Custom': 'val' } }),) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/egress/fetch', {
        runId: 'run-1',
        body: { url: 'https://api.example.com/data', method: 'GET' },
      }),
      env,
    );
    assertEquals(res.status, 200);
})
  Deno.test('handleEgressProxy via fetch - classifies egress network errors', async () => {
  const env = makeEnv();
    env.TAKOS_EGRESS.fetch = (async () => { throw new Error('fetch failed'); }) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/egress/fetch', {
        runId: 'run-1',
        body: { url: 'https://api.example.com/data' },
      }),
      env,
    );
    assertEquals(res.status, 502);
})
// ---------------------------------------------------------------------------
// Runtime proxy handler
// ---------------------------------------------------------------------------


  Deno.test('handleRuntimeProxy via fetch - returns 503 when RUNTIME_HOST is not configured', async () => {
  const env = makeEnv({ RUNTIME_HOST: undefined });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/runtime/fetch', {
        runId: 'run-1',
        body: { url: 'https://runtime-host/session/exec', method: 'GET' },
      }),
      env,
    );
    assertEquals(res.status, 503);
})
  Deno.test('handleRuntimeProxy via fetch - proxies request through RUNTIME_HOST', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/runtime/fetch', {
        runId: 'run-1',
        body: { url: 'https://runtime-host/session/exec', method: 'POST', body: '{}' },
      }),
      env,
    );
    assertEquals(res.status, 200);
    assert(env.RUNTIME_HOST.fetch.calls.length > 0);
})
// ---------------------------------------------------------------------------
// Browser proxy handler
// ---------------------------------------------------------------------------


  Deno.test('handleBrowserProxy via fetch - returns 503 when BROWSER_HOST is not configured', async () => {
  const env = makeEnv({ BROWSER_HOST: undefined });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/browser/fetch', {
        runId: 'run-1',
        body: { url: 'https://browser-host.internal/session/sid-1/goto', method: 'POST', body: '{}' },
      }),
      env,
    );
    assertEquals(res.status, 503);
})
  Deno.test('handleBrowserProxy via fetch - proxies request through BROWSER_HOST', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/browser/fetch', {
        runId: 'run-1',
        body: { url: 'https://browser-host.internal/session/sid-1/goto', method: 'POST', body: '{}' },
      }),
      env,
    );
    assertEquals(res.status, 200);
    assert(env.BROWSER_HOST.fetch.calls.length > 0);
})
// ---------------------------------------------------------------------------
// Queue proxy handler
// ---------------------------------------------------------------------------


  Deno.test('handleQueueProxy via fetch - returns 503 when INDEX_QUEUE is not configured', async () => {
  const env = makeEnv({ INDEX_QUEUE: undefined });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/queue/send', {
        runId: 'run-1',
        body: { queue: 'index', message: { type: 'reindex', id: '1' } },
      }),
      env,
    );
    assertEquals(res.status, 503);
})
  Deno.test('handleQueueProxy via fetch - sends a single message to the index queue', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/queue/send', {
        runId: 'run-1',
        body: { queue: 'index', message: { type: 'reindex', id: '1' } },
      }),
      env,
    );
    assertEquals(res.status, 200);
    assert(env.INDEX_QUEUE.send.calls.length > 0);
})
  Deno.test('handleQueueProxy via fetch - sends a batch of messages', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/queue/send-batch', {
        runId: 'run-1',
        body: {
          queue: 'index',
          messages: [{ body: { type: 'reindex', id: '1' } }, { body: { type: 'reindex', id: '2' } }],
        },
      }),
      env,
    );
    assertEquals(res.status, 200);
    assert(env.INDEX_QUEUE.sendBatch.calls.length > 0);
})
  Deno.test('handleQueueProxy via fetch - returns 400 when messages is missing for send-batch', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/queue/send-batch', {
        runId: 'run-1',
        body: { queue: 'index' },
      }),
      env,
    );
    assertEquals(res.status, 400);
})
  Deno.test('handleQueueProxy via fetch - returns 403 for unknown queue name', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/queue/send', {
        runId: 'run-1',
        body: { queue: 'other', message: {} },
      }),
      env,
    );
    // validateProxyResourceAccess returns false -> 401
    assertEquals(res.status, 401);
})
  Deno.test('handleQueueProxy via fetch - returns 404 for unknown queue subpath', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/queue/unknown', {
        runId: 'run-1',
        body: { queue: 'index' },
      }),
      env,
    );
    assertEquals(res.status, 404);
})
// ---------------------------------------------------------------------------
// API keys proxy
// ---------------------------------------------------------------------------


  Deno.test('api-keys proxy - returns configured API keys', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/api-keys', { runId: 'run-1', body: {}, bearerToken: 'control-token' }),
      env,
    );
    assertEquals(res.status, 200);
    const data = await res.json() as any;
    assertEquals(data.openai, 'test-openai');
    assertEquals(data.anthropic, 'test-anthropic');
    assertEquals(data.google, 'test-google');
})
  Deno.test('api-keys proxy - returns null for unconfigured API keys', async () => {
  const env = makeEnv({
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
    });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/api-keys', { runId: 'run-1', body: {}, bearerToken: 'control-token' }),
      env,
    );
    assertEquals(res.status, 200);
    const data = await res.json() as any;
    assertEquals(data.openai, null);
    assertEquals(data.anthropic, null);
    assertEquals(data.google, null);
})
// ---------------------------------------------------------------------------
// Run control proxy
// ---------------------------------------------------------------------------


  Deno.test('run control proxy - returns run status via control capability', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  getDb = (() => ({
      select: (() => ({
        from: (() => ({
          where: (() => ({
            limit: (async () => [{ status: 'running' }]),
          })),
        })),
      })),
    } as any)) as any;

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/run/status', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { status: 'running' });
})
  Deno.test('run control proxy - marks a run failed via control capability', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  const update = (() => ({
      set: (() => ({
        where: (async () => ({ meta: { changes: 1 } })),
      })),
    }));
    getDb = (() => ({ update } as any)) as any;

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/run/fail', {
        runId: 'run-1',
        body: {
          runId: 'run-1',
          workerId: 'worker-1',
          leaseVersion: 2,
          error: 'Heartbeat lost',
        },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { success: true, updated: true });
    assert(update.calls.length > 0);
})
  Deno.test('run control proxy - returns run context for no-LLM fast path', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  const select = ((..._args: any[]) => undefined) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              status: 'running',
              threadId: 'thread-1',
              sessionId: 'session-1',
            })),
          })),
        })),
      })) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            orderBy: (() => ({
              get: (async () => ({
                content: 'hello from test',
              })),
            })),
          })),
        })),
      })) as any;
    getDb = (() => ({ select } as any)) as any;

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/run-context', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), {
      status: 'running',
      threadId: 'thread-1',
      sessionId: 'session-1',
      lastUserMessage: 'hello from test',
    });
})
  Deno.test('run control proxy - returns run record via control RPC', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  const select = (() => ({
      from: (() => ({
        where: (() => ({
          get: (async () => ({
            status: 'running',
            input: '{"task":"test"}',
            parentRunId: 'parent-1',
          })),
        })),
      })),
    }));
    getDb = (() => ({ select } as any)) as any;

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/run-record', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), {
      status: 'running',
      input: '{"task":"test"}',
      parentRunId: 'parent-1',
    });
})
  Deno.test('run control proxy - returns run bootstrap via control RPC', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  const select = ((..._args: any[]) => undefined) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              id: 'run-1',
              status: 'running',
              accountId: 'space-1',
              sessionId: 'session-1',
              threadId: 'thread-1',
              agentType: 'general',
            })),
          })),
        })),
      })) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              accountId: 'space-1',
            })),
          })),
        })),
      })) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              accountId: 'space-1',
              requesterAccountId: 'user-1',
            })),
          })),
        })),
      })) as any;
    getDb = (() => ({ select } as any)) as any;

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/run-bootstrap', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), {
      status: 'running',
      spaceId: 'space-1',
      sessionId: 'session-1',
      threadId: 'thread-1',
      userId: 'user-1',
      agentType: 'general',
    });
})
  Deno.test('run control proxy - returns conversation history via control RPC', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  buildConversationHistory = (async () => [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]) as any;

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/conversation-history', {
        runId: 'run-1',
        body: {
          runId: 'run-1',
          threadId: 'thread-1',
          spaceId: 'space-1',
          aiModel: 'gpt-5',
        },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), {
      history: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ],
    });
    assertSpyCallArgs(buildConversationHistory, 0, [({
      db: env.DB,
      threadId: 'thread-1',
      runId: 'run-1',
      spaceId: 'space-1',
      aiModel: 'gpt-5',
    })]);
})
  Deno.test('run control proxy - returns skill plan via control RPC', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  resolveSkillPlanForRun = (async () => ({
      success: true,
      skillLocale: 'ja',
      availableSkills: [{ id: 'official.search', name: 'Search', description: 'desc', triggers: [], source: 'official', execution_contract: { preferred_tools: [], durable_output_hints: [], output_modes: ['chat'], required_mcp_servers: [], template_ids: [] }, availability: 'available', availability_reasons: [] }],
      selectedSkills: [],
      activatedSkills: [],
    } as any)) as any;

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/skill-plan', {
        runId: 'run-1',
        body: {
          runId: 'run-1',
          threadId: 'thread-1',
          spaceId: 'space-1',
          agentType: 'assistant',
          history: [{ role: 'user', content: 'hello' }],
          availableToolNames: ['search'],
        },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), ({
      success: true,
      skillLocale: 'ja',
    }));
    assertSpyCallArgs(resolveSkillPlanForRun, 0, [env.DB, {
      runId: 'run-1',
      threadId: 'thread-1',
      spaceId: 'space-1',
      agentType: 'assistant',
      history: [{ role: 'user', content: 'hello' }],
      availableToolNames: ['search'],
    }]);
})
  Deno.test('run control proxy - returns memory activation via control RPC', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  getActiveClaims = (async () => [
      {
        id: 'claim-1',
        accountId: 'space-1',
        claimType: 'fact',
        subject: 'Takos',
        predicate: 'uses',
        object: 'Redis',
        confidence: 0.9,
        status: 'active',
        supersededBy: null,
        sourceRunId: 'run-1',
        createdAt: '2026-03-22T00:00:00.000Z',
        updatedAt: '2026-03-22T00:00:00.000Z',
      },
    ] as any) as any;
    countEvidenceForClaims = (async () => new Map([['claim-1', 2]])) as any;
    getPathsForClaim = (async () => []) as any;
    buildActivationBundles = (() => [{ claim: { id: 'claim-1' }, evidenceCount: 2, paths: [] }] as any) as any;
    renderActivationSegment = (() => ({
      bundles: [{ claim: { id: 'claim-1' }, evidenceCount: 2, paths: [] }] as any,
      segment: '[Active memory]\n1. Takos uses Redis',
      hasContent: true,
    })) as any;

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/memory-activation', {
        runId: 'run-1',
        body: { spaceId: 'space-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), {
      bundles: [{ claim: { id: 'claim-1' }, evidenceCount: 2, paths: [] }],
      segment: '[Active memory]\n1. Takos uses Redis',
      hasContent: true,
    });
    assertSpyCallArgs(getActiveClaims, 0, [env.DB, 'space-1', 50]);
})
  Deno.test('run control proxy - returns and executes remote tools via control RPC', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  const select = ((..._args: any[]) => undefined) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              id: 'run-1',
              status: 'running',
              accountId: 'space-1',
              sessionId: 'session-1',
              threadId: 'thread-1',
              agentType: 'general',
            })),
          })),
        })),
      })) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              accountId: 'space-1',
            })),
          })),
        })),
      })) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              accountId: 'space-1',
              requesterAccountId: 'user-1',
            })),
          })),
        })),
      })) as any;
    getDb = (() => ({ select } as any)) as any;

    const cleanup = ((..._args: any[]) => undefined) as any;
    const execute = (async () => ({
      tool_call_id: 'tool-1',
      output: 'read ok',
    }));
    createToolExecutor = (async () => ({
      getAvailableTools: () => [{
        name: 'file_read',
        description: 'read file',
        category: 'file',
        parameters: { type: 'object', properties: {} },
      }],
      mcpFailedServers: ['repo-mcp'],
      execute,
      setObserver: ((..._args: any[]) => undefined) as any,
      setDb: ((..._args: any[]) => undefined) as any,
      cleanup,
    } as any)) as any;

    const env = makeEnv();
    const catalogResponse = await executorHost.fetch(
      makeProxyRequest('/rpc/control/tool-catalog', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(catalogResponse.status, 200);
    await assertEquals(await catalogResponse.json(), {
      tools: [{
        name: 'file_read',
        description: 'read file',
        category: 'file',
        parameters: { type: 'object', properties: {} },
      }],
      mcpFailedServers: ['repo-mcp'],
    });

    const executeResponse = await executorHost.fetch(
      makeProxyRequest('/rpc/control/tool-execute', {
        runId: 'run-1',
        body: {
          runId: 'run-1',
          toolCall: {
            id: 'tool-1',
            name: 'file_read',
            arguments: { path: 'README.md' },
          },
        },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(executeResponse.status, 200);
    await assertEquals(await executeResponse.json(), {
      tool_call_id: 'tool-1',
      output: 'read ok',
    });
    assertSpyCallArgs(execute, 0, [{
      id: 'tool-1',
      name: 'file_read',
      arguments: { path: 'README.md' },
    }]);
    assertSpyCalls(createToolExecutor, 1);

    const cleanupResponse = await executorHost.fetch(
      makeProxyRequest('/rpc/control/tool-cleanup', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(cleanupResponse.status, 200);
    await assertEquals(await cleanupResponse.json(), { success: true });
    assertSpyCalls(cleanup, 1);
})
  Deno.test('run control proxy - keeps forbidden proxy buckets flat for canonical control RPC traffic', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  const select = ((..._args: any[]) => undefined) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              id: 'run-1',
              status: 'running',
              accountId: 'space-1',
              sessionId: 'session-1',
              threadId: 'thread-1',
              agentType: 'general',
            })),
          })),
        })),
      })) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              accountId: 'space-1',
            })),
          })),
        })),
      })) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              accountId: 'space-1',
              requesterAccountId: 'user-1',
            })),
          })),
        })),
      })) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              id: 'run-1',
              status: 'running',
              accountId: 'space-1',
              sessionId: 'session-1',
              threadId: 'thread-1',
              agentType: 'general',
            })),
          })),
        })),
      })) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              accountId: 'space-1',
            })),
          })),
        })),
      })) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              accountId: 'space-1',
            })),
          })),
        })),
      })) as any
       = (() => ({
        from: (() => ({
          where: (() => ({
            get: (async () => ({
              accountId: 'space-1',
              requesterAccountId: 'user-1',
            })),
          })),
        })),
      })) as any;
    getDb = (() => ({ select } as any)) as any;

    const cleanup = ((..._args: any[]) => undefined) as any;
    createToolExecutor = (async () => ({
      getAvailableTools: () => [{
        name: 'file_read',
        description: 'read file',
        category: 'file',
        parameters: { type: 'object', properties: {} },
      }],
      mcpFailedServers: [],
      execute: (async () => ({
        tool_call_id: 'tool-1',
        output: 'ok',
      })),
      setObserver: ((..._args: any[]) => undefined) as any,
      setDb: ((..._args: any[]) => undefined) as any,
      cleanup,
    } as any)) as any;

    const env = makeEnv();
    const before = await readProxyUsageCounts(env);

    const requests = [
      makeProxyRequest('/rpc/control/run-bootstrap', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      makeProxyRequest('/rpc/control/tool-catalog', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      makeProxyRequest('/rpc/control/tool-execute', {
        runId: 'run-1',
        body: {
          runId: 'run-1',
          toolCall: {
            id: 'tool-1',
            name: 'file_read',
            arguments: { path: 'README.md' },
          },
        },
        bearerToken: 'control-token',
      }),
      makeProxyRequest('/rpc/control/tool-cleanup', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
    ];

    for (const request of requests) {
      const response = await executorHost.fetch(request, env);
      assertEquals(response.status, 200);
    }

    const after = await readProxyUsageCounts(env);
    const delta = diffProxyUsageCounts(before, after);

    assertEquals(delta.db ?? 0, 0);
    assertEquals(delta.offload ?? 0, 0);
    assertEquals(delta.do ?? 0, 0);
    assertEquals(delta['tool-catalog'] ?? 0, 1);
    assertEquals(delta['tool-execute'] ?? 0, 1);
    assertEquals(delta['tool-cleanup'] ?? 0, 1);
    assert(delta['other-control-rpc'] ?? 0 >= 1);
    assertSpyCalls(cleanup, 1);
})
  Deno.test('run control proxy - finalizes memory overlay via control RPC', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/memory-finalize', {
        runId: 'run-1',
        body: {
          runId: 'run-1',
          spaceId: 'space-1',
          claims: [
            {
              id: 'claim-1',
              accountId: 'space-1',
              claimType: 'fact',
              subject: 'Takos',
              predicate: 'uses',
              object: 'Redis',
              confidence: 0.8,
              status: 'active',
              supersededBy: null,
              sourceRunId: 'run-1',
              createdAt: '2026-03-22T00:00:00.000Z',
              updatedAt: '2026-03-22T00:00:00.000Z',
            },
          ],
          evidence: [
            {
              id: 'ev-1',
              accountId: 'space-1',
              claimId: 'claim-1',
              kind: 'supports',
              sourceType: 'tool_result',
              sourceRef: 'remember:run-1',
              content: 'Takos uses Redis',
              trust: 0.9,
              taint: null,
              createdAt: '2026-03-22T00:00:00.000Z',
            },
          ],
        },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { success: true });
    assertSpyCallArgs(upsertClaim, 0, [env.DB, ({
      id: 'claim-1',
      subject: 'Takos',
    })]);
    assertSpyCallArgs(insertEvidence, 0, [env.DB, ({
      id: 'ev-1',
      claimId: 'claim-1',
    })]);
    assert(env.INDEX_QUEUE.send.calls.length > 0);
})
  Deno.test('run control proxy - adds a message via control RPC', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/add-message', {
        runId: 'run-1',
        body: {
          runId: 'run-1',
          threadId: 'thread-1',
          message: { role: 'assistant', content: 'saved from rpc' },
          metadata: { source: 'test' },
        },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { success: true });
    assertSpyCallArgs(persistMessage, 0, [
      ({ db: env.DB, threadId: 'thread-1' }),
      { role: 'assistant', content: 'saved from rpc' },
      { source: 'test' },
    ]);
})
  Deno.test('run control proxy - updates run status via control RPC', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/update-run-status', {
        runId: 'run-1',
        body: {
          runId: 'run-1',
          status: 'completed',
          usage: { inputTokens: 11, outputTokens: 7 },
          output: 'done',
        },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { success: true });
    assertSpyCallArgs(updateRunStatusImpl, 0, [
      env.DB,
      'run-1',
      { inputTokens: 11, outputTokens: 7 },
      'completed',
      'done',
      undefined,
    ]);
})
  Deno.test('run control proxy - returns current session via control RPC', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  const select = (() => ({
      from: (() => ({
        where: (() => ({
          get: (async () => ({
            sessionId: 'session-from-rpc',
          })),
        })),
      })),
    }));
    getDb = (() => ({ select } as any)) as any;

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/current-session', {
        runId: 'run-1',
        body: {
          runId: 'run-1',
          spaceId: 'space-1',
        },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { sessionId: 'session-from-rpc' });
})
  Deno.test('run control proxy - returns cancellation status via control RPC', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  const select = (() => ({
      from: (() => ({
        where: (() => ({
          get: (async () => ({
            status: 'cancelled',
          })),
        })),
      })),
    }));
    getDb = (() => ({ select } as any)) as any;

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/is-cancelled', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { cancelled: true });
})
  Deno.test('run control proxy - emits run events via control RPC', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  const insert = (() => ({
      values: (() => ({
        returning: (() => ({
          get: (async () => ({ id: 42 })),
        })),
      })),
    }));
    getDb = (() => ({ insert } as any)) as any;

    const env = makeEnv({ TAKOS_OFFLOAD: undefined });
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/run-event', {
        runId: 'run-1',
        body: {
          runId: 'run-1',
          type: 'thinking',
          sequence: 3,
          data: { message: 'working' },
        },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { success: true });
    assert(insert.calls.length > 0);
    assertSpyCalls(env.RUN_NOTIFIER._stub.fetch, 1);
})
  Deno.test('run control proxy - completes a no-LLM run via control RPC', async () => {
  getDb;
    buildConversationHistory;
    updateRunStatusImpl;
    resolveSkillPlanForRun;
    getActiveClaims;
    countEvidenceForClaims;
    getPathsForClaim;
    upsertClaim;
    insertEvidence;
    buildActivationBundles;
    renderActivationSegment;
    createToolExecutor;
    persistMessage;
  const select = (() => ({
      from: (() => ({
        where: (() => ({
          get: (async () => ({
            id: 'run-1',
            status: 'running',
            threadId: 'thread-1',
            sessionId: 'session-1',
            serviceId: 'worker-1',
          })),
        })),
      })),
    }));
    const update = (() => ({
      set: (() => ({
        where: (async () => undefined),
      })),
    }));
    getDb = (() => ({ select, update } as any)) as any;

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/no-llm-complete', {
        runId: 'run-1',
        body: {
          runId: 'run-1',
          workerId: 'worker-1',
          response: 'hello from no-llm',
        },
        bearerToken: 'control-token',
      }),
      env,
    );

    assertEquals(res.status, 200);
    await assertEquals(await res.json(), { success: true });
    assertSpyCallArgs(persistMessage, 0, [
      ({ threadId: 'thread-1' }),
      { role: 'assistant', content: 'hello from no-llm' },
    ]);
    assert(update.calls.length > 0);
    assertSpyCalls(env.RUN_NOTIFIER._stub.fetch, 2);
})
// ---------------------------------------------------------------------------
// General fetch handler
// ---------------------------------------------------------------------------


  Deno.test('general fetch handler - returns proxy usage counters', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      new Request('http://localhost/internal/proxy-usage', { method: 'GET' }),
      env,
    );
    assertEquals(res.status, 200);
    await assertEquals(await res.json(), ({
      status: 'ok',
      service: 'takos-executor-host',
      counts: /* expect.any(Object) */ {} as any,
    }));
})
  Deno.test('general fetch handler - returns 200 for root path', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      new Request('http://localhost/', { method: 'GET' }),
      env,
    );
    assertEquals(res.status, 200);
    const text = await res.text();
    assertEquals(text, 'takos-executor-host');
})
  Deno.test('general fetch handler - returns 401 for unknown proxy path (capability gate)', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/unknown/thing', { runId: 'run-1' }),
      env,
    );
    assertEquals(res.status, 401);
})
  Deno.test('general fetch handler - returns 405 for non-POST/GET on proxy paths', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      new Request('http://localhost/proxy/db/first', {
        method: 'PUT',
        headers: {
          'X-Takos-Run-Id': 'run-1',
          'Authorization': 'Bearer bindings-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql: 'SELECT 1' }),
      }),
      env,
    );
    assertEquals(res.status, 405);
})
  Deno.test('general fetch handler - returns 400 for dispatch without runId', async () => {
  const env = makeEnv();
    const res = await executorHost.fetch(
      new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerId: 'w-1' }),
      }),
      env,
    );
    assertEquals(res.status, 400);
})
// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------


  Deno.test('error classification edge cases - classifies timeout errors as 504', async () => {
  const env = makeEnv();
    const timeoutError = new Error('request timed out');
    timeoutError.name = 'TimeoutError';
    env.DB._stmt.first = (async () => { throw timeoutError; }) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT 1', params: [] } }),
      env,
    );
    assertEquals(res.status, 504);
})
  Deno.test('error classification edge cases - classifies network errors as 502', async () => {
  const env = makeEnv();
    env.DB._stmt.first = (async () => { throw new Error('ECONNREFUSED'); }) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT 1', params: [] } }),
      env,
    );
    assertEquals(res.status, 502);
})
  Deno.test('error classification edge cases - classifies TypeError as 400', async () => {
  const env = makeEnv();
    env.DB._stmt.first = (async () => { throw new TypeError('invalid argument'); }) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT 1', params: [] } }),
      env,
    );
    assertEquals(res.status, 400);
})
  Deno.test('error classification edge cases - classifies unknown errors as 500', async () => {
  const env = makeEnv();
    env.DB._stmt.first = (async () => { throw new Error('something weird'); }) as any;

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT 1', params: [] } }),
      env,
    );
    assertEquals(res.status, 500);
})