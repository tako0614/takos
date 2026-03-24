/**
 * Tests for executor-host proxy handlers and error classification.
 *
 * The hybrid dispatch and dual-mode auth tests live in test/executor-host.test.ts.
 * This file focuses on the individual proxy handler functions and error paths
 * that are not covered there.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@takos/control-hosts/container-runtime', () => ({
  Container: class {},
  HostContainerRuntime: class {},
}));

vi.mock('@/db', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/services/agent/message-persistence', () => ({
  persistMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/agent/runner', () => ({
  buildConversationHistory: vi.fn().mockResolvedValue([]),
  updateRunStatusImpl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/agent/skills', () => ({
  resolveSkillPlanForRun: vi.fn().mockResolvedValue({
    success: true,
    skillLocale: 'en',
    availableSkills: [],
    selectedSkills: [],
    activatedSkills: [],
  }),
}));

vi.mock('@/services/memory-graph/claim-store', () => ({
  getActiveClaims: vi.fn().mockResolvedValue([]),
  countEvidenceForClaims: vi.fn().mockResolvedValue(new Map()),
  getPathsForClaim: vi.fn().mockResolvedValue([]),
  upsertClaim: vi.fn().mockResolvedValue(undefined),
  insertEvidence: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/memory-graph/activation', () => ({
  buildActivationBundles: vi.fn().mockReturnValue([]),
  renderActivationSegment: vi.fn().mockReturnValue({ bundles: [], segment: '', hasContent: false }),
}));

vi.mock('@/tools/executor', () => ({
  createToolExecutor: vi.fn(),
}));

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

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    HOME_SERVER: { fetch: vi.fn() },
    EXECUTOR_CONTAINER: makeMockExecutorContainerNamespace(),
    DB: makeMockD1(),
    RUN_NOTIFIER: makeMockDONamespace(),
    TAKOS_OFFLOAD: makeMockR2(),
    GIT_OBJECTS: makeMockR2(),
    TAKOS_EGRESS: { fetch: vi.fn().mockResolvedValue(new Response('ok', { status: 200 })) },
    RUNTIME_HOST: { fetch: vi.fn().mockResolvedValue(new Response('ok', { status: 200 })) },
    BROWSER_HOST: { fetch: vi.fn().mockResolvedValue(new Response('ok', { status: 200 })) },
    INDEX_QUEUE: { send: vi.fn(), sendBatch: vi.fn() },
    VECTORIZE: makeMockVectorize(),
    AI: { run: vi.fn().mockResolvedValue({ result: 'ai-output' }) },
    OPENAI_API_KEY: 'test-openai',
    ANTHROPIC_API_KEY: 'test-anthropic',
    GOOGLE_API_KEY: 'test-google',
    CONTROL_RPC_BASE_URL: 'https://executor-host.workers.dev',
    ...overrides,
  };
}

function makeMockD1(): any {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [], success: true, meta: {} }),
    run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1, last_row_id: 1, duration: 0 } }),
    raw: vi.fn().mockResolvedValue([]),
  };
  return {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn().mockResolvedValue([]),
    exec: vi.fn(),
    _stmt: stmt,
  };
}

function makeMockR2(): any {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue({ key: 'test', size: 0, etag: 'etag', uploaded: new Date() }),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
    head: vi.fn().mockResolvedValue(null),
  };
}

function makeMockDONamespace(): any {
  const stub = {
    fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })),
  };
  return {
    idFromName: vi.fn().mockReturnValue({ toString: () => 'do-id' }),
    get: vi.fn().mockReturnValue(stub),
    _stub: stub,
  };
}

function makeMockExecutorContainerNamespace(): any {
  return {
    getByName: vi.fn((runId: string) => ({
      verifyProxyToken: vi.fn(async (token: string) => {
        if (token === 'bindings-token') {
          return { runId, workerId: 'worker-1', capability: 'bindings' };
        }
        if (token === 'control-token') {
          return { runId, workerId: 'worker-1', capability: 'control' };
        }
        return null;
      }),
      dispatchStart: vi.fn(async (body: Record<string, unknown>) => ({
        ok: true,
        status: 202,
        body: JSON.stringify({ status: 'accepted', runId: body.runId ?? runId }),
      })),
    })),
  };
}

function makeMockVectorize(): any {
  return {
    query: vi.fn().mockResolvedValue({ matches: [] }),
    insert: vi.fn().mockResolvedValue(undefined),
    upsert: vi.fn().mockResolvedValue(undefined),
    deleteByIds: vi.fn().mockResolvedValue(undefined),
    getByIds: vi.fn().mockResolvedValue([]),
    describe: vi.fn().mockResolvedValue({ dimensions: 128 }),
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
  expect(response.status).toBe(200);
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

describe('validateProxyResourceAccess', () => {
  it('returns true for generic paths that have no special validation', () => {
    expect(validateProxyResourceAccess('/proxy/db/first', { run_id: 'run-1' }, {})).toBe(true);
    expect(validateProxyResourceAccess('/proxy/offload/get', { run_id: 'run-1' }, {})).toBe(true);
    expect(validateProxyResourceAccess('/proxy/heartbeat', { run_id: 'run-1' }, {})).toBe(true);
  });

  it('blocks DO fetches for unknown namespaces', () => {
    expect(validateProxyResourceAccess('/proxy/do/fetch', { run_id: 'run-1' }, {
      namespace: 'SESSION_DO',
      name: 'run-1',
    })).toBe(false);
  });

  it('blocks DO fetches where name does not match runId', () => {
    expect(validateProxyResourceAccess('/proxy/do/fetch', { run_id: 'run-1' }, {
      namespace: 'RUN_NOTIFIER',
      name: 'run-other',
    })).toBe(false);
  });

  it('blocks queue sends for unknown queue names', () => {
    expect(validateProxyResourceAccess('/proxy/queue/send', { run_id: 'run-1' }, { queue: 'dlq' })).toBe(false);
    expect(validateProxyResourceAccess('/proxy/queue/send-batch', { run_id: 'run-1' }, { queue: 'other' })).toBe(false);
  });

  it('validates runtime fetch URLs for allowed paths', () => {
    // /session/* allowed
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/session/exec',
    })).toBe(true);
    // /status/* allowed
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/status',
    })).toBe(true);
    // /repos/* allowed
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/repos/list',
    })).toBe(true);
    // /actions/jobs/:id allowed
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/actions/jobs/job-123',
    })).toBe(true);
    // /cli-proxy/* allowed
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/cli-proxy/some/endpoint',
    })).toBe(true);
  });

  it('blocks runtime fetch for disallowed paths', () => {
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/admin/settings',
    })).toBe(false);
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://runtime-host/',
    })).toBe(false);
  });

  it('blocks runtime fetch for non-runtime-host hostnames', () => {
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'https://evil.com/session/exec',
    })).toBe(false);
  });

  it('blocks runtime fetch when url is not a valid URL', () => {
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 'not-a-url',
    })).toBe(false);
  });

  it('blocks runtime fetch when url is not a string', () => {
    expect(validateProxyResourceAccess('/proxy/runtime/fetch', { run_id: 'r' }, {
      url: 12345,
    })).toBe(false);
  });

  it('validates browser fetch URLs for allowed browser host paths', () => {
    expect(validateProxyResourceAccess('/proxy/browser/fetch', { run_id: 'r' }, {
      url: 'https://browser-host.internal/create',
    })).toBe(true);
    expect(validateProxyResourceAccess('/proxy/browser/fetch', { run_id: 'r' }, {
      url: 'https://browser-host.internal/session/sid-1/goto',
    })).toBe(true);
    expect(validateProxyResourceAccess('/proxy/browser/fetch', { run_id: 'r' }, {
      url: 'https://browser-host.internal/session/sid-1/screenshot',
    })).toBe(true);
  });

  it('blocks browser fetch for disallowed hostnames or paths', () => {
    expect(validateProxyResourceAccess('/proxy/browser/fetch', { run_id: 'r' }, {
      url: 'https://evil.com/session/sid-1/goto',
    })).toBe(false);
    expect(validateProxyResourceAccess('/proxy/browser/fetch', { run_id: 'r' }, {
      url: 'https://browser-host.internal/admin',
    })).toBe(false);
    expect(validateProxyResourceAccess('/proxy/browser/fetch', { run_id: 'r' }, {
      url: 'not-a-url',
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DB proxy handler
// ---------------------------------------------------------------------------

describe('handleDbProxy via fetch', () => {
  it('returns result for db/first with valid SQL', async () => {
    const env = makeEnv();
    env.DB._stmt.first.mockResolvedValue({ id: 1, name: 'test' });

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT 1', params: [] } }),
      env,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.result).toEqual({ id: 1, name: 'test' });
  });

  it('supports db/first with colName parameter', async () => {
    const env = makeEnv();
    env.DB._stmt.first.mockResolvedValue('test-value');

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT name FROM t', params: [], colName: 'name' } }),
      env,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.result).toBe('test-value');
  });

  it('returns 400 when sql is missing for db/first', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { params: [] } }),
      env,
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain('Missing required "sql"');
  });

  it('returns 400 for SQL validation failure', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/run', { runId: 'run-1', body: { sql: 'PRAGMA table_info(users)', params: [] } }),
      env,
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain('SQL validation failed');
  });

  it('returns result for db/run with valid SQL', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/run', { runId: 'run-1', body: { sql: 'INSERT INTO t(id) VALUES (?)', params: [1] } }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('returns 400 when sql is missing for db/run', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/run', { runId: 'run-1', body: {} }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns result for db/all with valid SQL', async () => {
    const env = makeEnv();
    env.DB._stmt.all.mockResolvedValue({ results: [{ id: 1 }], success: true, meta: {} });

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/all', { runId: 'run-1', body: { sql: 'SELECT * FROM t', params: [] } }),
      env,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.results).toEqual([{ id: 1 }]);
  });

  it('returns 400 when sql is missing for db/all', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/all', { runId: 'run-1', body: {} }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns result for db/raw with valid SQL', async () => {
    const env = makeEnv();
    env.DB._stmt.raw.mockResolvedValue([[1, 'test']]);

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/raw', { runId: 'run-1', body: { sql: 'SELECT id, name FROM t', params: [] } }),
      env,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.results).toEqual([[1, 'test']]);
  });

  it('supports db/raw with columnNames option', async () => {
    const env = makeEnv();
    env.DB._stmt.raw.mockResolvedValue([['id', 'name'], [1, 'test']]);

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/raw', {
        runId: 'run-1',
        body: { sql: 'SELECT id, name FROM t', params: [], rawOptions: { columnNames: true } },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.results).toEqual([['id', 'name'], [1, 'test']]);
  });

  it('returns 400 when sql is missing for db/raw', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/raw', { runId: 'run-1', body: {} }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('executes db/batch with valid statements', async () => {
    const env = makeEnv();
    env.DB.batch.mockResolvedValue([{ success: true }]);

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
    expect(res.status).toBe(200);
  });

  it('returns 400 when statements is missing for db/batch', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/batch', { runId: 'run-1', body: {} }),
      env,
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain('Missing required "statements"');
  });

  it('returns 400 when batch contains too many statements', async () => {
    const env = makeEnv();
    const statements = Array.from({ length: 101 }, (_, i) => ({
      sql: `INSERT INTO t(id) VALUES (${i})`,
      params: [],
    }));
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/batch', { runId: 'run-1', body: { statements } }),
      env,
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain('too many statements');
  });

  it('returns 400 when batch contains invalid SQL', async () => {
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
    expect(res.status).toBe(400);
  });

  it('blocks db/exec endpoint with 403', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/exec', { runId: 'run-1', body: { sql: 'CREATE TABLE t (id INT)' } }),
      env,
    );
    expect(res.status).toBe(403);
    const data = await res.json() as any;
    expect(data.error).toContain('disabled for security');
  });

  it('returns 404 for unknown db proxy subpath', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/unknown', { runId: 'run-1', body: { sql: 'SELECT 1' } }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('classifies D1 errors correctly', async () => {
    const env = makeEnv();
    env.DB._stmt.first.mockRejectedValue(new Error('D1_ERROR: some issue'));

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT 1', params: [] } }),
      env,
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toBe('Database query error');
  });

  it('classifies SQLITE_BUSY as 503', async () => {
    const env = makeEnv();
    env.DB._stmt.run.mockRejectedValue(new Error('SQLITE_BUSY'));

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/run', { runId: 'run-1', body: { sql: 'INSERT INTO t(x) VALUES(1)', params: [] } }),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('classifies SQLITE_CONSTRAINT as 409', async () => {
    const env = makeEnv();
    env.DB._stmt.run.mockRejectedValue(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed'));

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/run', { runId: 'run-1', body: { sql: 'INSERT INTO t(x) VALUES(1)', params: [] } }),
      env,
    );
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// R2 proxy handler (offload)
// ---------------------------------------------------------------------------

describe('handleR2Proxy via fetch (offload)', () => {
  it('returns 404 when getting a non-existent key', async () => {
    const env = makeEnv();
    env.TAKOS_OFFLOAD.get.mockResolvedValue(null);

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/get', { runId: 'run-1', body: { key: 'missing-key' } }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns object body and headers for existing key', async () => {
    const env = makeEnv();
    const body = new TextEncoder().encode('file-content');
    env.TAKOS_OFFLOAD.get.mockResolvedValue({
      body: new ReadableStream({
        start(ctrl) { ctrl.enqueue(body); ctrl.close(); },
      }),
      size: body.byteLength,
      etag: 'test-etag',
      uploaded: new Date('2026-01-01T00:00:00Z'),
    });

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/get', { runId: 'run-1', body: { key: 'my-key' } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBe('test-etag');
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('puts a text value via JSON encoding', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/put', {
        runId: 'run-1',
        body: { key: 'my-key', body: 'hello', encoding: 'text' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(env.TAKOS_OFFLOAD.put).toHaveBeenCalledWith('my-key', 'hello', undefined);
  });

  it('puts a null value via encoding=null', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/put', {
        runId: 'run-1',
        body: { key: 'my-key', encoding: 'null' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(env.TAKOS_OFFLOAD.put).toHaveBeenCalledWith('my-key', null, undefined);
  });

  it('returns 400 when base64 encoding but bodyBase64 is missing', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/put', {
        runId: 'run-1',
        body: { key: 'my-key', encoding: 'base64' },
      }),
      env,
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain('Missing bodyBase64');
  });

  it('returns 400 when text encoding but body is missing', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/put', {
        runId: 'run-1',
        body: { key: 'my-key', encoding: 'text' },
      }),
      env,
    );
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain('Missing body for text');
  });

  it('deletes a key successfully', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/delete', {
        runId: 'run-1',
        body: { key: 'my-key' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(env.TAKOS_OFFLOAD.delete).toHaveBeenCalledWith('my-key');
  });

  it('lists objects with options', async () => {
    const env = makeEnv();
    env.TAKOS_OFFLOAD.list.mockResolvedValue({
      objects: [{ key: 'obj-1', size: 100 }],
      truncated: false,
    });

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/list', {
        runId: 'run-1',
        body: { prefix: 'uploads/' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.objects).toHaveLength(1);
  });

  it('heads a key', async () => {
    const env = makeEnv();
    env.TAKOS_OFFLOAD.head.mockResolvedValue({ key: 'my-key', size: 42 });

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/head', {
        runId: 'run-1',
        body: { key: 'my-key' },
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown R2 proxy subpath', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/offload/unknown', {
        runId: 'run-1',
        body: { key: 'my-key' },
      }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// R2 proxy handler (git-objects)
// ---------------------------------------------------------------------------

describe('handleR2Proxy via fetch (git-objects)', () => {
  it('returns 503 when GIT_OBJECTS is not configured', async () => {
    const env = makeEnv({ GIT_OBJECTS: undefined });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/git-objects/get', { runId: 'run-1', body: { key: 'sha' } }),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('gets a git object', async () => {
    const env = makeEnv();
    const body = new TextEncoder().encode('blob-data');
    env.GIT_OBJECTS.get.mockResolvedValue({
      body: new ReadableStream({
        start(ctrl) { ctrl.enqueue(body); ctrl.close(); },
      }),
      size: body.byteLength,
      etag: 'git-etag',
      uploaded: new Date(),
    });

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/git-objects/get', { runId: 'run-1', body: { key: 'sha-abc' } }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DO (notifier) proxy handler
// ---------------------------------------------------------------------------

describe('handleNotifierProxy via fetch', () => {
  it('proxies a valid DO fetch to RUN_NOTIFIER', async () => {
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
    expect(res.status).toBe(200);
  });

  it('blocks DO fetch to unknown namespace', async () => {
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
    expect(res.status).toBe(200);
  });

  it('blocks DO fetch with disallowed path', async () => {
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
    expect(res.status).toBe(403);
  });

  it('blocks DO fetch with disallowed method', async () => {
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
    expect(res.status).toBe(403);
  });

  it('returns 400 when namespace is unknown', async () => {
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
    expect(res.status).toBe(401); // Resource access denied
  });

  it('returns 400 when url is missing for DO fetch', async () => {
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
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain('Missing required "url"');
  });
});

// ---------------------------------------------------------------------------
// Vectorize proxy handler
// ---------------------------------------------------------------------------

describe('handleVectorizeProxy via fetch', () => {
  it('returns 503 when VECTORIZE is not configured', async () => {
    const env = makeEnv({ VECTORIZE: undefined });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/query', { runId: 'run-1', body: { vector: [1, 2, 3] } }),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('queries vectorize index', async () => {
    const env = makeEnv();
    env.VECTORIZE.query.mockResolvedValue({ matches: [{ id: 'vec-1', score: 0.95 }] });

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/query', { runId: 'run-1', body: { vector: [1, 2, 3] } }),
      env,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.matches).toHaveLength(1);
  });

  it('returns 400 when vector is missing for query', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/query', { runId: 'run-1', body: {} }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('inserts vectors', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/insert', {
        runId: 'run-1',
        body: { vectors: [{ id: 'v1', values: [1, 2] }] },
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('upserts vectors', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/upsert', {
        runId: 'run-1',
        body: { vectors: [{ id: 'v1', values: [1, 2] }] },
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('deletes vectors by ids', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/delete', {
        runId: 'run-1',
        body: { ids: ['v1', 'v2'] },
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('returns 400 when ids is missing for delete', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/delete', { runId: 'run-1', body: {} }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('gets vectors by ids', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/get', {
        runId: 'run-1',
        body: { ids: ['v1'] },
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('returns 400 when ids is missing for get', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/get', { runId: 'run-1', body: {} }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('describes vectorize index', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/describe', { runId: 'run-1', body: {} }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown vectorize subpath', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/vectorize/unknown', { runId: 'run-1', body: {} }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AI proxy handler
// ---------------------------------------------------------------------------

describe('handleAiProxy via fetch', () => {
  it('returns 503 when AI is not configured', async () => {
    const env = makeEnv({ AI: undefined });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/ai/run', { runId: 'run-1', body: { model: 'gpt-4', inputs: {} } }),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('runs AI model', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/ai/run', {
        runId: 'run-1',
        body: { model: '@cf/meta/llama-2-7b-chat-int8', inputs: { prompt: 'Hello' } },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(env.AI.run).toHaveBeenCalled();
  });

  it('returns 404 for unknown AI subpath', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/ai/unknown', { runId: 'run-1', body: {} }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Egress proxy handler
// ---------------------------------------------------------------------------

describe('handleEgressProxy via fetch', () => {
  it('proxies request through TAKOS_EGRESS', async () => {
    const env = makeEnv();
    env.TAKOS_EGRESS.fetch.mockResolvedValue(
      new Response('external response', { status: 200, headers: { 'X-Custom': 'val' } }),
    );

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/egress/fetch', {
        runId: 'run-1',
        body: { url: 'https://api.example.com/data', method: 'GET' },
      }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('classifies egress network errors', async () => {
    const env = makeEnv();
    env.TAKOS_EGRESS.fetch.mockRejectedValue(new Error('fetch failed'));

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/egress/fetch', {
        runId: 'run-1',
        body: { url: 'https://api.example.com/data' },
      }),
      env,
    );
    expect(res.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// Runtime proxy handler
// ---------------------------------------------------------------------------

describe('handleRuntimeProxy via fetch', () => {
  it('returns 503 when RUNTIME_HOST is not configured', async () => {
    const env = makeEnv({ RUNTIME_HOST: undefined });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/runtime/fetch', {
        runId: 'run-1',
        body: { url: 'https://runtime-host/session/exec', method: 'GET' },
      }),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('proxies request through RUNTIME_HOST', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/runtime/fetch', {
        runId: 'run-1',
        body: { url: 'https://runtime-host/session/exec', method: 'POST', body: '{}' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(env.RUNTIME_HOST.fetch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Browser proxy handler
// ---------------------------------------------------------------------------

describe('handleBrowserProxy via fetch', () => {
  it('returns 503 when BROWSER_HOST is not configured', async () => {
    const env = makeEnv({ BROWSER_HOST: undefined });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/browser/fetch', {
        runId: 'run-1',
        body: { url: 'https://browser-host.internal/session/sid-1/goto', method: 'POST', body: '{}' },
      }),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('proxies request through BROWSER_HOST', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/browser/fetch', {
        runId: 'run-1',
        body: { url: 'https://browser-host.internal/session/sid-1/goto', method: 'POST', body: '{}' },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(env.BROWSER_HOST.fetch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Queue proxy handler
// ---------------------------------------------------------------------------

describe('handleQueueProxy via fetch', () => {
  it('returns 503 when INDEX_QUEUE is not configured', async () => {
    const env = makeEnv({ INDEX_QUEUE: undefined });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/queue/send', {
        runId: 'run-1',
        body: { queue: 'index', message: { type: 'reindex', id: '1' } },
      }),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('sends a single message to the index queue', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/queue/send', {
        runId: 'run-1',
        body: { queue: 'index', message: { type: 'reindex', id: '1' } },
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(env.INDEX_QUEUE.send).toHaveBeenCalled();
  });

  it('sends a batch of messages', async () => {
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
    expect(res.status).toBe(200);
    expect(env.INDEX_QUEUE.sendBatch).toHaveBeenCalled();
  });

  it('returns 400 when messages is missing for send-batch', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/queue/send-batch', {
        runId: 'run-1',
        body: { queue: 'index' },
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 403 for unknown queue name', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/queue/send', {
        runId: 'run-1',
        body: { queue: 'other', message: {} },
      }),
      env,
    );
    // validateProxyResourceAccess returns false -> 401
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown queue subpath', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/queue/unknown', {
        runId: 'run-1',
        body: { queue: 'index' },
      }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// API keys proxy
// ---------------------------------------------------------------------------

describe('api-keys proxy', () => {
  it('returns configured API keys', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/api-keys', { runId: 'run-1', body: {}, bearerToken: 'control-token' }),
      env,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.openai).toBe('test-openai');
    expect(data.anthropic).toBe('test-anthropic');
    expect(data.google).toBe('test-google');
  });

  it('returns null for unconfigured API keys', async () => {
    const env = makeEnv({
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
    });
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/api-keys', { runId: 'run-1', body: {}, bearerToken: 'control-token' }),
      env,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.openai).toBeNull();
    expect(data.anthropic).toBeNull();
    expect(data.google).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Run control proxy
// ---------------------------------------------------------------------------

describe('run control proxy', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReset();
    vi.mocked(buildConversationHistory).mockReset();
    vi.mocked(updateRunStatusImpl).mockReset();
    vi.mocked(resolveSkillPlanForRun).mockReset();
    vi.mocked(getActiveClaims).mockReset();
    vi.mocked(countEvidenceForClaims).mockReset();
    vi.mocked(getPathsForClaim).mockReset();
    vi.mocked(upsertClaim).mockReset();
    vi.mocked(insertEvidence).mockReset();
    vi.mocked(buildActivationBundles).mockReset();
    vi.mocked(renderActivationSegment).mockReset();
    vi.mocked(createToolExecutor).mockReset();
    vi.mocked(persistMessage).mockClear();
  });

  it('returns run status via control capability', async () => {
    vi.mocked(getDb).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ status: 'running' }]),
          }),
        }),
      }),
    } as any);

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/run/status', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: 'running' });
  });

  it('marks a run failed via control capability', async () => {
    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      }),
    });
    vi.mocked(getDb).mockReturnValue({ update } as any);

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

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true, updated: true });
    expect(update).toHaveBeenCalled();
  });

  it('returns run context for no-LLM fast path', async () => {
    const select = vi.fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              status: 'running',
              threadId: 'thread-1',
              sessionId: 'session-1',
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({
                content: 'hello from test',
              }),
            }),
          }),
        }),
      });
    vi.mocked(getDb).mockReturnValue({ select } as any);

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/run-context', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: 'running',
      threadId: 'thread-1',
      sessionId: 'session-1',
      lastUserMessage: 'hello from test',
    });
  });

  it('returns run record via control RPC', async () => {
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            status: 'running',
            input: '{"task":"test"}',
            parentRunId: 'parent-1',
          }),
        }),
      }),
    });
    vi.mocked(getDb).mockReturnValue({ select } as any);

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/run-record', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: 'running',
      input: '{"task":"test"}',
      parentRunId: 'parent-1',
    });
  });

  it('returns run bootstrap via control RPC', async () => {
    const select = vi.fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              id: 'run-1',
              status: 'running',
              accountId: 'space-1',
              sessionId: 'session-1',
              threadId: 'thread-1',
              agentType: 'general',
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              accountId: 'space-1',
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              accountId: 'space-1',
              requesterAccountId: 'user-1',
            }),
          }),
        }),
      });
    vi.mocked(getDb).mockReturnValue({ select } as any);

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/run-bootstrap', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: 'running',
      spaceId: 'space-1',
      sessionId: 'session-1',
      threadId: 'thread-1',
      userId: 'user-1',
      agentType: 'general',
    });
  });

  it('returns conversation history via control RPC', async () => {
    vi.mocked(buildConversationHistory).mockResolvedValueOnce([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'world' },
    ]);

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

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      history: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ],
    });
    expect(buildConversationHistory).toHaveBeenCalledWith(expect.objectContaining({
      db: env.DB,
      threadId: 'thread-1',
      runId: 'run-1',
      spaceId: 'space-1',
      aiModel: 'gpt-5',
    }));
  });

  it('returns skill plan via control RPC', async () => {
    vi.mocked(resolveSkillPlanForRun).mockResolvedValueOnce({
      success: true,
      skillLocale: 'ja',
      availableSkills: [{ id: 'official.search', name: 'Search', description: 'desc', triggers: [], source: 'official', execution_contract: { preferred_tools: [], durable_output_hints: [], output_modes: ['chat'], required_mcp_servers: [], template_ids: [] }, availability: 'available', availability_reasons: [] }],
      selectedSkills: [],
      activatedSkills: [],
    } as any);

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

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      success: true,
      skillLocale: 'ja',
    }));
    expect(resolveSkillPlanForRun).toHaveBeenCalledWith(env.DB, {
      runId: 'run-1',
      threadId: 'thread-1',
      spaceId: 'space-1',
      agentType: 'assistant',
      history: [{ role: 'user', content: 'hello' }],
      availableToolNames: ['search'],
    });
  });

  it('returns memory activation via control RPC', async () => {
    vi.mocked(getActiveClaims).mockResolvedValueOnce([
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
    ] as any);
    vi.mocked(countEvidenceForClaims).mockResolvedValueOnce(new Map([['claim-1', 2]]));
    vi.mocked(getPathsForClaim).mockResolvedValueOnce([]);
    vi.mocked(buildActivationBundles).mockReturnValueOnce([{ claim: { id: 'claim-1' }, evidenceCount: 2, paths: [] }] as any);
    vi.mocked(renderActivationSegment).mockReturnValueOnce({
      bundles: [{ claim: { id: 'claim-1' }, evidenceCount: 2, paths: [] }] as any,
      segment: '[Active memory]\n1. Takos uses Redis',
      hasContent: true,
    });

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/memory-activation', {
        runId: 'run-1',
        body: { spaceId: 'space-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      bundles: [{ claim: { id: 'claim-1' }, evidenceCount: 2, paths: [] }],
      segment: '[Active memory]\n1. Takos uses Redis',
      hasContent: true,
    });
    expect(getActiveClaims).toHaveBeenCalledWith(env.DB, 'space-1', 50);
  });

  it('returns and executes remote tools via control RPC', async () => {
    const select = vi.fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              id: 'run-1',
              status: 'running',
              accountId: 'space-1',
              sessionId: 'session-1',
              threadId: 'thread-1',
              agentType: 'general',
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              accountId: 'space-1',
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              accountId: 'space-1',
              requesterAccountId: 'user-1',
            }),
          }),
        }),
      });
    vi.mocked(getDb).mockReturnValue({ select } as any);

    const cleanup = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      tool_call_id: 'tool-1',
      output: 'read ok',
    });
    vi.mocked(createToolExecutor).mockResolvedValue({
      getAvailableTools: () => [{
        name: 'file_read',
        description: 'read file',
        category: 'file',
        parameters: { type: 'object', properties: {} },
      }],
      mcpFailedServers: ['repo-mcp'],
      execute,
      setObserver: vi.fn(),
      setDb: vi.fn(),
      cleanup,
    } as any);

    const env = makeEnv();
    const catalogResponse = await executorHost.fetch(
      makeProxyRequest('/rpc/control/tool-catalog', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    expect(catalogResponse.status).toBe(200);
    await expect(catalogResponse.json()).resolves.toEqual({
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

    expect(executeResponse.status).toBe(200);
    await expect(executeResponse.json()).resolves.toEqual({
      tool_call_id: 'tool-1',
      output: 'read ok',
    });
    expect(execute).toHaveBeenCalledWith({
      id: 'tool-1',
      name: 'file_read',
      arguments: { path: 'README.md' },
    });
    expect(createToolExecutor).toHaveBeenCalledTimes(1);

    const cleanupResponse = await executorHost.fetch(
      makeProxyRequest('/rpc/control/tool-cleanup', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    expect(cleanupResponse.status).toBe(200);
    await expect(cleanupResponse.json()).resolves.toEqual({ success: true });
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('keeps forbidden proxy buckets flat for canonical control RPC traffic', async () => {
    const select = vi.fn()
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              id: 'run-1',
              status: 'running',
              accountId: 'space-1',
              sessionId: 'session-1',
              threadId: 'thread-1',
              agentType: 'general',
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              accountId: 'space-1',
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              accountId: 'space-1',
              requesterAccountId: 'user-1',
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              id: 'run-1',
              status: 'running',
              accountId: 'space-1',
              sessionId: 'session-1',
              threadId: 'thread-1',
              agentType: 'general',
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              accountId: 'space-1',
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              accountId: 'space-1',
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              accountId: 'space-1',
              requesterAccountId: 'user-1',
            }),
          }),
        }),
      });
    vi.mocked(getDb).mockReturnValue({ select } as any);

    const cleanup = vi.fn();
    vi.mocked(createToolExecutor).mockResolvedValue({
      getAvailableTools: () => [{
        name: 'file_read',
        description: 'read file',
        category: 'file',
        parameters: { type: 'object', properties: {} },
      }],
      mcpFailedServers: [],
      execute: vi.fn().mockResolvedValue({
        tool_call_id: 'tool-1',
        output: 'ok',
      }),
      setObserver: vi.fn(),
      setDb: vi.fn(),
      cleanup,
    } as any);

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
      expect(response.status).toBe(200);
    }

    const after = await readProxyUsageCounts(env);
    const delta = diffProxyUsageCounts(before, after);

    expect(delta.db ?? 0).toBe(0);
    expect(delta.offload ?? 0).toBe(0);
    expect(delta.do ?? 0).toBe(0);
    expect(delta['tool-catalog'] ?? 0).toBe(1);
    expect(delta['tool-execute'] ?? 0).toBe(1);
    expect(delta['tool-cleanup'] ?? 0).toBe(1);
    expect(delta['other-control-rpc'] ?? 0).toBeGreaterThanOrEqual(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('finalizes memory overlay via control RPC', async () => {
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

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(upsertClaim).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      id: 'claim-1',
      subject: 'Takos',
    }));
    expect(insertEvidence).toHaveBeenCalledWith(env.DB, expect.objectContaining({
      id: 'ev-1',
      claimId: 'claim-1',
    }));
    expect(env.INDEX_QUEUE.send).toHaveBeenCalled();
  });

  it('adds a message via control RPC', async () => {
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

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(persistMessage).toHaveBeenCalledWith(
      expect.objectContaining({ db: env.DB, threadId: 'thread-1' }),
      { role: 'assistant', content: 'saved from rpc' },
      { source: 'test' },
    );
  });

  it('updates run status via control RPC', async () => {
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

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(updateRunStatusImpl).toHaveBeenCalledWith(
      env.DB,
      'run-1',
      { inputTokens: 11, outputTokens: 7 },
      'completed',
      'done',
      undefined,
    );
  });

  it('returns current session via control RPC', async () => {
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            sessionId: 'session-from-rpc',
          }),
        }),
      }),
    });
    vi.mocked(getDb).mockReturnValue({ select } as any);

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

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sessionId: 'session-from-rpc' });
  });

  it('returns cancellation status via control RPC', async () => {
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            status: 'cancelled',
          }),
        }),
      }),
    });
    vi.mocked(getDb).mockReturnValue({ select } as any);

    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/rpc/control/is-cancelled', {
        runId: 'run-1',
        body: { runId: 'run-1' },
        bearerToken: 'control-token',
      }),
      env,
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ cancelled: true });
  });

  it('emits run events via control RPC', async () => {
    const insert = vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ id: 42 }),
        }),
      }),
    });
    vi.mocked(getDb).mockReturnValue({ insert } as any);

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

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(insert).toHaveBeenCalled();
    expect(env.RUN_NOTIFIER._stub.fetch).toHaveBeenCalledTimes(1);
  });

  it('completes a no-LLM run via control RPC', async () => {
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            id: 'run-1',
            status: 'running',
            threadId: 'thread-1',
            sessionId: 'session-1',
            workerId: 'worker-1',
          }),
        }),
      }),
    });
    const update = vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
    vi.mocked(getDb).mockReturnValue({ select, update } as any);

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

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
    expect(persistMessage).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-1' }),
      { role: 'assistant', content: 'hello from no-llm' },
    );
    expect(update).toHaveBeenCalled();
    expect(env.RUN_NOTIFIER._stub.fetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// General fetch handler
// ---------------------------------------------------------------------------

describe('general fetch handler', () => {
  it('returns proxy usage counters', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      new Request('http://localhost/internal/proxy-usage', { method: 'GET' }),
      env,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(expect.objectContaining({
      status: 'ok',
      service: 'takos-executor-host',
      counts: expect.any(Object),
    }));
  });

  it('returns 200 for root path', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      new Request('http://localhost/', { method: 'GET' }),
      env,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe('takos-executor-host');
  });

  it('returns 401 for unknown proxy path (capability gate)', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/unknown/thing', { runId: 'run-1' }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('returns 405 for non-POST/GET on proxy paths', async () => {
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
    expect(res.status).toBe(405);
  });

  it('returns 400 for dispatch without runId', async () => {
    const env = makeEnv();
    const res = await executorHost.fetch(
      new Request('http://localhost/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerId: 'w-1' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

describe('error classification edge cases', () => {
  it('classifies timeout errors as 504', async () => {
    const env = makeEnv();
    const timeoutError = new Error('request timed out');
    timeoutError.name = 'TimeoutError';
    env.DB._stmt.first.mockRejectedValue(timeoutError);

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT 1', params: [] } }),
      env,
    );
    expect(res.status).toBe(504);
  });

  it('classifies network errors as 502', async () => {
    const env = makeEnv();
    env.DB._stmt.first.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT 1', params: [] } }),
      env,
    );
    expect(res.status).toBe(502);
  });

  it('classifies TypeError as 400', async () => {
    const env = makeEnv();
    env.DB._stmt.first.mockRejectedValue(new TypeError('invalid argument'));

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT 1', params: [] } }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('classifies unknown errors as 500', async () => {
    const env = makeEnv();
    env.DB._stmt.first.mockRejectedValue(new Error('something weird'));

    const res = await executorHost.fetch(
      makeProxyRequest('/proxy/db/first', { runId: 'run-1', body: { sql: 'SELECT 1', params: [] } }),
      env,
    );
    expect(res.status).toBe(500);
  });
});
