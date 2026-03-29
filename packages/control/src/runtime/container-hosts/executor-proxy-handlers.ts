import type {
  DurableObjectNamespace,
  R2Bucket,
} from '../../shared/types/bindings.ts';
import type { IndexJobQueueMessage } from '../../shared/types';
import type { D1RawOptions } from './d1-raw';
import { executeD1RawStatement } from './d1-raw';
import { validateD1ProxySql } from '../../application/services/execution/sql-validation';
import { buildSanitizedDOHeaders } from '../durable-objects/do-header-utils';
import { getDb } from '../../infra/db';
import { runs } from '../../infra/db/schema';
import { eq, and } from 'drizzle-orm';
import { logError } from '../../shared/utils/logger';
import { ok, err, classifyProxyError, readRunServiceId, type AgentExecutorEnv } from './executor-utils';
import { base64ToBytes } from '../../shared/utils/encoding-utils';

type Env = AgentExecutorEnv;

interface AiRunBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

const MAX_PROXY_PUT_BYTES = 100 * 1024 * 1024; // 100MB

function headersToRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

function requireSql(sql: unknown, endpoint: string): Response | null {
  if (typeof sql !== 'string') return err(`Missing required "sql" parameter for ${endpoint}`, 400);
  const validation = validateD1ProxySql(sql);
  if (!validation.valid) return err(`SQL validation failed: ${validation.error}`, 400);
  return null;
}

