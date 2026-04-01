/**
 * Tests for executor-proxy-handlers: individual proxy handler functions,
 * error classification, and helper utilities.
 *
 * The integration-level proxy tests (via executor-host.fetch) live in
 * executor-host.test.ts. This file tests the exported functions directly.
 */
// [Deno] vi.mock removed - manually stub imports from '@/services/execution/sql-validation'
// [Deno] vi.mock removed - manually stub imports from '@/container-hosts/d1-raw'
// [Deno] vi.mock removed - manually stub imports from '@/durable-objects/shared'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
import { classifyProxyError, err, ok } from "@/container-hosts/executor-utils";
import {
  handleAiProxy,
  handleBrowserProxy,
  handleDbProxy,
  handleEgressProxy,
  handleHeartbeat,
  handleNotifierProxy,
  handleQueueProxy,
  handleR2Proxy,
  handleRunReset,
  handleRuntimeProxy,
  handleVectorizeProxy,
} from "@/container-hosts/executor-proxy-handlers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { assertSpyCallArgs, spy } from "jsr:@std/testing/mock";

function makeMockD1(): any {
  const stmt = {
    bind: function (this: any) {
      return this;
    },
    first: async () => null,
    all: async () => ({ results: [], success: true, meta: {} }),
    run: async () => ({ success: true, meta: { changes: 1 } }),
    raw: async () => [],
  };
  return {
    prepare: () => stmt,
    batch: async () => [],
    exec: ((..._args: any[]) => undefined) as any,
    _stmt: stmt,
  };
}

function makeMockR2(): any {
  return {
    get: spy(async () => null),
    put: spy(async () => ({
      key: "k",
      size: 0,
      etag: "etag",
      uploaded: new Date(),
    })),
    delete: spy(async () => undefined),
    list: spy(async () => ({ objects: [], truncated: false })),
    head: spy(async () => null),
  };
}

function makeMockDONamespace(): any {
  const stub = {
    fetch: spy(async () =>
      new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      })
    ),
  };
  return {
    idFromName: () => ({ toString: () => "do-id" }),
    get: () => stub,
    _stub: stub,
  };
}

function makeMockVectorize(): any {
  return {
    query: spy(async () => ({ matches: [] })),
    insert: spy(async () => undefined),
    upsert: spy(async () => undefined),
    deleteByIds: spy(async () => undefined),
    getByIds: spy(async () => []),
    describe: spy(async () => ({ dimensions: 128 })),
  };
}

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    DB: makeMockD1(),
    RUN_NOTIFIER: makeMockDONamespace(),
    TAKOS_OFFLOAD: makeMockR2(),
    GIT_OBJECTS: makeMockR2(),
    TAKOS_EGRESS: {
      fetch: spy(async () => new Response("ok", { status: 200 })),
    },
    RUNTIME_HOST: {
      fetch: spy(async () => new Response("ok", { status: 200 })),
    },
    BROWSER_HOST: {
      fetch: spy(async () => new Response("ok", { status: 200 })),
    },
    INDEX_QUEUE: {
      send: spy((..._args: any[]) => undefined),
      sendBatch: spy((..._args: any[]) => undefined),
    },
    VECTORIZE: makeMockVectorize(),
    AI: { run: spy(async () => ({ result: "ai-output" })) },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ok / err response helpers
// ---------------------------------------------------------------------------

Deno.test("ok - returns a 200 JSON response with serialized data", async () => {
  const response = ok({ foo: "bar", count: 42 });
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "application/json");
  const body = await response.json();
  assertEquals(body, { foo: "bar", count: 42 });
});
Deno.test("ok - serializes null data", async () => {
  const response = ok(null);
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body, null);
});

Deno.test("err - returns a 500 JSON error by default", async () => {
  const response = err("Something went wrong");
  assertEquals(response.status, 500);
  assertEquals(response.headers.get("Content-Type"), "application/json");
  const body = await response.json() as any;
  assertEquals(body.error, "Something went wrong");
});
Deno.test("err - accepts a custom status code", async () => {
  const response = err("Not found", 404);
  assertEquals(response.status, 404);
  const body = await response.json() as any;
  assertEquals(body.error, "Not found");
});
// ---------------------------------------------------------------------------
// classifyProxyError
// ---------------------------------------------------------------------------

