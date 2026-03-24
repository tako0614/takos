/**
 * takos-executor-host Worker
 *
 * Hosts TakosAgentExecutorContainer (CF Containers DO sidecar) and exposes
 * /proxy/* endpoints that the container calls for every CF binding operation.
 *
 * Architecture:
 *   takos-runner → POST /dispatch → this worker → container.dispatchStart(...)
 *   container → POST /proxy/db/* → this worker → env.DB (real D1)
 *   container → POST /proxy/offload/* → this worker → env.TAKOS_OFFLOAD (real R2)
 *   container → POST /proxy/git-objects/* → this worker → env.GIT_OBJECTS (real R2)
 *   container → POST /proxy/vectorize/* → this worker → env.VECTORIZE
 *   container → POST /proxy/ai/* → this worker → env.AI
 *   container → POST /proxy/egress/* → this worker → env.TAKOS_EGRESS
 *   container → POST /proxy/queue/* → this worker → env.INDEX_QUEUE
 *   container → POST /proxy/heartbeat → this worker → env.DB (UPDATE runs SET serviceHeartbeat)
 *   container → POST /proxy/run/status → this worker → env.DB (SELECT runs.status)
 *   container → POST /proxy/run/fail → this worker → env.DB (mark run failed if lease still held)
 *   container → POST /proxy/run/reset → this worker → env.DB (reset run to queued)
 */

import {
  HostContainerInternals,
  HostContainerRuntime,
} from './container-runtime.ts';
import { recordRunUsageBatch } from '../../application/services/billing/billing';
import type {
  DurableObjectNamespace,
  R2Bucket,
  Queue,
} from '../../shared/types/bindings.ts';
import type {
  DbEnv,
  StorageEnv,
  AiEnv,
  IndexJobQueueMessage,
} from '../../shared/types';
import { validateExecutorHostEnv, createEnvGuard } from '../../shared/utils/validate-env';
import {
  dispatchAgentExecutorStart,
  forwardAgentExecutorDispatch,
  type AgentExecutorDispatchPayload,
  type AgentExecutorDispatchResult,
  type AgentExecutorControlConfig,
} from './executor-dispatch';
import {
  buildAgentExecutorContainerEnvVars,
  buildAgentExecutorProxyConfig,
} from './executor-proxy-config';
import { executeD1RawStatement, type D1RawOptions } from './d1-raw';
import { validateD1ProxySql } from '../../application/services/execution/sql-validation';
import { extractBearerToken } from '../../shared/utils';
import { constantTimeEqual } from '../../shared/utils/hash';
import { buildSanitizedDOHeaders } from '../durable-objects/shared';
import { getDb } from '../../infra/db';
import { accounts, runs, runEvents, messages, threads } from '../../infra/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { logError, logWarn } from '../../shared/utils/logger';
import { persistMessage } from '../../application/services/agent/message-persistence';
import type { AgentMessage } from '../../application/services/agent/types';
import {
  buildConversationHistory,
  updateRunStatusImpl,
} from '../../application/services/agent/runner';
import { resolveSkillPlanForRun } from '../../application/services/agent/skills';
import { createToolExecutor, type ToolExecutorLike } from '../../application/tools/executor';
import { AGENT_DISABLED_BUILTIN_TOOLS } from '../../application/tools/tool-policy';
import type { ToolCall } from '../../application/tools/types';
import {
  getActiveClaims,
  countEvidenceForClaims,
  getPathsForClaim,
  upsertClaim,
  insertEvidence,
} from '../../application/services/memory-graph/claim-store';
import { buildActivationBundles, renderActivationSegment } from '../../application/services/memory-graph/activation';
import {
  buildTerminalPayload,
  buildRunNotifierEmitPayload,
  buildRunNotifierEmitRequest,
  getRunNotifierStub,
} from '../../application/services/run-notifier';

interface ExecutorContainerStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  dispatchStart(body: AgentExecutorDispatchPayload): Promise<AgentExecutorDispatchResult>;
  verifyProxyToken(token: string): Promise<ProxyTokenInfo | null>;
}

interface ContainerNamespace extends DurableObjectNamespace<TakosAgentExecutorContainer> {
  get(id: unknown): ExecutorContainerStub;
  getByName(name: string): ExecutorContainerStub;
}

/**
 * Wrapper type for the Cloudflare AI binding that accepts dynamic model names.
 * The built-in `Ai` type requires a specific `AiModels` key, but proxy callers
 * send arbitrary model name strings resolved at runtime.
 */
interface AiRunBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

type ProxyCapability = 'bindings' | 'control';

const MAX_PROXY_PUT_BYTES = 100 * 1024 * 1024; // 100MB

const ALLOWED_RUNTIME_PROXY_PATHS = [
  /^\/session(?:\/|$)/,
  /^\/status(?:\/|$)/,
  /^\/repos(?:\/|$)/,
  /^\/actions\/jobs\/[^/]+$/,
  /^\/cli-proxy\/.+/,
] as const;

const ALLOWED_BROWSER_PROXY_PATHS = [
  /^\/create$/,
  /^\/session\/[^/]+$/,
  /^\/session\/[^/]+\/(?:goto|action|extract|pdf|tab\/new|tab\/close|tab\/switch)$/,
  /^\/session\/[^/]+\/(?:html|screenshot|tabs)$/,
] as const;

const proxyUsageCounters = new Map<string, number>();

function recordProxyUsage(path: string): void {
  const bucket = path.startsWith('/proxy/db/')
    ? 'db'
    : path.startsWith('/proxy/offload/')
      ? 'offload'
      : path.startsWith('/proxy/do/')
        ? 'do'
        : path === '/rpc/control/tool-catalog'
          ? 'tool-catalog'
          : path === '/rpc/control/tool-execute'
            ? 'tool-execute'
            : path === '/rpc/control/tool-cleanup'
              ? 'tool-cleanup'
              : path === '/rpc/control/run-event'
                ? 'run-event'
                : path.startsWith('/proxy/')
                  ? 'other-proxy'
                  : path.startsWith('/rpc/control/')
                    ? 'other-control-rpc'
                    : 'other';
  proxyUsageCounters.set(bucket, (proxyUsageCounters.get(bucket) ?? 0) + 1);
}