/** Wraps handler logic with the shared try/catch + logError + classifyProxyError pattern. */
async function withProxyErrorHandler(
  label: string,
  fn: () => Promise<Response>,
): Promise<Response> {
  try {
    return await fn();
  } catch (e: unknown) {
    logError(`${label} error`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

function requireRunIdentity(body: Record<string, unknown>): { runId: string; serviceId: string } | Response {
  const runId = typeof body.runId === 'string' ? body.runId : null;
  const serviceId = readRunServiceId(body);
  if (!runId || !serviceId) return err('Missing runId or serviceId', 400);
  return { runId, serviceId };
}

export function handleDbProxy(path: string, body: Record<string, unknown>, env: Env): Promise<Response> {
  const { sql, params = [], statements, colName, rawOptions } = body as {
    sql?: string;
    params?: unknown[];
    statements?: { sql: string; params: unknown[] }[];
    colName?: string;
    rawOptions?: D1RawOptions;
  };

  return withProxyErrorHandler(`DB proxy on ${path}`, async () => {
    switch (path) {
      case '/proxy/db/first': {
        const bad = requireSql(sql, 'db/first');
        if (bad) return bad;
        const result = colName !== undefined
          ? await env.DB.prepare(sql!).bind(...params).first(colName)
          : await env.DB.prepare(sql!).bind(...params).first();
        return ok({ result });
      }
      case '/proxy/db/run': {
        const bad = requireSql(sql, 'db/run');
        if (bad) return bad;
        return ok(await env.DB.prepare(sql!).bind(...params).run());
      }
      case '/proxy/db/all': {
        const bad = requireSql(sql, 'db/all');
        if (bad) return bad;
        return ok(await env.DB.prepare(sql!).bind(...params).all());
      }
      case '/proxy/db/raw': {
        const bad = requireSql(sql, 'db/raw');
        if (bad) return bad;
        const statement = env.DB.prepare(sql!).bind(...params);
        const result = rawOptions?.columnNames
          ? await executeD1RawStatement(statement, { columnNames: true })
          : await executeD1RawStatement(statement);
        return ok({ results: result });
      }
      case '/proxy/db/batch': {
        if (!Array.isArray(statements)) return err('Missing required "statements" array for db/batch', 400);
        if (statements.length > 100) return err('Batch contains too many statements (max 100)', 400);
        for (const stmt of statements) {
          const validation = validateD1ProxySql(stmt.sql);
          if (!validation.valid) return err(`SQL validation failed: ${validation.error}`, 400);
        }
        const stmts = statements.map(({ sql: s, params: p }) => env.DB.prepare(s).bind(...p));
        return ok(await env.DB.batch(stmts));
      }
      case '/proxy/db/exec':
        return err('db/exec endpoint is disabled for security', 403);
      default:
        return err(`Unknown DB proxy path: ${path}`, 404);
    }
  });
}

export function handleR2Proxy(path: string, prefix: string, body: Record<string, unknown>, bucket: R2Bucket, rawRequest?: Request): Promise<Response> {
  const {
    key,
    body: legacyBody,
    bodyBase64,
    encoding,
    options,
  } = body as {
    key: string;
    body?: string;
    bodyBase64?: string;
    encoding?: 'text' | 'base64' | 'null';
    options?: Record<string, unknown>;
  };

  return withProxyErrorHandler(`R2 proxy on ${path}`, async () => {
    switch (path) {
      case `${prefix}/get`: {
        const obj = await bucket.get(key);
        if (!obj) return new Response(null, { status: 404 });
        return new Response(obj.body as ReadableStream, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(obj.size),
            'ETag': obj.etag,
            'Last-Modified': obj.uploaded.toUTCString(),
          },
        });
      }
      case `${prefix}/put`: {
        if (rawRequest) {
          const binaryKey = rawRequest.headers.get('X-R2-Key');
          if (!binaryKey) return err('Missing X-R2-Key header for binary PUT', 400);
          const optionsHeader = rawRequest.headers.get('X-R2-Options');
          const putOptions = optionsHeader ? JSON.parse(optionsHeader) : undefined;
          const contentLength = rawRequest.headers.get('Content-Length');
          if (contentLength && parseInt(contentLength, 10) > MAX_PROXY_PUT_BYTES) {
            return err(`Payload exceeds maximum size of ${MAX_PROXY_PUT_BYTES} bytes`, 413);
          }
          const binaryBody = await rawRequest.arrayBuffer();
          if (binaryBody.byteLength > MAX_PROXY_PUT_BYTES) {
            return err(`Payload exceeds maximum size of ${MAX_PROXY_PUT_BYTES} bytes`, 413);
          }
          return ok(await bucket.put(binaryKey, binaryBody, putOptions));
        }

        let value: string | ArrayBuffer | ArrayBufferView | null;
        if (encoding === 'null') {
          value = null;
        } else if (encoding === 'base64') {
          if (typeof bodyBase64 !== 'string') return err('Missing bodyBase64 for base64 payload', 400);
          value = base64ToBytes(bodyBase64);
        } else if (encoding === 'text') {
          if (typeof legacyBody !== 'string') return err('Missing body for text payload', 400);
          value = legacyBody;
        } else {
          value = legacyBody != null ? legacyBody : null;
        }

        if (value instanceof Uint8Array && value.byteLength > MAX_PROXY_PUT_BYTES) {
          return err(`Payload exceeds maximum size of ${MAX_PROXY_PUT_BYTES} bytes`, 413);
        }
        if (typeof value === 'string' && value.length > MAX_PROXY_PUT_BYTES) {
          return err(`Payload exceeds maximum size of ${MAX_PROXY_PUT_BYTES} bytes`, 413);
        }

        return ok(await bucket.put(key, value, options as Parameters<R2Bucket['put']>[2]));
      }
      case `${prefix}/delete`: {
        await bucket.delete(key);
        return ok({ success: true });
      }
      case `${prefix}/list`:
        return ok(await bucket.list(body as Parameters<R2Bucket['list']>[0]));
      case `${prefix}/head`:
        return ok(await bucket.head(key));
      default:
        return err(`Unknown R2 proxy path: ${path}`, 404);
    }
  });
}

export function handleNotifierProxy(path: string, body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    url,
    method = 'POST',
    headers: hdrs,
    reqBody,
    body: legacyBody,
  } = body as {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    reqBody?: string;
    body?: string;
  };

  return withProxyErrorHandler(`Notifier proxy on ${path}`, async () => {
    switch (path) {
      case '/proxy/do/fetch': {
        const { namespace, name } = body as { namespace: string; name: string };
        let ns: DurableObjectNamespace | undefined;
        if (namespace === 'RUN_NOTIFIER') {
          ns = env.RUN_NOTIFIER;
        }
        if (!ns) return err(`Unknown DO namespace: ${namespace}`, 400);
        if (!url) return err('Missing required "url" parameter for DO fetch', 400);
        try {
          const doUrl = new URL(url);
          const allowedPaths = ['/emit', '/events', '/state'];
          if (!allowedPaths.includes(doUrl.pathname)) {
            return err(`DO path ${doUrl.pathname} is not allowed`, 403);
          }
        } catch {
          return err('Invalid DO URL', 400);
        }
        const allowedMethods = ['POST', 'GET'];
        if (!allowedMethods.includes(method.toUpperCase())) {
          return err(`DO method ${method} is not allowed`, 403);
        }

        const id = ns.idFromName(name);
        const stub = ns.get(id);

        const sanitizedHeaders = buildSanitizedDOHeaders(hdrs, { 'X-Takos-Internal': '1', 'Content-Type': 'application/json' });
        const response = await stub.fetch(url, {
          method,
          headers: sanitizedHeaders,
          body: reqBody ?? legacyBody,
        });

        const responseBody = await response.text();
        return new Response(responseBody, {
          status: response.status,
          headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json' },
        });
      }
      default:
        return err(`Unknown notifier proxy path: ${path}`, 404);
    }
  });
}