Deno.test("classifyProxyError - classifies AbortError as 504 timeout", () => {
  const e = new DOMException("Request aborted", "AbortError");
  const result = classifyProxyError(e);
  assertEquals(result.status, 504);
  assertStringIncludes(result.message, "timed out");
});
Deno.test("classifyProxyError - classifies TimeoutError by name as 504", () => {
  const e = new DOMException("Timed out", "TimeoutError");
  const result = classifyProxyError(e);
  assertEquals(result.status, 504);
});
Deno.test('classifyProxyError - classifies "timed out" in message as 504', () => {
  const result = classifyProxyError(new Error("The request timed out"));
  assertEquals(result.status, 504);
});
Deno.test("classifyProxyError - classifies SQLITE_BUSY as 503", () => {
  const result = classifyProxyError(
    new Error("SQLITE_BUSY: database is locked"),
  );
  assertEquals(result.status, 503);
  assertStringIncludes(result.message, "busy");
});
Deno.test('classifyProxyError - classifies "database is locked" as 503', () => {
  const result = classifyProxyError(new Error("database is locked"));
  assertEquals(result.status, 503);
});
Deno.test("classifyProxyError - classifies SQLITE_CONSTRAINT as 409", () => {
  const result = classifyProxyError(
    new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed"),
  );
  assertEquals(result.status, 409);
  assertStringIncludes(result.message, "constraint");
});
Deno.test("classifyProxyError - classifies SQLITE_ERROR as 400", () => {
  const result = classifyProxyError(
    new Error("SQLITE_ERROR: near syntax error"),
  );
  assertEquals(result.status, 400);
  assertStringIncludes(result.message, "query error");
});
Deno.test("classifyProxyError - classifies D1_ERROR as 400", () => {
  const result = classifyProxyError(new Error("D1_ERROR: something failed"));
  assertEquals(result.status, 400);
});
Deno.test("classifyProxyError - classifies NetworkError as 502", () => {
  const e = new Error("fetch failed");
  (e as any).name = "NetworkError";
  const result = classifyProxyError(e);
  assertEquals(result.status, 502);
  assertStringIncludes(result.message, "connection failed");
});
Deno.test("classifyProxyError - classifies ECONNREFUSED as 502", () => {
  const result = classifyProxyError(
    new Error("connect ECONNREFUSED 127.0.0.1:8080"),
  );
  assertEquals(result.status, 502);
});
Deno.test("classifyProxyError - classifies ECONNRESET as 502", () => {
  const result = classifyProxyError(new Error("read ECONNRESET"));
  assertEquals(result.status, 502);
});
Deno.test("classifyProxyError - classifies TypeError as 400", () => {
  const result = classifyProxyError(new TypeError("Cannot read property x"));
  assertEquals(result.status, 400);
  assertEquals(result.message, "Invalid request");
});
Deno.test("classifyProxyError - classifies RangeError as 400", () => {
  const result = classifyProxyError(new RangeError("Value out of range"));
  assertEquals(result.status, 400);
});
Deno.test("classifyProxyError - returns 500 for unknown errors", () => {
  const result = classifyProxyError(new Error("Unexpected"));
  assertEquals(result.status, 500);
  assertEquals(result.message, "Internal proxy error");
});
Deno.test("classifyProxyError - handles non-Error values", () => {
  const result = classifyProxyError("string error");
  assertEquals(result.status, 500);
  assertEquals(result.message, "Internal proxy error");
});
// ---------------------------------------------------------------------------
// handleDbProxy
// ---------------------------------------------------------------------------

