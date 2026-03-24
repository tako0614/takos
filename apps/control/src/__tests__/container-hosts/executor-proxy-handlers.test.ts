/**
 * Tests for executor-proxy-handlers: individual proxy handler functions,
 * error classification, and helper utilities.
 *
 * The integration-level proxy tests (via executor-host.fetch) live in
 * executor-host.test.ts. This file tests the exported functions directly.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/services/execution/sql-validation', () => ({
  validateD1ProxySql: vi.fn((sql: string) => {
    if (sql.startsWith('PRAGMA') || sql.startsWith('ATTACH')) {
      return { valid: false, error: 'Forbidden verb' };
    }
    return { valid: true, statement: sql };
  }),
}));

vi.mock('@/container-hosts/d1-raw', () => ({
  executeD1RawStatement: vi.fn(async (stmt: any, opts?: any) => {
    if (opts?.columnNames) {
      return stmt.raw({ columnNames: true });
    }
    return stmt.raw();
  }),
}));

vi.mock('@/durable-objects/shared', () => ({
  buildSanitizedDOHeaders: vi.fn(
    (source: Record<string, string> | undefined, overrides: Record<string, string>) => {
      return { ...source, ...overrides };
    },
  ),
}));

vi.mock('@/db', () => ({
  getDb: vi.fn(() => ({
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  })),
}));

vi.mock('@/shared/utils/logger', () => ({
  logError: vi.fn(),
}));

import {
  ok,
  err,
  classifyProxyError,
  handleDbProxy,
  handleR2Proxy,
  handleNotifierProxy,
  handleVectorizeProxy,
  handleAiProxy,
  handleEgressProxy,
  handleRuntimeProxy,
  handleBrowserProxy,
  handleQueueProxy,
  handleHeartbeat,
  handleRunReset,
} from '@/container-hosts/executor-proxy-handlers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockD1(): any {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    all: vi.fn().mockResolvedValue({ results: [], success: true, meta: {} }),
    run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
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
    put: vi.fn().mockResolvedValue({ key: 'k', size: 0, etag: 'etag', uploaded: new Date() }),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
    head: vi.fn().mockResolvedValue(null),
  };
}

function makeMockDONamespace(): any {
  const stub = {
    fetch: vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  };
  return {
    idFromName: vi.fn().mockReturnValue({ toString: () => 'do-id' }),
    get: vi.fn().mockReturnValue(stub),
    _stub: stub,
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

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ok / err response helpers
// ---------------------------------------------------------------------------

describe('ok', () => {
  it('returns a 200 JSON response with serialized data', async () => {
    const response = ok({ foo: 'bar', count: 42 });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    const body = await response.json();
    expect(body).toEqual({ foo: 'bar', count: 42 });
  });

  it('serializes null data', async () => {
    const response = ok(null);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toBeNull();
  });
});

describe('err', () => {
  it('returns a 500 JSON error by default', async () => {
    const response = err('Something went wrong');
    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    const body = await response.json() as any;
    expect(body.error).toBe('Something went wrong');
  });

  it('accepts a custom status code', async () => {
    const response = err('Not found', 404);
    expect(response.status).toBe(404);
    const body = await response.json() as any;
    expect(body.error).toBe('Not found');
  });
});

// ---------------------------------------------------------------------------
// classifyProxyError
// ---------------------------------------------------------------------------

describe('classifyProxyError', () => {
  it('classifies AbortError as 504 timeout', () => {
    const e = new DOMException('Request aborted', 'AbortError');
    const result = classifyProxyError(e);
    expect(result.status).toBe(504);
    expect(result.message).toContain('timed out');
  });

  it('classifies TimeoutError by name as 504', () => {
    const e = new DOMException('Timed out', 'TimeoutError');
    const result = classifyProxyError(e);
    expect(result.status).toBe(504);
  });

  it('classifies "timed out" in message as 504', () => {
    const result = classifyProxyError(new Error('The request timed out'));
    expect(result.status).toBe(504);
  });

  it('classifies SQLITE_BUSY as 503', () => {
    const result = classifyProxyError(new Error('SQLITE_BUSY: database is locked'));
    expect(result.status).toBe(503);
    expect(result.message).toContain('busy');
  });

  it('classifies "database is locked" as 503', () => {
    const result = classifyProxyError(new Error('database is locked'));
    expect(result.status).toBe(503);
  });

  it('classifies SQLITE_CONSTRAINT as 409', () => {
    const result = classifyProxyError(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed'));
    expect(result.status).toBe(409);
    expect(result.message).toContain('constraint');
  });

  it('classifies SQLITE_ERROR as 400', () => {
    const result = classifyProxyError(new Error('SQLITE_ERROR: near syntax error'));
    expect(result.status).toBe(400);
    expect(result.message).toContain('query error');
  });

  it('classifies D1_ERROR as 400', () => {
    const result = classifyProxyError(new Error('D1_ERROR: something failed'));
    expect(result.status).toBe(400);
  });

  it('classifies NetworkError as 502', () => {
    const e = new Error('fetch failed');
    (e as any).name = 'NetworkError';
    const result = classifyProxyError(e);
    expect(result.status).toBe(502);
    expect(result.message).toContain('connection failed');
  });

  it('classifies ECONNREFUSED as 502', () => {
    const result = classifyProxyError(new Error('connect ECONNREFUSED 127.0.0.1:8080'));
    expect(result.status).toBe(502);
  });

  it('classifies ECONNRESET as 502', () => {
    const result = classifyProxyError(new Error('read ECONNRESET'));
    expect(result.status).toBe(502);
  });

  it('classifies TypeError as 400', () => {
    const result = classifyProxyError(new TypeError('Cannot read property x'));
    expect(result.status).toBe(400);
    expect(result.message).toBe('Invalid request');
  });

  it('classifies RangeError as 400', () => {
    const result = classifyProxyError(new RangeError('Value out of range'));
    expect(result.status).toBe(400);
  });

  it('returns 500 for unknown errors', () => {
    const result = classifyProxyError(new Error('Unexpected'));
    expect(result.status).toBe(500);
    expect(result.message).toBe('Internal proxy error');
  });

  it('handles non-Error values', () => {
    const result = classifyProxyError('string error');
    expect(result.status).toBe(500);
    expect(result.message).toBe('Internal proxy error');
  });
});

// ---------------------------------------------------------------------------
// handleDbProxy
// ---------------------------------------------------------------------------

describe('handleDbProxy', () => {
  it('handles db/first and returns the result', async () => {
    const env = makeEnv();
    env.DB._stmt.first.mockResolvedValue({ id: 1 });

    const res = await handleDbProxy('/proxy/db/first', { sql: 'SELECT 1', params: [] }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.result).toEqual({ id: 1 });
  });

  it('handles db/first with colName', async () => {
    const env = makeEnv();
    env.DB._stmt.first.mockResolvedValue('hello');

    const res = await handleDbProxy('/proxy/db/first', { sql: 'SELECT name', params: [], colName: 'name' }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.result).toBe('hello');
  });

  it('returns 400 when sql is missing for db/first', async () => {
    const env = makeEnv();
    const res = await handleDbProxy('/proxy/db/first', { params: [] }, env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Missing required "sql"');
  });

  it('returns 400 for SQL validation failure', async () => {
    const env = makeEnv();
    const res = await handleDbProxy('/proxy/db/run', { sql: 'PRAGMA table_info(x)', params: [] }, env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('SQL validation failed');
  });

  it('handles db/run with valid SQL', async () => {
    const env = makeEnv();
    const res = await handleDbProxy('/proxy/db/run', { sql: 'INSERT INTO t(id) VALUES (?)', params: [1] }, env);
    expect(res.status).toBe(200);
  });

  it('handles db/all with valid SQL', async () => {
    const env = makeEnv();
    env.DB._stmt.all.mockResolvedValue({ results: [{ id: 1 }], success: true, meta: {} });

    const res = await handleDbProxy('/proxy/db/all', { sql: 'SELECT * FROM t', params: [] }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.results).toEqual([{ id: 1 }]);
  });

  it('handles db/batch with valid statements', async () => {
    const env = makeEnv();
    env.DB.batch.mockResolvedValue([{ success: true }]);

    const res = await handleDbProxy('/proxy/db/batch', {
      statements: [
        { sql: 'INSERT INTO t(id) VALUES (?)', params: [1] },
        { sql: 'INSERT INTO t(id) VALUES (?)', params: [2] },
      ],
    }, env);
    expect(res.status).toBe(200);
  });

  it('returns 400 when batch statements is missing', async () => {
    const env = makeEnv();
    const res = await handleDbProxy('/proxy/db/batch', {}, env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Missing required "statements"');
  });

  it('returns 400 when batch exceeds 100 statements', async () => {
    const env = makeEnv();
    const statements = Array.from({ length: 101 }, (_, i) => ({
      sql: `INSERT INTO t(id) VALUES (${i})`,
      params: [],
    }));
    const res = await handleDbProxy('/proxy/db/batch', { statements }, env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('too many statements');
  });

  it('blocks db/exec with 403', async () => {
    const env = makeEnv();
    const res = await handleDbProxy('/proxy/db/exec', { sql: 'CREATE TABLE t(id INT)' }, env);
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toContain('disabled for security');
  });

  it('returns 404 for unknown db proxy subpath', async () => {
    const env = makeEnv();
    const res = await handleDbProxy('/proxy/db/unknown', { sql: 'SELECT 1' }, env);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toContain('Unknown DB proxy path');
  });

  it('classifies D1 errors and returns appropriate status', async () => {
    const env = makeEnv();
    env.DB._stmt.first.mockRejectedValue(new Error('SQLITE_CONSTRAINT: UNIQUE'));

    const res = await handleDbProxy('/proxy/db/first', { sql: 'SELECT 1', params: [] }, env);
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// handleR2Proxy
// ---------------------------------------------------------------------------

describe('handleR2Proxy', () => {
  it('returns 404 when object is not found on get', async () => {
    const bucket = makeMockR2();
    bucket.get.mockResolvedValue(null);

    const res = await handleR2Proxy('/prefix/get', '/prefix', { key: 'missing' }, bucket);
    expect(res.status).toBe(404);
  });

  it('returns object body on successful get', async () => {
    const bucket = makeMockR2();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data'));
        controller.close();
      },
    });
    bucket.get.mockResolvedValue({
      body: stream,
      size: 4,
      etag: '"abc"',
      uploaded: new Date('2024-01-01'),
    });

    const res = await handleR2Proxy('/prefix/get', '/prefix', { key: 'my-key' }, bucket);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('ETag')).toBe('"abc"');
  });

  it('puts text data to bucket', async () => {
    const bucket = makeMockR2();
    const res = await handleR2Proxy('/prefix/put', '/prefix', {
      key: 'my-key',
      body: 'hello world',
      encoding: 'text',
    }, bucket);
    expect(res.status).toBe(200);
    expect(bucket.put).toHaveBeenCalledWith('my-key', 'hello world', undefined);
  });

  it('returns 400 when bodyBase64 is missing for base64 encoding', async () => {
    const bucket = makeMockR2();
    const res = await handleR2Proxy('/prefix/put', '/prefix', {
      key: 'my-key',
      encoding: 'base64',
    }, bucket);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Missing bodyBase64');
  });

  it('returns 400 when body is missing for text encoding', async () => {
    const bucket = makeMockR2();
    const res = await handleR2Proxy('/prefix/put', '/prefix', {
      key: 'my-key',
      encoding: 'text',
    }, bucket);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Missing body');
  });

  it('deletes a key from bucket', async () => {
    const bucket = makeMockR2();
    const res = await handleR2Proxy('/prefix/delete', '/prefix', { key: 'my-key' }, bucket);
    expect(res.status).toBe(200);
    expect(bucket.delete).toHaveBeenCalledWith('my-key');
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });

  it('lists objects from bucket', async () => {
    const bucket = makeMockR2();
    bucket.list.mockResolvedValue({ objects: [{ key: 'a' }], truncated: false });

    const res = await handleR2Proxy('/prefix/list', '/prefix', {}, bucket);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.objects).toEqual([{ key: 'a' }]);
  });

  it('returns head for a key', async () => {
    const bucket = makeMockR2();
    bucket.head.mockResolvedValue({ key: 'my-key', size: 100 });

    const res = await handleR2Proxy('/prefix/head', '/prefix', { key: 'my-key' }, bucket);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.key).toBe('my-key');
  });

  it('returns 404 for unknown R2 proxy subpath', async () => {
    const bucket = makeMockR2();
    const res = await handleR2Proxy('/prefix/unknown', '/prefix', { key: 'x' }, bucket);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toContain('Unknown R2 proxy path');
  });

  it('classifies R2 errors and returns appropriate status', async () => {
    const bucket = makeMockR2();
    bucket.get.mockRejectedValue(new Error('fetch failed'));

    const res = await handleR2Proxy('/prefix/get', '/prefix', { key: 'x' }, bucket);
    expect(res.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// handleVectorizeProxy
// ---------------------------------------------------------------------------

describe('handleVectorizeProxy', () => {
  it('returns 503 when VECTORIZE is not configured', async () => {
    const env = makeEnv({ VECTORIZE: undefined });
    const res = await handleVectorizeProxy('/proxy/vectorize/query', { vector: [1, 2] }, env);
    expect(res.status).toBe(503);
  });

  it('handles vectorize/query with a valid vector', async () => {
    const env = makeEnv();
    env.VECTORIZE.query.mockResolvedValue({ matches: [{ id: 'vec-1', score: 0.9 }] });

    const res = await handleVectorizeProxy('/proxy/vectorize/query', { vector: [0.1, 0.2, 0.3] }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.matches).toHaveLength(1);
  });

  it('returns 400 when vector is missing for vectorize/query', async () => {
    const env = makeEnv();
    const res = await handleVectorizeProxy('/proxy/vectorize/query', {}, env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Missing required "vector"');
  });

  it('handles vectorize/describe', async () => {
    const env = makeEnv();
    const res = await handleVectorizeProxy('/proxy/vectorize/describe', {}, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.dimensions).toBe(128);
  });

  it('handles vectorize/delete with ids', async () => {
    const env = makeEnv();
    const res = await handleVectorizeProxy('/proxy/vectorize/delete', { ids: ['a', 'b'] }, env);
    expect(res.status).toBe(200);
    expect(env.VECTORIZE.deleteByIds).toHaveBeenCalledWith(['a', 'b']);
  });

  it('returns 400 when ids is missing for vectorize/delete', async () => {
    const env = makeEnv();
    const res = await handleVectorizeProxy('/proxy/vectorize/delete', {}, env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Missing required "ids"');
  });

  it('returns 404 for unknown vectorize proxy path', async () => {
    const env = makeEnv();
    const res = await handleVectorizeProxy('/proxy/vectorize/unknown', {}, env);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// handleAiProxy
// ---------------------------------------------------------------------------

describe('handleAiProxy', () => {
  it('returns 503 when AI is not configured', async () => {
    const env = makeEnv({ AI: undefined });
    const res = await handleAiProxy('/proxy/ai/run', { model: 'm', inputs: {} }, env);
    expect(res.status).toBe(503);
  });

  it('handles ai/run with model and inputs', async () => {
    const env = makeEnv();
    env.AI.run.mockResolvedValue({ text: 'generated' });

    const res = await handleAiProxy('/proxy/ai/run', { model: '@cf/meta/llama', inputs: { prompt: 'hi' } }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.text).toBe('generated');
  });

  it('returns 404 for unknown ai proxy path', async () => {
    const env = makeEnv();
    const res = await handleAiProxy('/proxy/ai/unknown', { model: 'm', inputs: {} }, env);
    expect(res.status).toBe(404);
  });

  it('classifies AI errors correctly', async () => {
    const env = makeEnv();
    env.AI.run.mockRejectedValue(new TypeError('invalid input'));

    const res = await handleAiProxy('/proxy/ai/run', { model: 'm', inputs: {} }, env);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// handleQueueProxy
// ---------------------------------------------------------------------------

describe('handleQueueProxy', () => {
  it('returns 503 when INDEX_QUEUE is not configured', async () => {
    const env = makeEnv({ INDEX_QUEUE: undefined });
    const res = await handleQueueProxy('/proxy/queue/send', { queue: 'index', message: {} }, env);
    expect(res.status).toBe(503);
  });

  it('sends a message to the index queue', async () => {
    const env = makeEnv();
    const res = await handleQueueProxy('/proxy/queue/send', { queue: 'index', message: { type: 'indexJob' } }, env);
    expect(res.status).toBe(200);
    expect(env.INDEX_QUEUE.send).toHaveBeenCalledWith({ type: 'indexJob' });
  });

  it('sends a batch of messages to the index queue', async () => {
    const env = makeEnv();
    const messages = [{ body: { type: 'job1' } }, { body: { type: 'job2' } }];
    const res = await handleQueueProxy('/proxy/queue/send-batch', { queue: 'index', messages }, env);
    expect(res.status).toBe(200);
    expect(env.INDEX_QUEUE.sendBatch).toHaveBeenCalledWith(messages);
  });

  it('returns 403 for unknown queue name', async () => {
    const env = makeEnv();
    const res = await handleQueueProxy('/proxy/queue/send', { queue: 'other', message: {} }, env);
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toContain('Unknown queue');
  });

  it('returns 400 when messages array is missing for send-batch', async () => {
    const env = makeEnv();
    const res = await handleQueueProxy('/proxy/queue/send-batch', { queue: 'index' }, env);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown queue proxy path', async () => {
    const env = makeEnv();
    const res = await handleQueueProxy('/proxy/queue/unknown', { queue: 'index' }, env);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// handleRuntimeProxy / handleBrowserProxy / handleEgressProxy
// ---------------------------------------------------------------------------

describe('handleRuntimeProxy', () => {
  it('returns 503 when RUNTIME_HOST is not configured', async () => {
    const env = makeEnv({ RUNTIME_HOST: undefined });
    const res = await handleRuntimeProxy({ url: 'http://x', method: 'GET' }, env);
    expect(res.status).toBe(503);
  });

  it('forwards request to RUNTIME_HOST', async () => {
    const env = makeEnv();
    const res = await handleRuntimeProxy({ url: 'http://runtime/session/exec', method: 'POST', body: '{}' }, env);
    expect(res.status).toBe(200);
    expect(env.RUNTIME_HOST.fetch).toHaveBeenCalled();
  });
});

describe('handleBrowserProxy', () => {
  it('returns 503 when BROWSER_HOST is not configured', async () => {
    const env = makeEnv({ BROWSER_HOST: undefined });
    const res = await handleBrowserProxy({ url: 'http://x', method: 'GET' }, env);
    expect(res.status).toBe(503);
  });

  it('forwards request to BROWSER_HOST', async () => {
    const env = makeEnv();
    const res = await handleBrowserProxy({ url: 'http://browser/session/s1/goto', method: 'POST' }, env);
    expect(res.status).toBe(200);
    expect(env.BROWSER_HOST.fetch).toHaveBeenCalled();
  });
});

describe('handleEgressProxy', () => {
  it('forwards request to TAKOS_EGRESS', async () => {
    const env = makeEnv();
    const res = await handleEgressProxy({ url: 'https://api.example.com/data', method: 'GET' }, env);
    expect(res.status).toBe(200);
    expect(env.TAKOS_EGRESS.fetch).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleHeartbeat
// ---------------------------------------------------------------------------

describe('handleHeartbeat', () => {
  it('returns 400 when runId is missing', async () => {
    const env = makeEnv();
    const res = await handleHeartbeat({ workerId: 'w1' }, env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Missing runId or serviceId');
  });

  it('returns 400 when workerId is missing', async () => {
    const env = makeEnv();
    const res = await handleHeartbeat({ runId: 'r1' }, env);
    expect(res.status).toBe(400);
  });

  it('updates heartbeat with valid runId and workerId', async () => {
    const env = makeEnv();
    const res = await handleHeartbeat({ runId: 'run-1', workerId: 'worker-1' }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleRunReset
// ---------------------------------------------------------------------------

describe('handleRunReset', () => {
  it('returns 400 when runId is missing', async () => {
    const env = makeEnv();
    const res = await handleRunReset({ workerId: 'w1' }, env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when workerId is missing', async () => {
    const env = makeEnv();
    const res = await handleRunReset({ runId: 'r1' }, env);
    expect(res.status).toBe(400);
  });

  it('resets the run to queued status', async () => {
    const env = makeEnv();
    const res = await handleRunReset({ runId: 'run-1', workerId: 'worker-1' }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleNotifierProxy
// ---------------------------------------------------------------------------

describe('handleNotifierProxy', () => {
  it('returns 400 for unknown DO namespace', async () => {
    const env = makeEnv();
    const res = await handleNotifierProxy('/proxy/do/fetch', {
      namespace: 'UNKNOWN_NS',
      name: 'run-1',
      url: 'https://do/emit',
    }, env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('Unknown DO namespace');
  });

  it('returns 400 when url is missing', async () => {
    const env = makeEnv();
    const res = await handleNotifierProxy('/proxy/do/fetch', {
      namespace: 'RUN_NOTIFIER',
      name: 'run-1',
    }, env);
    expect(res.status).toBe(400);
  });

  it('returns 403 for disallowed DO paths', async () => {
    const env = makeEnv();
    const res = await handleNotifierProxy('/proxy/do/fetch', {
      namespace: 'RUN_NOTIFIER',
      name: 'run-1',
      url: 'https://do/admin',
    }, env);
    expect(res.status).toBe(403);
  });

  it('returns 403 for disallowed HTTP methods', async () => {
    const env = makeEnv();
    const res = await handleNotifierProxy('/proxy/do/fetch', {
      namespace: 'RUN_NOTIFIER',
      name: 'run-1',
      url: 'https://do/emit',
      method: 'DELETE',
    }, env);
    expect(res.status).toBe(403);
  });

  it('forwards valid DO fetch to RUN_NOTIFIER', async () => {
    const env = makeEnv();
    const res = await handleNotifierProxy('/proxy/do/fetch', {
      namespace: 'RUN_NOTIFIER',
      name: 'run-1',
      url: 'https://do/emit',
      method: 'POST',
      reqBody: '{"event":"test"}',
    }, env);
    expect(res.status).toBe(200);
    expect(env.RUN_NOTIFIER._stub.fetch).toHaveBeenCalled();
  });

  it('returns 400 for invalid URL', async () => {
    const env = makeEnv();
    const res = await handleNotifierProxy('/proxy/do/fetch', {
      namespace: 'RUN_NOTIFIER',
      name: 'run-1',
      url: 'not-a-valid-url',
    }, env);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown notifier proxy path', async () => {
    const env = makeEnv();
    const res = await handleNotifierProxy('/proxy/do/unknown', {}, env);
    expect(res.status).toBe(404);
  });
});