export function handleVectorizeProxy(path: string, body: Record<string, unknown>, env: Env): Promise<Response> {
  if (!env.VECTORIZE) return Promise.resolve(err('VECTORIZE not configured', 503));
  const vectorize = env.VECTORIZE;

  const { vector, options, vectors, ids } = body as {
    vector?: number[];
    options?: Record<string, unknown>;
    vectors?: unknown[];
    ids?: string[];
  };

  return withProxyErrorHandler(`Vectorize proxy on ${path}`, async () => {
    switch (path) {
      case '/proxy/vectorize/query':
        if (!Array.isArray(vector)) return err('Missing required "vector" array for vectorize/query', 400);
        return ok(await vectorize.query(vector, options as Parameters<VectorizeIndex['query']>[1]));
      case '/proxy/vectorize/insert':
        return ok(await vectorize.insert(vectors as Parameters<VectorizeIndex['insert']>[0]));
      case '/proxy/vectorize/upsert':
        return ok(await vectorize.upsert(vectors as Parameters<VectorizeIndex['upsert']>[0]));
      case '/proxy/vectorize/delete':
        if (!Array.isArray(ids)) return err('Missing required "ids" array for vectorize/delete', 400);
        return ok(await vectorize.deleteByIds(ids));
      case '/proxy/vectorize/get':
        if (!Array.isArray(ids)) return err('Missing required "ids" array for vectorize/get', 400);
        return ok(await vectorize.getByIds(ids));
      case '/proxy/vectorize/describe':
        return ok(await vectorize.describe());
      default:
        return err(`Unknown vectorize proxy path: ${path}`, 404);
    }
  });
}

export function handleAiProxy(path: string, body: Record<string, unknown>, env: Env): Promise<Response> {
  if (!env.AI) return Promise.resolve(err('AI not configured', 503));

  return withProxyErrorHandler(`AI proxy on ${path}`, async () => {
    const { model, inputs } = body as { model: string; inputs: Record<string, unknown> };
    switch (path) {
      case '/proxy/ai/run':
        return ok(await (env.AI as AiRunBinding).run(model, inputs));
      default:
        return err(`Unknown AI proxy path: ${path}`, 404);
    }
  });
}

type Fetcher = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };

function forwardProxy(
  label: string,
  fetcher: Fetcher,
  body: Record<string, unknown>,
): Promise<Response> {
  const { url, method = 'GET', headers: hdrs, body: reqBody } = body as {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };

  return withProxyErrorHandler(`${label} proxy`, async () => {
    const reqHeaders = new Headers(buildSanitizedDOHeaders(hdrs, {}));
    reqHeaders.set('X-Takos-Internal', '1');
    const res = await fetcher.fetch(new Request(url, {
      method,
      headers: headersToRecord(reqHeaders),
      body: reqBody,
    }));
    return new Response(res.body, { status: res.status, headers: res.headers });
  });
}

export function handleEgressProxy(body: Record<string, unknown>, env: Env): Promise<Response> {
  return forwardProxy('Egress', env.TAKOS_EGRESS, body);
}

export function handleRuntimeProxy(body: Record<string, unknown>, env: Env): Promise<Response> {
  if (!env.RUNTIME_HOST) return Promise.resolve(err('RUNTIME_HOST not configured', 503));
  return forwardProxy('Runtime', env.RUNTIME_HOST, body);
}

export function handleBrowserProxy(body: Record<string, unknown>, env: Env): Promise<Response> {
  if (!env.BROWSER_HOST) return Promise.resolve(err('BROWSER_HOST not configured', 503));
  return forwardProxy('Browser', env.BROWSER_HOST, body);
}

export function handleQueueProxy(path: string, body: Record<string, unknown>, env: Env): Promise<Response> {
  if (!env.INDEX_QUEUE) return Promise.resolve(err('INDEX_QUEUE not configured', 503));

  const { queue, message, messages } = body as {
    queue?: string;
    message?: unknown;
    messages?: { body: unknown }[];
  };
  if (queue !== 'index') return Promise.resolve(err('Unknown queue', 403));

  return withProxyErrorHandler(`Queue proxy on ${path}`, async () => {
    switch (path) {
      case '/proxy/queue/send':
        await env.INDEX_QUEUE!.send(message as IndexJobQueueMessage);
        return ok({ success: true });
      case '/proxy/queue/send-batch':
        if (!Array.isArray(messages)) return err('Missing required "messages" array for queue/send-batch', 400);
        await env.INDEX_QUEUE!.sendBatch(messages as { body: IndexJobQueueMessage }[]);
        return ok({ success: true });
      default:
        return err(`Unknown queue proxy path: ${path}`, 404);
    }
  });
}

export function handleHeartbeat(body: Record<string, unknown>, env: Env): Promise<Response> {
  const identity = requireRunIdentity(body);
  if (identity instanceof Response) return Promise.resolve(identity);

  return withProxyErrorHandler('Heartbeat', async () => {
    const db = getDb(env.DB);
    const now = new Date().toISOString();
    await db.update(runs)
      .set({ serviceHeartbeat: now })
      .where(and(eq(runs.id, identity.runId), eq(runs.serviceId, identity.serviceId)));
    return ok({ success: true });
  });
}

export function handleRunReset(body: Record<string, unknown>, env: Env): Promise<Response> {
  const identity = requireRunIdentity(body);
  if (identity instanceof Response) return Promise.resolve(identity);

  return withProxyErrorHandler('Run reset', async () => {
    const db = getDb(env.DB);
    await db.update(runs)
      .set({ status: 'queued', serviceId: null, serviceHeartbeat: null })
      .where(and(eq(runs.id, identity.runId), eq(runs.serviceId, identity.serviceId), eq(runs.status, 'running')));
    return ok({ success: true });
  });
}