Deno.test("handleDbProxy - handles db/first and returns the result", async () => {
  const env = makeEnv();
  env.DB._stmt.first = (async () => ({ id: 1 })) as any;

  const res = await handleDbProxy("/proxy/db/first", {
    sql: "SELECT 1",
    params: [],
  }, env);
  assertEquals(res.status, 200);
  const body = await res.json() as any;
  assertEquals(body.result, { id: 1 });
});
Deno.test("handleDbProxy - handles db/first with colName", async () => {
  const env = makeEnv();
  env.DB._stmt.first = (async () => "hello") as any;

  const res = await handleDbProxy("/proxy/db/first", {
    sql: "SELECT name",
    params: [],
    colName: "name",
  }, env);
  assertEquals(res.status, 200);
  const body = await res.json() as any;
  assertEquals(body.result, "hello");
});
Deno.test("handleDbProxy - returns 400 when sql is missing for db/first", async () => {
  const env = makeEnv();
  const res = await handleDbProxy("/proxy/db/first", { params: [] }, env);
  assertEquals(res.status, 400);
  const body = await res.json() as any;
  assertStringIncludes(body.error, 'Missing required "sql"');
});
Deno.test("handleDbProxy - returns 400 for SQL validation failure", async () => {
  const env = makeEnv();
  const res = await handleDbProxy("/proxy/db/run", {
    sql: "PRAGMA table_info(x)",
    params: [],
  }, env);
  assertEquals(res.status, 400);
  const body = await res.json() as any;
  assertStringIncludes(body.error, "SQL validation failed");
});
Deno.test("handleDbProxy - handles db/run with valid SQL", async () => {
  const env = makeEnv();
  const res = await handleDbProxy("/proxy/db/run", {
    sql: "INSERT INTO t(id) VALUES (?)",
    params: [1],
  }, env);
  assertEquals(res.status, 200);
});
Deno.test("handleDbProxy - handles db/all with valid SQL", async () => {
  const env = makeEnv();
  env.DB._stmt.all =
    (async () => ({ results: [{ id: 1 }], success: true, meta: {} })) as any;

  const res = await handleDbProxy("/proxy/db/all", {
    sql: "SELECT * FROM t",
    params: [],
  }, env);
  assertEquals(res.status, 200);
  const body = await res.json() as any;
  assertEquals(body.results, [{ id: 1 }]);
});
Deno.test("handleDbProxy - handles db/batch with valid statements", async () => {
  const env = makeEnv();
  env.DB.batch = (async () => [{ success: true }]) as any;

  const res = await handleDbProxy("/proxy/db/batch", {
    statements: [
      { sql: "INSERT INTO t(id) VALUES (?)", params: [1] },
      { sql: "INSERT INTO t(id) VALUES (?)", params: [2] },
    ],
  }, env);
  assertEquals(res.status, 200);
});
Deno.test("handleDbProxy - returns 400 when batch statements is missing", async () => {
  const env = makeEnv();
  const res = await handleDbProxy("/proxy/db/batch", {}, env);
  assertEquals(res.status, 400);
  const body = await res.json() as any;
  assertStringIncludes(body.error, 'Missing required "statements"');
});
Deno.test("handleDbProxy - returns 400 when batch exceeds 100 statements", async () => {
  const env = makeEnv();
  const statements = Array.from({ length: 101 }, (_, i) => ({
    sql: `INSERT INTO t(id) VALUES (${i})`,
    params: [],
  }));
  const res = await handleDbProxy("/proxy/db/batch", { statements }, env);
  assertEquals(res.status, 400);
  const body = await res.json() as any;
  assertStringIncludes(body.error, "too many statements");
});
Deno.test("handleDbProxy - blocks db/exec with 403", async () => {
  const env = makeEnv();
  const res = await handleDbProxy("/proxy/db/exec", {
    sql: "CREATE TABLE t(id INT)",
  }, env);
  assertEquals(res.status, 403);
  const body = await res.json() as any;
  assertStringIncludes(body.error, "disabled for security");
});
Deno.test("handleDbProxy - returns 404 for unknown db proxy subpath", async () => {
  const env = makeEnv();
  const res = await handleDbProxy(
    "/proxy/db/unknown",
    { sql: "SELECT 1" },
    env,
  );
  assertEquals(res.status, 404);
  const body = await res.json() as any;
  assertStringIncludes(body.error, "Unknown DB proxy path");
});
Deno.test("handleDbProxy - classifies D1 errors and returns appropriate status", async () => {
  const env = makeEnv();
  env.DB._stmt.first = (async () => {
    throw new Error("SQLITE_CONSTRAINT: UNIQUE");
  }) as any;

  const res = await handleDbProxy("/proxy/db/first", {
    sql: "SELECT 1",
    params: [],
  }, env);
  assertEquals(res.status, 409);
});
// ---------------------------------------------------------------------------
// handleR2Proxy
// ---------------------------------------------------------------------------