function getProxyUsageSnapshot(): Record<string, number> {
  return Object.fromEntries([...proxyUsageCounters.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export interface AgentExecutorEnv extends DbEnv, StorageEnv, AiEnv {
  EXECUTOR_CONTAINER: ContainerNamespace;
  RUN_NOTIFIER: DurableObjectNamespace;
  TAKOS_OFFLOAD: R2Bucket;
  TAKOS_EGRESS: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  RUNTIME_HOST?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  BROWSER_HOST?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  INDEX_QUEUE?: Queue<IndexJobQueueMessage>;
  CONTROL_RPC_BASE_URL?: string;
}

// Local alias for internal usage
type Env = AgentExecutorEnv;

/** Token metadata stored alongside each random proxy token. */
export interface ProxyTokenInfo {
  runId: string;
  serviceId: string;
  capability: ProxyCapability;
}

/**
 * Durable Object that manages the executor container lifecycle.
 * Receives /start requests from the runner and /proxy/* calls from the container.
 * The Container base class starts the image on first fetch() and routes to port 8080.
 */
export class TakosAgentExecutorContainer extends HostContainerRuntime<Env> {
  defaultPort = 8080;
  sleepAfter = '5m';
  pingEndpoint = 'container/health';

  private cachedTokens: Map<string, ProxyTokenInfo> | null = null;

  constructor(ctx: DurableObjectState<Record<string, never>>, env: Env) {
    super(ctx, env);
    this.envVars = buildAgentExecutorContainerEnvVars(env);
  }

  async dispatchStart(body: AgentExecutorDispatchPayload): Promise<AgentExecutorDispatchResult> {
    const controlConfig: AgentExecutorControlConfig = buildAgentExecutorProxyConfig(this.env, {
      runId: body.runId,
      serviceId: body.workerId,
    });
    const tokenMap: Record<string, ProxyTokenInfo> = {
      [controlConfig.controlRpcToken]: { runId: body.runId, serviceId: body.workerId, capability: 'control' },
    };
    await this.ctx.storage.put('proxyTokens', tokenMap);
    this.cachedTokens = new Map(Object.entries(tokenMap));

    return await dispatchAgentExecutorStart({
      startAndWaitForPorts: this.startAndWaitForPorts.bind(this),
      fetch: async (request: Request) => {
        this.renewActivityTimeout();
        const tcpPort = (this as unknown as HostContainerInternals).container.getTcpPort(8080);
        return await tcpPort.fetch(request.url.replace('https:', 'http:'), request);
      },
    }, body, controlConfig);
  }

  /** RPC method: called by the worker fetch handler to verify proxy tokens. */
  async verifyProxyToken(token: string): Promise<ProxyTokenInfo | null> {
    if (!this.cachedTokens) {
      const stored = await this.ctx.storage.get<Record<string, ProxyTokenInfo>>('proxyTokens');
      if (!stored) return null;
      this.cachedTokens = new Map(Object.entries(stored));
    }
    for (const [storedToken, info] of this.cachedTokens) {
      if (constantTimeEqual(token, storedToken)) return info;
    }
    return null;
  }
}

export function getRequiredProxyCapability(path: string): ProxyCapability | null {
  if (
    path.startsWith('/proxy/db/')
    || path.startsWith('/proxy/offload/')
    || path.startsWith('/proxy/git-objects/')
    || path.startsWith('/proxy/do/')
    || path.startsWith('/proxy/vectorize/')
    || path.startsWith('/proxy/ai/')
    || path.startsWith('/proxy/egress/')
    || path.startsWith('/proxy/runtime/')
    || path.startsWith('/proxy/browser/')
    || path.startsWith('/proxy/queue/')
  ) {
    return 'bindings';
  }

  if (
    path === '/proxy/heartbeat'
    || path === '/proxy/run/status'
    || path === '/proxy/run/fail'
    || path === '/proxy/run/reset'
    || path === '/proxy/api-keys'
    || path === '/proxy/billing/run-usage'
    || path === '/rpc/control/heartbeat'
    || path === '/rpc/control/run-status'
    || path === '/rpc/control/run-record'
    || path === '/rpc/control/run-bootstrap'
    || path === '/rpc/control/run-fail'
    || path === '/rpc/control/run-reset'
    || path === '/rpc/control/api-keys'
    || path === '/rpc/control/billing-run-usage'
    || path === '/rpc/control/run-context'
    || path === '/rpc/control/no-llm-complete'
    || path === '/rpc/control/conversation-history'
    || path === '/rpc/control/skill-plan'
    || path === '/rpc/control/memory-activation'
    || path === '/rpc/control/memory-finalize'
    || path === '/rpc/control/add-message'
    || path === '/rpc/control/update-run-status'
    || path === '/rpc/control/current-session'
    || path === '/rpc/control/is-cancelled'
    || path === '/rpc/control/tool-catalog'
    || path === '/rpc/control/tool-execute'
    || path === '/rpc/control/tool-cleanup'
    || path === '/rpc/control/run-event'
  ) {
    return 'control';
  }

  // Unknown proxy paths must be rejected — return null signals unauthorized
  return null;
}

export function validateProxyResourceAccess(
  path: string,
  claims: Record<string, unknown>,
  body: Record<string, unknown>,
): boolean {
  const claimRunId = typeof claims.run_id === 'string' ? claims.run_id : null;

  if (path === '/proxy/do/fetch') {
    return body.namespace === 'RUN_NOTIFIER'
      && typeof body.name === 'string'
      && !!claimRunId
      && body.name === claimRunId;
  }

  if (path === '/proxy/queue/send' || path === '/proxy/queue/send-batch') {
    return body.queue === 'index';
  }

  if (path === '/proxy/runtime/fetch') {
    if (typeof body.url !== 'string') {
      return false;
    }

    try {
      const runtimeUrl = new URL(body.url);
      return runtimeUrl.hostname === 'runtime-host'
        && ALLOWED_RUNTIME_PROXY_PATHS.some((pattern) => pattern.test(runtimeUrl.pathname));
    } catch {
      return false;
    }
  }

  if (path === '/proxy/browser/fetch') {
    if (typeof body.url !== 'string') {
      return false;
    }

    try {
      const browserUrl = new URL(body.url);
      return browserUrl.hostname === 'browser-host.internal'
        && ALLOWED_BROWSER_PROXY_PATHS.some((pattern) => pattern.test(browserUrl.pathname));
    } catch {
      return false;
    }
  }

  return true;
}

function claimsMatchRequestBody(
  claims: Record<string, unknown>,
  body: Record<string, unknown>,
): boolean {
  const claimRunId = typeof claims.run_id === 'string' ? claims.run_id : null;
  const claimWorkerId = typeof claims.worker_id === 'string' ? claims.worker_id : null;
  const bodyRunId = typeof body.runId === 'string' ? body.runId : null;
  const bodyWorkerId = typeof body.workerId === 'string' ? body.workerId : null;

  if (claimRunId && bodyRunId && claimRunId !== bodyRunId) return false;
  if (claimWorkerId && bodyWorkerId && claimWorkerId !== bodyWorkerId) return false;
  return true;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function err(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type RunBootstrap = {
  status: typeof runs.$inferSelect.status | null;
  spaceId: string;
  sessionId: string | null;
  threadId: string;
  userId: string;
  agentType: string;
};

const remoteToolExecutors = new Map<string, Promise<ToolExecutorLike>>();

async function resolveExecutionUserIdForRun(env: Env, runId: string): Promise<string> {
  const db = getDb(env.DB);
  const runRow = await db.select({
    accountId: runs.accountId,
    requesterAccountId: runs.requesterAccountId,
  }).from(runs).where(eq(runs.id, runId)).get();

  if (!runRow?.accountId) {
    throw new Error(`Run not found while resolving execution user for run ${runId}`);
  }

  if (runRow.requesterAccountId) {
    return runRow.requesterAccountId;
  }

  const workspace = await db.select({
    type: accounts.type,
    ownerAccountId: accounts.ownerAccountId,
  }).from(accounts).where(eq(accounts.id, runRow.accountId)).get();

  if (workspace?.ownerAccountId) {
    logWarn(`Run ${runId} missing requester_account_id; falling back to workspace owner`, { module: 'executor-host' });
    return workspace.ownerAccountId;
  }

  if (workspace?.type === 'user') {
    return runRow.accountId;
  }

  logWarn(`Run ${runId} missing requester_account_id; falling back to workspace account id`, { module: 'executor-host' });
  return runRow.accountId;
}

async function getRunBootstrap(env: Env, runId: string): Promise<RunBootstrap> {
  const db = getDb(env.DB);
  const run = await db.select({
    id: runs.id,
    status: runs.status,
    accountId: runs.accountId,
    sessionId: runs.sessionId,
    threadId: runs.threadId,
    agentType: runs.agentType,
  }).from(runs).where(eq(runs.id, runId)).get();

  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  const thread = await db.select({
    accountId: threads.accountId,
  }).from(threads).where(eq(threads.id, run.threadId)).get();

  if (!thread) {
    throw new Error(`Thread not found: ${run.threadId}`);
  }

  if (thread.accountId !== run.accountId) {
    throw new Error(`Thread ${run.threadId} does not belong to account ${run.accountId}`);
  }

  const userId = await resolveExecutionUserIdForRun(env, runId);

  return {
    status: run.status,
    spaceId: run.accountId,
    sessionId: run.sessionId ?? null,
    threadId: run.threadId,
    userId,
    agentType: run.agentType,
  };
}

async function createRemoteToolExecutor(runId: string, env: Env): Promise<ToolExecutorLike> {
  const bootstrap = await getRunBootstrap(env, runId);

  return createToolExecutor(
    env as unknown as Parameters<typeof createToolExecutor>[0],
    env.DB,
    env.TAKOS_OFFLOAD,
    bootstrap.spaceId,
    bootstrap.sessionId ?? undefined,
    bootstrap.threadId,
    runId,
    bootstrap.userId,
    {
      disabledBuiltinTools: [...AGENT_DISABLED_BUILTIN_TOOLS],
    },
    undefined,
    undefined,
    {
      minimumRole: 'admin',
    },
  );
}

async function getOrCreateRemoteToolExecutor(runId: string, env: Env): Promise<ToolExecutorLike> {
  const existing = remoteToolExecutors.get(runId);
  if (existing) {
    return existing;
  }

  const pending = createRemoteToolExecutor(runId, env);
  remoteToolExecutors.set(runId, pending);
  try {
    return await pending;
  } catch (error) {
    remoteToolExecutors.delete(runId);
    throw error;
  }
}

async function cleanupRemoteToolExecutor(runId: string): Promise<void> {
  const existing = remoteToolExecutors.get(runId);
  if (!existing) {
    return;
  }
  remoteToolExecutors.delete(runId);
  try {
    const executor = await existing;
    await executor.cleanup();
  } catch {
    // Best-effort cleanup.
  }
}

function classifyProxyError(e: unknown): { status: number; message: string } {
  const name = e instanceof Error ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e);

  // Timeout / AbortError
  if (name === 'AbortError' || name === 'TimeoutError' || msg.includes('timed out') || msg.includes('timeout')) {
    return { status: 504, message: 'Proxy request timed out' };
  }

  // SQLite errors
  if (msg.includes('SQLITE_BUSY') || msg.includes('database is locked')) {
    return { status: 503, message: 'Database busy, retry later' };
  }
  if (msg.includes('SQLITE_CONSTRAINT')) {
    return { status: 409, message: 'Database constraint violation' };
  }
  if (msg.includes('SQLITE_ERROR') || msg.includes('D1_ERROR')) {
    return { status: 400, message: 'Database query error' };
  }

  // Network errors
  if (
    name === 'NetworkError' ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  ) {
    return { status: 502, message: 'Upstream connection failed' };
  }

  // Client-side type/range errors
  if (e instanceof TypeError || e instanceof RangeError) {
    return { status: 400, message: 'Invalid request' };
  }

  return { status: 500, message: 'Internal proxy error' };
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Proxy endpoint handlers
// ---------------------------------------------------------------------------

async function handleDbProxy(path: string, body: Record<string, unknown>, env: Env): Promise<Response> {
  const { sql, params = [], statements, colName, rawOptions } = body as {
    sql?: string;
    params?: unknown[];
    statements?: { sql: string; params: unknown[] }[];
    colName?: string;
    rawOptions?: D1RawOptions;
  };

  try {
    switch (path) {
      case '/proxy/db/first': {
        if (typeof sql !== 'string') return err('Missing required "sql" parameter for db/first', 400);
        const validation = validateD1ProxySql(sql);
        if (!validation.valid) return err(`SQL validation failed: ${validation.error}`, 400);
        const result = colName !== undefined
          ? await env.DB.prepare(sql).bind(...params).first(colName)
          : await env.DB.prepare(sql).bind(...params).first();
        return ok({ result });
      }
      case '/proxy/db/run': {
        if (typeof sql !== 'string') return err('Missing required "sql" parameter for db/run', 400);
        const validation = validateD1ProxySql(sql);
        if (!validation.valid) return err(`SQL validation failed: ${validation.error}`, 400);
        const result = await env.DB.prepare(sql).bind(...params).run();
        return ok(result);
      }
      case '/proxy/db/all': {
        if (typeof sql !== 'string') return err('Missing required "sql" parameter for db/all', 400);
        const validation = validateD1ProxySql(sql);
        if (!validation.valid) return err(`SQL validation failed: ${validation.error}`, 400);
        const result = await env.DB.prepare(sql).bind(...params).all();
        return ok(result);
      }
      case '/proxy/db/raw': {
        if (typeof sql !== 'string') return err('Missing required "sql" parameter for db/raw', 400);
        const validation = validateD1ProxySql(sql);
        if (!validation.valid) return err(`SQL validation failed: ${validation.error}`, 400);
        const statement = env.DB.prepare(sql).bind(...params);
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
        const result = await env.DB.batch(stmts);
        return ok(result);
      }
      case '/proxy/db/exec': {
        // DB.exec() can execute multiple statements including DDL — blocked entirely
        return err('db/exec endpoint is disabled for security', 403);
      }
      default:
        return err(`Unknown DB proxy path: ${path}`, 404);
    }
  } catch (e: unknown) {
    logError(`DB proxy error on ${path}`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleR2Proxy(path: string, prefix: string, body: Record<string, unknown>, bucket: R2Bucket, rawRequest?: Request): Promise<Response> {
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

  try {
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
        // Binary PUT: body is raw octet-stream, metadata in headers
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
          const result = await bucket.put(binaryKey, binaryBody, putOptions);
          return ok(result);
        }

        // JSON PUT: backward-compatible path (text/null/base64 encoding)
        let value: string | ArrayBuffer | ArrayBufferView | null;
        if (encoding === 'null') {
          value = null;
        } else if (encoding === 'base64') {
          if (typeof bodyBase64 !== 'string') return err('Missing bodyBase64 for base64 payload', 400);
          value = decodeBase64ToBytes(bodyBase64);
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

        const result = await bucket.put(key, value, options as Parameters<R2Bucket['put']>[2]);
        return ok(result);
      }
      case `${prefix}/delete`: {
        await bucket.delete(key);
        return ok({ success: true });
      }
      case `${prefix}/list`: {
        const result = await bucket.list(body as Parameters<R2Bucket['list']>[0]);
        return ok(result);
      }
      case `${prefix}/head`: {
        const result = await bucket.head(key);
        return ok(result);
      }
      default:
        return err(`Unknown R2 proxy path: ${path}`, 404);
    }
  } catch (e: unknown) {
    logError(`R2 proxy error on ${path}`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleNotifierProxy(path: string, body: Record<string, unknown>, env: Env): Promise<Response> {
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

  try {
    switch (path) {
      case '/proxy/do/fetch': {
        // Generic DO fetch (used for RunNotifier, etc.)
        const { namespace, name } = body as { namespace: string; name: string };
        let ns: DurableObjectNamespace | undefined;
        if (namespace === 'RUN_NOTIFIER') {
          ns = env.RUN_NOTIFIER;
        }
        if (!ns) return err(`Unknown DO namespace: ${namespace}`, 400);

        // Validate URL path and method
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
  } catch (e: unknown) {
    logError(`Notifier proxy error on ${path}`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleVectorizeProxy(path: string, body: Record<string, unknown>, env: Env): Promise<Response> {
  if (!env.VECTORIZE) return err('VECTORIZE not configured', 503);

  try {
    const { vector, options, vectors, ids } = body as {
      vector?: number[];
      options?: Record<string, unknown>;
      vectors?: unknown[];
      ids?: string[];
    };

    switch (path) {
      case '/proxy/vectorize/query':
        if (!Array.isArray(vector)) return err('Missing required "vector" array for vectorize/query', 400);
        return ok(await env.VECTORIZE.query(vector, options as Parameters<VectorizeIndex['query']>[1]));
      case '/proxy/vectorize/insert':
        return ok(await env.VECTORIZE.insert(vectors as Parameters<VectorizeIndex['insert']>[0]));
      case '/proxy/vectorize/upsert':
        return ok(await env.VECTORIZE.upsert(vectors as Parameters<VectorizeIndex['upsert']>[0]));
      case '/proxy/vectorize/delete':
        if (!Array.isArray(ids)) return err('Missing required "ids" array for vectorize/delete', 400);
        return ok(await env.VECTORIZE.deleteByIds(ids));
      case '/proxy/vectorize/get':
        if (!Array.isArray(ids)) return err('Missing required "ids" array for vectorize/get', 400);
        return ok(await env.VECTORIZE.getByIds(ids));
      case '/proxy/vectorize/describe':
        return ok(await env.VECTORIZE.describe());
      default:
        return err(`Unknown vectorize proxy path: ${path}`, 404);
    }
  } catch (e: unknown) {
    logError(`Vectorize proxy error on ${path}`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleAiProxy(path: string, body: Record<string, unknown>, env: Env): Promise<Response> {
  if (!env.AI) return err('AI not configured', 503);

  try {
    const { model, inputs } = body as { model: string; inputs: Record<string, unknown> };
    switch (path) {
      case '/proxy/ai/run': {
        // Model is a dynamic string from proxy call; Cloudflare's Ai type
        // requires a specific AiModels key, but proxy callers send arbitrary
        // model name strings. Use a typed wrapper to avoid `as any`.
        const ai = env.AI as AiRunBinding;
        return ok(await ai.run(model, inputs));
      }
      default:
        return err(`Unknown AI proxy path: ${path}`, 404);
    }
  } catch (e: unknown) {
    logError(`AI proxy error on ${path}`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleEgressProxy(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { url, method = 'GET', headers: hdrs, body: reqBody } = body as {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };

  try {
    const reqHeaders = new Headers(buildSanitizedDOHeaders(hdrs, {}));
    reqHeaders.set('X-Takos-Internal', '1');
    const res = await env.TAKOS_EGRESS.fetch(new Request(url, {
      method,
      headers: headersToRecord(reqHeaders),
      body: reqBody,
    }));

    // Return response as-is (stream body)
    return new Response(res.body, {
      status: res.status,
      headers: res.headers,
    });
  } catch (e: unknown) {
    logError(`Egress proxy error`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleRuntimeProxy(body: Record<string, unknown>, env: Env): Promise<Response> {
  if (!env.RUNTIME_HOST) return err('RUNTIME_HOST not configured', 503);
  const { url, method = 'GET', headers: hdrs, body: reqBody } = body as {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };

  try {
    const reqHeaders = new Headers(buildSanitizedDOHeaders(hdrs, {}));
    reqHeaders.set('X-Takos-Internal', '1');
    const res = await env.RUNTIME_HOST.fetch(new Request(url, {
      method,
      headers: headersToRecord(reqHeaders),
      body: reqBody,
    }));
    return new Response(res.body, { status: res.status, headers: res.headers });
  } catch (e: unknown) {
    logError(`Runtime proxy error`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleBrowserProxy(body: Record<string, unknown>, env: Env): Promise<Response> {
  if (!env.BROWSER_HOST) return err('BROWSER_HOST not configured', 503);
  const { url, method = 'GET', headers: hdrs, body: reqBody } = body as {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };

  try {
    const reqHeaders = new Headers(buildSanitizedDOHeaders(hdrs, {}));
    reqHeaders.set('X-Takos-Internal', '1');
    const res = await env.BROWSER_HOST.fetch(new Request(url, {
      method,
      headers: headersToRecord(reqHeaders),
      body: reqBody,
    }));
    return new Response(res.body, { status: res.status, headers: res.headers });
  } catch (e: unknown) {
    logError(`Browser proxy error`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleQueueProxy(path: string, body: Record<string, unknown>, env: Env): Promise<Response> {
  if (!env.INDEX_QUEUE) return err('INDEX_QUEUE not configured', 503);

  try {
    const { queue, message, messages } = body as {
      queue?: string;
      message?: unknown;
      messages?: { body: unknown }[];
    };
    if (queue !== 'index') return err('Unknown queue', 403);
    switch (path) {
      case '/proxy/queue/send':
        await env.INDEX_QUEUE.send(message as IndexJobQueueMessage);
        return ok({ success: true });
      case '/proxy/queue/send-batch':
        if (!Array.isArray(messages)) return err('Missing required "messages" array for queue/send-batch', 400);
        await env.INDEX_QUEUE.sendBatch(messages as { body: IndexJobQueueMessage }[]);
        return ok({ success: true });
      default:
        return err(`Unknown queue proxy path: ${path}`, 404);
    }
  } catch (e: unknown) {
    logError(`Queue proxy error on ${path}`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleHeartbeat(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { runId, workerId, leaseVersion } = body as { runId: string; workerId: string; leaseVersion?: number };
  const serviceId = workerId;
  if (!runId || !serviceId) return err('Missing runId or workerId', 400);

  try {
    const db = getDb(env.DB);
    const now = new Date().toISOString();
    const conditions = [eq(runs.id, runId), eq(runs.serviceId, serviceId)];
    if (typeof leaseVersion === 'number') {
      conditions.push(eq(runs.leaseVersion, leaseVersion));
    }
    const result = await db.update(runs)
      .set({ serviceHeartbeat: now })
      .where(and(...conditions));
    if (result.meta.changes === 0) {
      return err('Lease lost', 409);
    }
    return ok({ success: true });
  } catch (e: unknown) {
    logError(`Heartbeat error`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleRunStatus(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err('Missing runId', 400);

  try {
    const db = getDb(env.DB);
    const row = await db.select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    return ok({ status: row[0]?.status ?? null });
  } catch (e: unknown) {
    logError(`Run status error`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleRunRecord(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err('Missing runId', 400);

  try {
    const db = getDb(env.DB);
    const run = await db.select({
      status: runs.status,
      input: runs.input,
      parentRunId: runs.parentRunId,
    }).from(runs).where(eq(runs.id, runId)).get();
    return ok({
      status: run?.status ?? null,
      input: run?.input ?? null,
      parentRunId: run?.parentRunId ?? null,
    });
  } catch (e: unknown) {
    logError('Run record error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleRunBootstrap(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err('Missing runId', 400);

  try {
    return ok(await getRunBootstrap(env, runId));
  } catch (e: unknown) {
    logError('Run bootstrap error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleRunFail(body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    runId,
    workerId,
    leaseVersion,
    error: errorMessage,
  } = body as {
    runId?: string;
    workerId?: string;
    leaseVersion?: number;
    error?: string;
  };
  const serviceId = workerId;
  if (!runId || !serviceId) return err('Missing runId or workerId', 400);
  if (typeof errorMessage !== 'string' || errorMessage.trim().length === 0) {
    return err('Missing error', 400);
  }

  try {
    const db = getDb(env.DB);
    const conditions = [eq(runs.id, runId), eq(runs.serviceId, serviceId), eq(runs.status, 'running')];
    if (typeof leaseVersion === 'number') {
      conditions.push(eq(runs.leaseVersion, leaseVersion));
    }
    const result = await db.update(runs)
      .set({
        status: 'failed',
        error: errorMessage,
        completedAt: new Date().toISOString(),
      })
      .where(and(...conditions));
    return ok({ success: true, updated: result.meta.changes > 0 });
  } catch (e: unknown) {
    logError(`Run fail error`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleRunReset(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { runId, workerId } = body as { runId: string; workerId: string };
  const serviceId = workerId;
  if (!runId || !serviceId) return err('Missing runId or workerId', 400);

  try {
    const db = getDb(env.DB);
    await db.update(runs)
      .set({ status: 'queued', serviceId: null, serviceHeartbeat: null })
      .where(and(eq(runs.id, runId), eq(runs.serviceId, serviceId), eq(runs.status, 'running')));
    return ok({ success: true });
  } catch (e: unknown) {
    logError(`Run reset error`, e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleRunContext(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err('Missing runId', 400);

  try {
    const db = getDb(env.DB);
    const run = await db.select({
      status: runs.status,
      threadId: runs.threadId,
      sessionId: runs.sessionId,
    }).from(runs).where(eq(runs.id, runId)).get();

    if (!run) {
      return ok({
        status: null,
        threadId: null,
        sessionId: null,
        lastUserMessage: null,
      });
    }

    const latestUserMessage = run.threadId
      ? await db.select({ content: messages.content })
        .from(messages)
        .where(and(eq(messages.threadId, run.threadId), eq(messages.role, 'user')))
        .orderBy(desc(messages.sequence))
        .get()
      : null;

    return ok({
      status: run.status ?? null,
      threadId: run.threadId ?? null,
      sessionId: run.sessionId ?? null,
      lastUserMessage: latestUserMessage?.content ?? null,
    });
  } catch (e: unknown) {
    logError('Run context error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleNoLlmComplete(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { runId, workerId, response } = body as {
    runId?: string;
    workerId?: string;
    response?: string;
  };
  const serviceId = workerId;
  if (!runId || !serviceId) return err('Missing runId or workerId', 400);
  if (typeof response !== 'string' || response.trim().length === 0) {
    return err('Missing response', 400);
  }

  try {
    const db = getDb(env.DB);
    const run = await db.select({
      id: runs.id,
      status: runs.status,
      threadId: runs.threadId,
      sessionId: runs.sessionId,
      serviceId: runs.serviceId,
    }).from(runs).where(eq(runs.id, runId)).get();

    if (!run) return err('Run not found', 404);
    if (run.serviceId !== serviceId) return err('Run worker mismatch', 409);

    if (run.threadId) {
      await persistMessage(
        { db: env.DB, env: env as unknown as Parameters<typeof persistMessage>[0]['env'], threadId: run.threadId },
        { role: 'assistant', content: response },
      );
    }

    const completedAt = new Date().toISOString();
    await db.update(runs)
      .set({
        status: 'completed',
        output: JSON.stringify({ response, mode: 'no-llm' }),
        usage: JSON.stringify({ inputTokens: 0, outputTokens: 0 }),
        completedAt,
      })
      .where(and(eq(runs.id, runId), eq(runs.serviceId, serviceId)));

    try {
      const stub = getRunNotifierStub(env as never, runId);
      await stub.fetch(buildRunNotifierEmitRequest(
        buildRunNotifierEmitPayload(runId, 'message', { content: response }),
      ) as never);
      await stub.fetch(buildRunNotifierEmitRequest(
        buildRunNotifierEmitPayload(
          runId,
          'completed',
          buildTerminalPayload(runId, 'completed', { success: true, mode: 'no-llm' }, run.sessionId ?? null),
        ),
      ) as never);
    } catch (notifyError) {
      logError('No-LLM completion notifier emit failed', notifyError, { module: 'executor-host' });
    }

    return ok({ success: true });
  } catch (e: unknown) {
    logError('No-LLM completion error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleConversationHistory(body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    runId,
    threadId,
    spaceId,
    aiModel,
  } = body as {
    runId?: string;
    threadId?: string;
    spaceId?: string;
    aiModel?: string;
  };
  if (!runId || !threadId || !spaceId || !aiModel) {
    return err('Missing runId, threadId, spaceId, or aiModel', 400);
  }

  try {
    const history = await buildConversationHistory({
      db: env.DB,
      env: env as unknown as Parameters<typeof buildConversationHistory>[0]['env'],
      threadId,
      runId,
      spaceId,
      aiModel,
    });
    return ok({ history });
  } catch (e: unknown) {
    logError('Conversation history RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleSkillPlan(body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    runId,
    threadId,
    spaceId,
    agentType,
    history,
    availableToolNames,
  } = body as {
    runId?: string;
    threadId?: string;
    spaceId?: string;
    agentType?: string;
    history?: AgentMessage[];
    availableToolNames?: string[];
  };
  if (!runId || !threadId || !spaceId || !agentType || !Array.isArray(history) || !Array.isArray(availableToolNames)) {
    return err('Missing runId, threadId, spaceId, agentType, history, or availableToolNames', 400);
  }

  try {
    const result = await resolveSkillPlanForRun(env.DB, {
      runId,
      threadId,
      spaceId,
      agentType,
      history,
      availableToolNames,
    });
    return ok(result);
  } catch (e: unknown) {
    logError('Skill plan RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleMemoryActivation(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { spaceId } = body as { spaceId?: string };
  if (!spaceId) return err('Missing spaceId', 400);

  try {
    const claims = await getActiveClaims(env.DB, spaceId, 50);
    if (claims.length === 0) {
      return ok({ bundles: [], segment: '', hasContent: false });
    }

    const claimIds = claims.map((claim) => claim.id);
    const topClaims = claims.slice(0, 20);
    const [evidenceCounts, pathsArrays] = await Promise.all([
      countEvidenceForClaims(env.DB, claimIds),
      Promise.all(topClaims.map((claim) => getPathsForClaim(env.DB, spaceId, claim.id, 5))),
    ]);

    const pathsByClaim = new Map<string, (typeof pathsArrays)[number]>();
    for (let i = 0; i < topClaims.length; i++) {
      if (pathsArrays[i].length > 0) {
        pathsByClaim.set(topClaims[i].id, pathsArrays[i]);
      }
    }

    const bundles = buildActivationBundles(claims, evidenceCounts, pathsByClaim);
    return ok(renderActivationSegment(bundles));
  } catch (e: unknown) {
    logError('Memory activation RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleMemoryFinalize(body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    runId,
    spaceId,
    claims,
    evidence,
  } = body as {
    runId?: string;
    spaceId?: string;
    claims?: Array<Record<string, unknown>>;
    evidence?: Array<Record<string, unknown>>;
  };
  if (!runId || !spaceId || !Array.isArray(claims) || !Array.isArray(evidence)) {
    return err('Missing runId, spaceId, claims, or evidence', 400);
  }

  try {
    for (const claim of claims) {
      await upsertClaim(env.DB, {
        id: String(claim.id),
        accountId: String(claim.accountId ?? spaceId),
        claimType: claim.claimType as 'fact' | 'preference' | 'decision' | 'observation',
        subject: String(claim.subject ?? ''),
        predicate: String(claim.predicate ?? ''),
        object: String(claim.object ?? ''),
        confidence: typeof claim.confidence === 'number' ? claim.confidence : 0.5,
        status: (claim.status as 'active' | 'superseded' | 'retracted') ?? 'active',
        supersededBy: typeof claim.supersededBy === 'string' ? claim.supersededBy : null,
        sourceRunId: typeof claim.sourceRunId === 'string' ? claim.sourceRunId : runId,
      });
    }

    for (const item of evidence) {
      await insertEvidence(env.DB, {
        id: String(item.id),
        accountId: String(item.accountId ?? spaceId),
        claimId: String(item.claimId),
        kind: item.kind as 'supports' | 'contradicts' | 'context',
        sourceType: item.sourceType as 'tool_result' | 'user_message' | 'agent_inference' | 'memory_recall',
        sourceRef: typeof item.sourceRef === 'string' ? item.sourceRef : null,
        content: String(item.content ?? ''),
        trust: typeof item.trust === 'number' ? item.trust : 0.7,
        taint: typeof item.taint === 'string' ? item.taint : null,
      });
    }

    if (env.INDEX_QUEUE) {
      await env.INDEX_QUEUE.send({
        version: 1,
        jobId: crypto.randomUUID(),
        spaceId,
        type: 'memory_build_paths',
        targetId: runId,
        timestamp: Date.now(),
      } satisfies IndexJobQueueMessage);
    }

    return ok({ success: true });
  } catch (e: unknown) {
    logError('Memory finalize RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleAddMessage(body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    threadId,
    message,
    metadata,
  } = body as {
    threadId?: string;
    message?: AgentMessage;
    metadata?: Record<string, unknown>;
  };
  if (!threadId || !message || typeof message !== 'object') {
    return err('Missing threadId or message', 400);
  }
  if (
    (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'system' && message.role !== 'tool')
    || typeof message.content !== 'string'
  ) {
    return err('Invalid message payload', 400);
  }

  try {
    await persistMessage(
      { db: env.DB, env: env as unknown as Parameters<typeof persistMessage>[0]['env'], threadId },
      message,
      metadata,
    );
    return ok({ success: true });
  } catch (e: unknown) {
    logError('Add message RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleUpdateRunStatus(body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    runId,
    status,
    usage,
    output,
    error: errorMessage,
  } = body as {
    runId?: string;
    status?: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    usage?: { inputTokens?: number; outputTokens?: number };
    output?: string;
    error?: string;
  };
  if (!runId || !status) {
    return err('Missing runId or status', 400);
  }
  if (!usage || typeof usage.inputTokens !== 'number' || typeof usage.outputTokens !== 'number') {
    return err('Missing usage', 400);
  }

  try {
    await updateRunStatusImpl(
      env.DB,
      runId,
      {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      },
      status,
      output,
      errorMessage,
    );
    return ok({ success: true });
  } catch (e: unknown) {
    logError('Update run status RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleCurrentSession(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { runId, spaceId } = body as { runId?: string; spaceId?: string };
  if (!runId || !spaceId) return err('Missing runId or spaceId', 400);

  try {
    const db = getDb(env.DB);
    const run = await db.select({
      sessionId: runs.sessionId,
    }).from(runs).where(and(eq(runs.id, runId), eq(runs.accountId, spaceId))).get();
    return ok({ sessionId: run?.sessionId ?? null });
  } catch (e: unknown) {
    logError('Current session RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleIsCancelled(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err('Missing runId', 400);

  try {
    const db = getDb(env.DB);
    const run = await db.select({
      status: runs.status,
    }).from(runs).where(eq(runs.id, runId)).get();
    return ok({ cancelled: run?.status === 'cancelled' });
  } catch (e: unknown) {
    logError('Is cancelled RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleToolCatalog(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err('Missing runId', 400);

  try {
    const executor = await getOrCreateRemoteToolExecutor(runId, env);
    return ok({
      tools: executor.getAvailableTools(),
      mcpFailedServers: executor.mcpFailedServers,
    });
  } catch (e: unknown) {
    logError('Tool catalog RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleToolExecute(body: Record<string, unknown>, env: Env): Promise<Response> {
  const { runId, toolCall } = body as { runId?: string; toolCall?: ToolCall };
  if (!runId || !toolCall || typeof toolCall !== 'object') {
    return err('Missing runId or toolCall', 400);
  }
  if (
    typeof toolCall.id !== 'string'
    || typeof toolCall.name !== 'string'
    || typeof toolCall.arguments !== 'object'
    || toolCall.arguments == null
  ) {
    return err('Invalid toolCall payload', 400);
  }

  try {
    const executor = await getOrCreateRemoteToolExecutor(runId, env);
    return ok(await executor.execute(toolCall));
  } catch (e: unknown) {
    logError('Tool execute RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

async function handleToolCleanup(body: Record<string, unknown>): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err('Missing runId', 400);

  await cleanupRemoteToolExecutor(runId);
  return ok({ success: true });
}

async function handleRunEvent(body: Record<string, unknown>, env: Env): Promise<Response> {
  const {
    runId,
    type,
    data,
    sequence,
    skipDb,
  } = body as {
    runId?: string;
    type?: AgentMessage['role'] | 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'completed' | 'error' | 'progress' | 'started' | 'cancelled';
    data?: Record<string, unknown>;
    sequence?: number;
    skipDb?: boolean;
  };

  if (!runId || !type || !data || typeof data !== 'object' || typeof sequence !== 'number') {
    return err('Missing runId, type, data, or sequence', 400);
  }

  const now = new Date().toISOString();
  const offloadEnabled = Boolean(env.TAKOS_OFFLOAD);
  let legacyEventId: number | null = null;

  try {
    if (!skipDb && !offloadEnabled) {
      const db = getDb(env.DB);
      const persisted = await db.insert(runEvents).values({
        runId,
        type,
        data: JSON.stringify({ ...data, _sequence: sequence }),
        createdAt: now,
      }).returning({ id: runEvents.id }).get();
      legacyEventId = persisted?.id ?? null;
    }

    const stub = getRunNotifierStub(env as never, runId);
    const emitResponse = await stub.fetch(
      buildRunNotifierEmitRequest(
        buildRunNotifierEmitPayload(runId, type, data, legacyEventId),
      ) as never,
    );

    if (!emitResponse.ok) {
      const text = await emitResponse.text().catch(() => '');
      return err(`Run event emit failed: ${emitResponse.status} ${text}`.trim(), 502);
    }

    return ok({ success: true });
  } catch (e: unknown) {
    logError('Run event RPC error', e, { module: 'executor-host' });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

// Cached environment validation guard.
const envGuard = createEnvGuard(validateExecutorHostEnv);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Validate environment on first request (cached).
    const envError = envGuard(env as unknown as Record<string, unknown>);
    if (envError) {
      return new Response(JSON.stringify({
        error: 'Configuration Error',
        message: 'Executor host is misconfigured. Please contact administrator.',
      }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/health' && request.method === 'GET') {
      return new Response(JSON.stringify({ status: 'ok', service: 'takos-executor-host' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/internal/proxy-usage' && request.method === 'GET') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'takos-executor-host',
        counts: getProxyUsageSnapshot(),
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // /dispatch — called by takos-runner via service binding (same CF account).
    // Service binding provides implicit authentication; no JWT required.
    if (path === '/dispatch' && request.method === 'POST') {
      const body = await request.json() as AgentExecutorDispatchPayload;
      const { runId } = body;

      if (!runId) {
        return new Response(JSON.stringify({ error: 'Missing runId' }), { status: 400 });
      }

      const stub = env.EXECUTOR_CONTAINER.getByName(runId);

      // Container dispatch is the canonical OSS execution path.
      return await forwardAgentExecutorDispatch(stub, body);
    }

    // /proxy/* and /rpc/control/* — called by executor/container with per-run tokens
    if (path.startsWith('/proxy/') || path.startsWith('/rpc/control/')) {
      const runId = request.headers.get('X-Takos-Run-Id');
      const token = extractBearerToken(request.headers.get('Authorization'));
      if (!runId || !token) {
        return unauthorized();
      }

      // Verify token via DO RPC (DO stores the random tokens generated at dispatch)
      const stub = env.EXECUTOR_CONTAINER.getByName(runId);
      const tokenInfo = await stub.verifyProxyToken(token);
      if (!tokenInfo) {
        return unauthorized();
      }

      // Build claims-equivalent object for existing validation logic
      const claims: Record<string, unknown> = {
        run_id: tokenInfo.runId,
        worker_id: tokenInfo.serviceId,
        proxy_capabilities: [tokenInfo.capability],
      };

      if (request.method !== 'POST' && request.method !== 'GET') {
        return err('Method not allowed', 405);
      }

      // Binary R2 PUT: Content-Type is application/octet-stream, metadata in headers
      const isBinaryR2Put = request.method === 'POST'
        && (request.headers.get('Content-Type') || '').startsWith('application/octet-stream')
        && (path === '/proxy/offload/put' || path === '/proxy/git-objects/put');

      const body = isBinaryR2Put
        ? {} as Record<string, unknown> // body is raw binary, not JSON
        : request.method === 'POST'
          ? await request.json() as Record<string, unknown>
          : Object.fromEntries(url.searchParams.entries());
      if (!claimsMatchRequestBody(claims, body)) {
        return unauthorized();
      }
      const requiredCapability = getRequiredProxyCapability(path);
      if (!requiredCapability || requiredCapability !== tokenInfo.capability) {
        return unauthorized();
      }
      if (!validateProxyResourceAccess(path, claims, body)) {
        return unauthorized();
      }

      recordProxyUsage(path);

      // DB proxy endpoints
      if (path.startsWith('/proxy/db/')) {
        return handleDbProxy(path, body, env);
      }

      // R2 offload endpoints
      if (path.startsWith('/proxy/offload/')) {
        return handleR2Proxy(path, '/proxy/offload', body, env.TAKOS_OFFLOAD, isBinaryR2Put ? request : undefined);
      }

      // R2 git-objects endpoints
      if (path.startsWith('/proxy/git-objects/')) {
        if (!env.GIT_OBJECTS) return err('GIT_OBJECTS R2 bucket not configured', 503);
        return handleR2Proxy(path, '/proxy/git-objects', body, env.GIT_OBJECTS, isBinaryR2Put ? request : undefined);
      }

      // DO endpoints (RunNotifier + generic)
      if (path === '/proxy/do/fetch') {
        return handleNotifierProxy(path, body, env);
      }

      // Vectorize endpoints
      if (path.startsWith('/proxy/vectorize/')) {
        return handleVectorizeProxy(path, body, env);
      }

      // AI endpoints
      if (path.startsWith('/proxy/ai/')) {
        return handleAiProxy(path, body, env);
      }

      // Egress proxy
      if (path === '/proxy/egress/fetch') {
        return handleEgressProxy(body, env);
      }

      // Runtime proxy (for RUNTIME_HOST calls from tools)
      if (path === '/proxy/runtime/fetch') {
        return handleRuntimeProxy(body, env);
      }

      // Browser proxy (for BROWSER_HOST calls from tools)
      if (path === '/proxy/browser/fetch') {
        return handleBrowserProxy(body, env);
      }

      // Queue proxy
      if (path.startsWith('/proxy/queue/')) {
        return handleQueueProxy(path, body, env);
      }

      // Heartbeat
      if (path === '/proxy/heartbeat' || path === '/rpc/control/heartbeat') {
        return handleHeartbeat(body, env);
      }

      if (path === '/proxy/run/status' || path === '/rpc/control/run-status') {
        return handleRunStatus(body, env);
      }

      if (path === '/rpc/control/run-record') {
        return handleRunRecord(body, env);
      }

      if (path === '/rpc/control/run-bootstrap') {
        return handleRunBootstrap(body, env);
      }

      if (path === '/proxy/run/fail' || path === '/rpc/control/run-fail') {
        return handleRunFail(body, env);
      }

      // Run reset (on failure)
      if (path === '/proxy/run/reset' || path === '/rpc/control/run-reset') {
        return handleRunReset(body, env);
      }

      if (path === '/rpc/control/run-context') {
        return handleRunContext(body, env);
      }

      if (path === '/rpc/control/no-llm-complete') {
        return handleNoLlmComplete(body, env);
      }

      if (path === '/rpc/control/conversation-history') {
        return handleConversationHistory(body, env);
      }

      if (path === '/rpc/control/skill-plan') {
        return handleSkillPlan(body, env);
      }

      if (path === '/rpc/control/memory-activation') {
        return handleMemoryActivation(body, env);
      }

      if (path === '/rpc/control/memory-finalize') {
        return handleMemoryFinalize(body, env);
      }

      if (path === '/rpc/control/add-message') {
        return handleAddMessage(body, env);
      }

      if (path === '/rpc/control/update-run-status') {
        return handleUpdateRunStatus(body, env);
      }

      if (path === '/rpc/control/current-session') {
        return handleCurrentSession(body, env);
      }

      if (path === '/rpc/control/is-cancelled') {
        return handleIsCancelled(body, env);
      }

      if (path === '/rpc/control/tool-catalog') {
        return handleToolCatalog(body, env);
      }

      if (path === '/rpc/control/tool-execute') {
        return handleToolExecute(body, env);
      }

      if (path === '/rpc/control/tool-cleanup') {
        return handleToolCleanup(body);
      }

      if (path === '/rpc/control/run-event') {
        return handleRunEvent(body, env);
      }

      // Billing — record run usage after completion
      if (path === '/proxy/billing/run-usage' || path === '/rpc/control/billing-run-usage') {
        const { runId: billingRunId } = body as { runId: string };
        if (!billingRunId) return err('Missing runId', 400);
        try {
          await recordRunUsageBatch(env as unknown as Parameters<typeof recordRunUsageBatch>[0], billingRunId);
          return ok({ recorded: true });
        } catch (billingErr) {
          logError(`Billing recording failed for run ${billingRunId}`, billingErr, { module: 'executor-host' });
          return ok({ recorded: false, error: 'billing_failed' });
        }
      }

      // API keys — container fetches keys on demand instead of receiving them in the dispatch payload
      if (path === '/proxy/api-keys' || path === '/rpc/control/api-keys') {
        return ok({
          openai: env.OPENAI_API_KEY ?? null,
          anthropic: env.ANTHROPIC_API_KEY ?? null,
          google: env.GOOGLE_API_KEY ?? null,
        });
      }

      return err(`Unknown proxy path: ${path}`, 404);
    }

    return new Response('takos-executor-host', { status: 200 });
  },
} satisfies ExportedHandler<Env>;