Deno.test("handleR2Proxy - returns 404 when object is not found on get", async () => {
  const bucket = makeMockR2();
  bucket.get = (async () => null) as any;

  const res = await handleR2Proxy(
    "/prefix/get",
    "/prefix",
    { key: "missing" },
    bucket,
  );
  assertEquals(res.status, 404);
});
Deno.test("handleR2Proxy - returns object body on successful get", async () => {
  const bucket = makeMockR2();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data"));
      controller.close();
    },
  });
  bucket.get = (async () => ({
    body: stream,
    size: 4,
    etag: '"abc"',
    uploaded: new Date("2024-01-01"),
  })) as any;

  const res = await handleR2Proxy(
    "/prefix/get",
    "/prefix",
    { key: "my-key" },
    bucket,
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/octet-stream");
  assertEquals(res.headers.get("ETag"), '"abc"');
});
Deno.test("handleR2Proxy - puts text data to bucket", async () => {
  const bucket = makeMockR2();
  const res = await handleR2Proxy("/prefix/put", "/prefix", {
    key: "my-key",
    body: "hello world",
    encoding: "text",
  }, bucket);
  assertEquals(res.status, 200);
  assertSpyCallArgs(bucket.put, 0, ["my-key", "hello world", undefined]);
});
Deno.test("handleR2Proxy - returns 400 when bodyBase64 is missing for base64 encoding", async () => {
  const bucket = makeMockR2();
  const res = await handleR2Proxy("/prefix/put", "/prefix", {
    key: "my-key",
    encoding: "base64",
  }, bucket);
  assertEquals(res.status, 400);
  const body = await res.json() as any;
  assertStringIncludes(body.error, "Missing bodyBase64");
});
Deno.test("handleR2Proxy - returns 400 when body is missing for text encoding", async () => {
  const bucket = makeMockR2();
  const res = await handleR2Proxy("/prefix/put", "/prefix", {
    key: "my-key",
    encoding: "text",
  }, bucket);
  assertEquals(res.status, 400);
  const body = await res.json() as any;
  assertStringIncludes(body.error, "Missing body");
});
Deno.test("handleR2Proxy - deletes a key from bucket", async () => {
  const bucket = makeMockR2();
  const res = await handleR2Proxy("/prefix/delete", "/prefix", {
    key: "my-key",
  }, bucket);
  assertEquals(res.status, 200);
  assertSpyCallArgs(bucket.delete, 0, ["my-key"]);
  const body = await res.json() as any;
  assertEquals(body.success, true);
});
Deno.test("handleR2Proxy - lists objects from bucket", async () => {
  const bucket = makeMockR2();
  bucket.list =
    (async () => ({ objects: [{ key: "a" }], truncated: false })) as any;

  const res = await handleR2Proxy("/prefix/list", "/prefix", {}, bucket);
  assertEquals(res.status, 200);
  const body = await res.json() as any;
  assertEquals(body.objects, [{ key: "a" }]);
});
Deno.test("handleR2Proxy - returns head for a key", async () => {
  const bucket = makeMockR2();
  bucket.head = (async () => ({ key: "my-key", size: 100 })) as any;

  const res = await handleR2Proxy(
    "/prefix/head",
    "/prefix",
    { key: "my-key" },
    bucket,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as any;
  assertEquals(body.key, "my-key");
});
Deno.test("handleR2Proxy - returns 404 for unknown R2 proxy subpath", async () => {
  const bucket = makeMockR2();
  const res = await handleR2Proxy(
    "/prefix/unknown",
    "/prefix",
    { key: "x" },
    bucket,
  );
  assertEquals(res.status, 404);
  const body = await res.json() as any;
  assertStringIncludes(body.error, "Unknown R2 proxy path");
});
Deno.test("handleR2Proxy - classifies R2 errors and returns appropriate status", async () => {
  const bucket = makeMockR2();
  bucket.get = (async () => {
    throw new Error("fetch failed");
  }) as any;

  const res = await handleR2Proxy(
    "/prefix/get",
    "/prefix",
    { key: "x" },
    bucket,
  );
  assertEquals(res.status, 502);
});
// ---------------------------------------------------------------------------
// handleVectorizeProxy
// ---------------------------------------------------------------------------

Deno.test("handleVectorizeProxy - returns 503 when VECTORIZE is not configured", async () => {
  const env = makeEnv({ VECTORIZE: undefined });
  const res = await handleVectorizeProxy("/proxy/vectorize/query", {
    vector: [1, 2],
  }, env);
  assertEquals(res.status, 503);
});
Deno.test("handleVectorizeProxy - handles vectorize/query with a valid vector", async () => {
  const env = makeEnv();
  env.VECTORIZE.query =
    (async () => ({ matches: [{ id: "vec-1", score: 0.9 }] })) as any;

  const res = await handleVectorizeProxy("/proxy/vectorize/query", {
    vector: [0.1, 0.2, 0.3],
  }, env);
  assertEquals(res.status, 200);
  const body = await res.json() as any;
  assertEquals(body.matches.length, 1);
});
Deno.test("handleVectorizeProxy - returns 400 when vector is missing for vectorize/query", async () => {
  const env = makeEnv();
  const res = await handleVectorizeProxy("/proxy/vectorize/query", {}, env);
  assertEquals(res.status, 400);
  const body = await res.json() as any;
  assertStringIncludes(body.error, 'Missing required "vector"');
});
Deno.test("handleVectorizeProxy - handles vectorize/describe", async () => {
  const env = makeEnv();
  const res = await handleVectorizeProxy("/proxy/vectorize/describe", {}, env);
  assertEquals(res.status, 200);
  const body = await res.json() as any;
  assertEquals(body.dimensions, 128);
});
Deno.test("handleVectorizeProxy - handles vectorize/delete with ids", async () => {
  const env = makeEnv();
  const res = await handleVectorizeProxy("/proxy/vectorize/delete", {
    ids: ["a", "b"],
  }, env);
  assertEquals(res.status, 200);
  assertSpyCallArgs(env.VECTORIZE.deleteByIds, 0, [["a", "b"]]);
});
Deno.test("handleVectorizeProxy - returns 400 when ids is missing for vectorize/delete", async () => {
  const env = makeEnv();
  const res = await handleVectorizeProxy("/proxy/vectorize/delete", {}, env);
  assertEquals(res.status, 400);
  const body = await res.json() as any;
  assertStringIncludes(body.error, 'Missing required "ids"');
});
Deno.test("handleVectorizeProxy - returns 404 for unknown vectorize proxy path", async () => {
  const env = makeEnv();
  const res = await handleVectorizeProxy("/proxy/vectorize/unknown", {}, env);
  assertEquals(res.status, 404);
});
// ---------------------------------------------------------------------------
// handleAiProxy
// ---------------------------------------------------------------------------

Deno.test("handleAiProxy - returns 503 when AI is not configured", async () => {
  const env = makeEnv({ AI: undefined });
  const res = await handleAiProxy(
    "/proxy/ai/run",
    { model: "m", inputs: {} },
    env,
  );
  assertEquals(res.status, 503);
});
Deno.test("handleAiProxy - handles ai/run with model and inputs", async () => {
  const env = makeEnv();
  env.AI.run = (async () => ({ text: "generated" })) as any;

  const res = await handleAiProxy("/proxy/ai/run", {
    model: "@cf/meta/llama",
    inputs: { prompt: "hi" },
  }, env);
  assertEquals(res.status, 200);
  const body = await res.json() as any;
  assertEquals(body.text, "generated");
});
Deno.test("handleAiProxy - returns 404 for unknown ai proxy path", async () => {
  const env = makeEnv();
  const res = await handleAiProxy("/proxy/ai/unknown", {
    model: "m",
    inputs: {},
  }, env);
  assertEquals(res.status, 404);
});
Deno.test("handleAiProxy - classifies AI errors correctly", async () => {
  const env = makeEnv();
  env.AI.run = (async () => {
    throw new TypeError("invalid input");
  }) as any;

  const res = await handleAiProxy(
    "/proxy/ai/run",
    { model: "m", inputs: {} },
    env,
  );
  assertEquals(res.status, 400);
});
// ---------------------------------------------------------------------------
// handleQueueProxy
// ---------------------------------------------------------------------------

Deno.test("handleQueueProxy - returns 503 when INDEX_QUEUE is not configured", async () => {
  const env = makeEnv({ INDEX_QUEUE: undefined });
  const res = await handleQueueProxy("/proxy/queue/send", {
    queue: "index",
    message: {},
  }, env);
  assertEquals(res.status, 503);
});
Deno.test("handleQueueProxy - sends a message to the index queue", async () => {
  const env = makeEnv();
  const res = await handleQueueProxy("/proxy/queue/send", {
    queue: "index",
    message: { type: "indexJob" },
  }, env);
  assertEquals(res.status, 200);
  assertSpyCallArgs(env.INDEX_QUEUE.send, 0, [{ type: "indexJob" }]);
});
Deno.test("handleQueueProxy - sends a batch of messages to the index queue", async () => {
  const env = makeEnv();
  const messages = [{ body: { type: "job1" } }, { body: { type: "job2" } }];
  const res = await handleQueueProxy("/proxy/queue/send-batch", {
    queue: "index",
    messages,
  }, env);
  assertEquals(res.status, 200);
  assertSpyCallArgs(env.INDEX_QUEUE.sendBatch, 0, [messages]);
});
Deno.test("handleQueueProxy - returns 403 for unknown queue name", async () => {
  const env = makeEnv();
  const res = await handleQueueProxy("/proxy/queue/send", {
    queue: "other",
    message: {},
  }, env);
  assertEquals(res.status, 403);
  const body = await res.json() as any;
  assertStringIncludes(body.error, "Unknown queue");
});
Deno.test("handleQueueProxy - returns 400 when messages array is missing for send-batch", async () => {
  const env = makeEnv();
  const res = await handleQueueProxy("/proxy/queue/send-batch", {
    queue: "index",
  }, env);
  assertEquals(res.status, 400);
});
Deno.test("handleQueueProxy - returns 404 for unknown queue proxy path", async () => {
  const env = makeEnv();
  const res = await handleQueueProxy(
    "/proxy/queue/unknown",
    { queue: "index" },
    env,
  );
  assertEquals(res.status, 404);
});
// ---------------------------------------------------------------------------
// handleRuntimeProxy / handleBrowserProxy / handleEgressProxy
// ---------------------------------------------------------------------------

Deno.test("handleRuntimeProxy - returns 503 when RUNTIME_HOST is not configured", async () => {
  const env = makeEnv({ RUNTIME_HOST: undefined });
  const res = await handleRuntimeProxy({ url: "http://x", method: "GET" }, env);
  assertEquals(res.status, 503);
});
Deno.test("handleRuntimeProxy - forwards request to RUNTIME_HOST", async () => {
  const env = makeEnv();
  const res = await handleRuntimeProxy({
    url: "http://runtime/session/exec",
    method: "POST",
    body: "{}",
  }, env);
  assertEquals(res.status, 200);
  assert(env.RUNTIME_HOST.fetch.calls.length > 0);
});

Deno.test("handleBrowserProxy - returns 503 when BROWSER_HOST is not configured", async () => {
  const env = makeEnv({ BROWSER_HOST: undefined });
  const res = await handleBrowserProxy({ url: "http://x", method: "GET" }, env);
  assertEquals(res.status, 503);
});
Deno.test("handleBrowserProxy - forwards request to BROWSER_HOST", async () => {
  const env = makeEnv();
  const res = await handleBrowserProxy({
    url: "http://browser/session/s1/goto",
    method: "POST",
  }, env);
  assertEquals(res.status, 200);
  assert(env.BROWSER_HOST.fetch.calls.length > 0);
});

Deno.test("handleEgressProxy - forwards request to TAKOS_EGRESS", async () => {
  const env = makeEnv();
  const res = await handleEgressProxy({
    url: "https://api.example.com/data",
    method: "GET",
  }, env);
  assertEquals(res.status, 200);
  assert(env.TAKOS_EGRESS.fetch.calls.length > 0);
});
// ---------------------------------------------------------------------------
// handleHeartbeat
// ---------------------------------------------------------------------------

Deno.test("handleHeartbeat - returns 400 when runId is missing", async () => {
  const env = makeEnv();
  const res = await handleHeartbeat({ workerId: "w1" }, env);
  assertEquals(res.status, 400);
  const body = await res.json() as any;
  assertStringIncludes(body.error, "Missing runId or serviceId");
});
Deno.test("handleHeartbeat - returns 400 when workerId is missing", async () => {
  const env = makeEnv();
  const res = await handleHeartbeat({ runId: "r1" }, env);
  assertEquals(res.status, 400);
});
Deno.test("handleHeartbeat - updates heartbeat with valid runId and workerId", async () => {
  const env = makeEnv();
  const res = await handleHeartbeat(
    { runId: "run-1", workerId: "worker-1" },
    env,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as any;
  assertEquals(body.success, true);
});
// ---------------------------------------------------------------------------
// handleRunReset
// ---------------------------------------------------------------------------

Deno.test("handleRunReset - returns 400 when runId is missing", async () => {
  const env = makeEnv();
  const res = await handleRunReset({ workerId: "w1" }, env);
  assertEquals(res.status, 400);
});
Deno.test("handleRunReset - returns 400 when workerId is missing", async () => {
  const env = makeEnv();
  const res = await handleRunReset({ runId: "r1" }, env);
  assertEquals(res.status, 400);
});
Deno.test("handleRunReset - resets the run to queued status", async () => {
  const env = makeEnv();
  const res = await handleRunReset(
    { runId: "run-1", workerId: "worker-1" },
    env,
  );
  assertEquals(res.status, 200);
  const body = await res.json() as any;
  assertEquals(body.success, true);
});
// ---------------------------------------------------------------------------
// handleNotifierProxy
// ---------------------------------------------------------------------------

Deno.test("handleNotifierProxy - returns 400 for unknown DO namespace", async () => {
  const env = makeEnv();
  const res = await handleNotifierProxy("/proxy/do/fetch", {
    namespace: "UNKNOWN_NS",
    name: "run-1",
    url: "https://do/emit",
  }, env);
  assertEquals(res.status, 400);
  const body = await res.json() as any;
  assertStringIncludes(body.error, "Unknown DO namespace");
});
Deno.test("handleNotifierProxy - returns 400 when url is missing", async () => {
  const env = makeEnv();
  const res = await handleNotifierProxy("/proxy/do/fetch", {
    namespace: "RUN_NOTIFIER",
    name: "run-1",
  }, env);
  assertEquals(res.status, 400);
});
Deno.test("handleNotifierProxy - returns 403 for disallowed DO paths", async () => {
  const env = makeEnv();
  const res = await handleNotifierProxy("/proxy/do/fetch", {
    namespace: "RUN_NOTIFIER",
    name: "run-1",
    url: "https://do/admin",
  }, env);
  assertEquals(res.status, 403);
});
Deno.test("handleNotifierProxy - returns 403 for disallowed HTTP methods", async () => {
  const env = makeEnv();
  const res = await handleNotifierProxy("/proxy/do/fetch", {
    namespace: "RUN_NOTIFIER",
    name: "run-1",
    url: "https://do/emit",
    method: "DELETE",
  }, env);
  assertEquals(res.status, 403);
});
Deno.test("handleNotifierProxy - forwards valid DO fetch to RUN_NOTIFIER", async () => {
  const env = makeEnv();
  const res = await handleNotifierProxy("/proxy/do/fetch", {
    namespace: "RUN_NOTIFIER",
    name: "run-1",
    url: "https://do/emit",
    method: "POST",
    reqBody: '{"event":"test"}',
  }, env);
  assertEquals(res.status, 200);
  assert(env.RUN_NOTIFIER._stub.fetch.calls.length > 0);
});
Deno.test("handleNotifierProxy - returns 400 for invalid URL", async () => {
  const env = makeEnv();
  const res = await handleNotifierProxy("/proxy/do/fetch", {
    namespace: "RUN_NOTIFIER",
    name: "run-1",
    url: "not-a-valid-url",
  }, env);
  assertEquals(res.status, 400);
});
Deno.test("handleNotifierProxy - returns 404 for unknown notifier proxy path", async () => {
  const env = makeEnv();
  const res = await handleNotifierProxy("/proxy/do/unknown", {}, env);
  assertEquals(res.status, 404);
});
