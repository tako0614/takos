import { createInMemoryDurableObjectNamespace } from './in-memory-bindings.ts';
import { loadLocalDispatchEnv, loadLocalWebEnv } from './load-adapter.ts';
import { createLocalExecutionContext } from './execution-context.ts';
import type {
  DurableNamespaceBinding,
  DurableObjectStub,
  PlatformExecutionContext,
} from '../shared/types/bindings.ts';
import type {
  BrowserSessionState,
  BrowserSessionTokenInfo,
  CreateSessionPayload,
} from '../runtime/container-hosts/browser-session-types.ts';
import type {
  AgentExecutorControlConfig,
  AgentExecutorDispatchPayload,
} from '../runtime/container-hosts/executor-dispatch.ts';
import { createTakosWebEnv } from './adapters/local.ts';
import { buildLocalDispatchPlatform, buildLocalWebPlatform } from '../platform/adapters/local.ts';
import { getDb } from '../infra/db/index.ts';
import { accounts, messages, runs, threads } from '../infra/db/schema.ts';
import { and, desc, eq } from 'drizzle-orm';
import { persistMessage } from '../application/services/agent/message-persistence.ts';
import {
  buildRunNotifierEmitPayload,
  buildRunNotifierEmitRequest,
  buildTerminalPayload,
  getRunNotifierStub,
} from '../application/services/run-notifier/index.ts';
import { recordRunUsageBatch } from '../application/services/billing/billing.ts';

export const DEFAULT_LOCAL_PORTS = {
  web: 8787,
  dispatch: 8788,
  runtimeHost: 8789,
  executorHost: 8790,
  browserHost: 8791,
} as const;

const DEFAULT_LOCAL_SERVICE_PORTS = {
  runtime: 8080,
  executor: 8080,
  browser: 8080,
} as const;

export type LocalFetch = (
  request: Request,
  executionContext?: PlatformExecutionContext,
) => Promise<Response>;

type LocalBinding = {
  fetch(request: Request): Promise<Response>;
};

type LocalRuntimeGatewayStub = LocalBinding & {
  verifyProxyToken(token: string): Promise<{ sessionId: string; spaceId: string } | null>;
};

type ProxyTokenInfo = {
  runId: string;
  serviceId: string;
  capability: 'bindings' | 'control';
};

type LocalExecutorGatewayStub = {
  dispatchStart(body: AgentExecutorDispatchPayload): Promise<{ ok: boolean; status: number; body: string }>;
  verifyProxyToken(token: string): Promise<ProxyTokenInfo | null>;
};

type LocalBrowserGatewayStub = LocalBinding & {
  createSession(payload: CreateSessionPayload): Promise<{ ok: true; proxyToken: string }>;
  verifyProxyToken(token: string): Promise<BrowserSessionTokenInfo | null>;
  getSessionState(): Promise<BrowserSessionState | null>;
  destroySession(): Promise<void>;
  forwardToContainer(path: string, init?: RequestInit): Promise<Response>;
};

type LocalExecutorHostEnv = Awaited<ReturnType<typeof createExecutorHostEnv>>
  | Awaited<ReturnType<typeof createExecutorHostEnvForTests>>;

export async function createLocalWebFetch(): Promise<LocalFetch> {
  const env = await loadLocalWebEnv();
  const { createWebWorker } = await import('../web.ts');
  const webWorker = createWebWorker(buildLocalWebPlatform);
  return (request, executionContext = createLocalExecutionContext()) =>
    webWorker.fetch(request, env, executionContext);
}

export async function createLocalWebFetchForTests(): Promise<LocalFetch> {
  const env = await loadLocalWebEnv();
  const { createWebWorker } = await import('../web.ts');
  const webWorker = createWebWorker(buildLocalWebPlatform);
  return (request, executionContext = createLocalExecutionContext()) =>
    webWorker.fetch(request, env, executionContext);
}

export async function createLocalDispatchFetch(): Promise<LocalFetch> {
  const env = await loadLocalDispatchEnv();
  const { createDispatchWorker } = await import('../dispatch.ts');
  const dispatchWorker = createDispatchWorker(buildLocalDispatchPlatform);
  return (request, executionContext = createLocalExecutionContext()) =>
    dispatchWorker.fetch(request, env, executionContext);
}

export async function createLocalDispatchFetchForTests(): Promise<LocalFetch> {
  const env = await loadLocalDispatchEnv();
  const { createDispatchWorker } = await import('../dispatch.ts');
  const dispatchWorker = createDispatchWorker(buildLocalDispatchPlatform);
  return (request, executionContext = createLocalExecutionContext()) =>
    dispatchWorker.fetch(request, env, executionContext);
}

function createForwardingBinding(baseUrl: string): LocalBinding {
  return {
    fetch(request: Request) {
      return forwardRequestToBase(baseUrl, request);
    },
  };
}

function ensureTrailingSlash(baseUrl: string): URL {
  const base = new URL(baseUrl);
  if (!base.pathname.endsWith('/')) {
    base.pathname = `${base.pathname}/`;
  }
  return base;
}

function buildServiceRequest(baseUrl: string, path: string, init?: RequestInit): Request {
  const base = ensureTrailingSlash(baseUrl);
  const targetUrl = new URL(path.replace(/^\//, ''), base);
  return new Request(targetUrl, init);
}

function forwardRequestToBase(baseUrl: string, request: Request, pathOverride?: string): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const targetPath = pathOverride ?? incomingUrl.pathname;
  const nextRequest = buildServiceRequest(baseUrl, targetPath, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: request.redirect,
  });
  const targetUrl = new URL(nextRequest.url);
  targetUrl.search = incomingUrl.search;
  return globalThis.fetch(new Request(targetUrl, nextRequest));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readBearerToken(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

async function buildLocalRuntimeHostRequest(
  request: Request,
  stub: LocalRuntimeGatewayStub,
): Promise<Request> {
  const bodyText = request.method === 'GET' || request.method === 'HEAD'
    ? null
    : await request.text();
  const headers = new Headers(request.headers);

  if (new URL(request.url).pathname === '/sessions' && request.method === 'POST' && bodyText) {
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      if (typeof parsed.session_id === 'string' && typeof parsed.space_id === 'string') {
        const token = crypto.randomUUID().replace(/-/g, '');
        await stub.verifyProxyToken(token).catch(() => null);
        headers.set('X-Takos-Proxy-Token', token);
      }
    } catch {
      // Ignore malformed session payloads and forward as-is.
    }
  }

  return new Request(request.url, {
    method: request.method,
    headers,
    body: bodyText,
    redirect: request.redirect,
  });
}

function getLocalRuntimeGatewayStub(env: Awaited<ReturnType<typeof createRuntimeHostEnv>> | Awaited<ReturnType<typeof createRuntimeHostEnvForTests>>): LocalRuntimeGatewayStub {
  const namespace = env.RUNTIME_CONTAINER as DurableNamespaceBinding;
  if (typeof namespace.getByName === 'function') {
    return namespace.getByName('singleton') as unknown as LocalRuntimeGatewayStub;
  }
  return namespace.get(namespace.idFromName('singleton')) as unknown as LocalRuntimeGatewayStub;
}

async function buildLocalRuntimeHostFetch(
  env: Awaited<ReturnType<typeof createRuntimeHostEnv>> | Awaited<ReturnType<typeof createRuntimeHostEnvForTests>>,
): Promise<LocalFetch> {
  const stub = getLocalRuntimeGatewayStub(env);
  return async (request, _executionContext = createLocalExecutionContext()) => {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ status: 'ok', service: 'takos-runtime-host' });
    }
    return stub.fetch(await buildLocalRuntimeHostRequest(request, stub));
  };
}

function getLocalBrowserGatewayStub(
  env: Awaited<ReturnType<typeof createBrowserHostEnv>> | Awaited<ReturnType<typeof createBrowserHostEnvForTests>>,
  sessionId: string,
): LocalBrowserGatewayStub {
  const namespace = env.BROWSER_CONTAINER as DurableNamespaceBinding;
  return namespace.get(namespace.idFromName(sessionId)) as unknown as LocalBrowserGatewayStub;
}

function browserForwardPath(pathname: string): { sessionId: string; containerPath: string } | null {
  const patterns: Array<[RegExp, string]> = [
    [/^\/session\/([^/]+)\/goto$/, '/internal/goto'],
    [/^\/session\/([^/]+)\/action$/, '/internal/action'],
    [/^\/session\/([^/]+)\/extract$/, '/internal/extract'],
    [/^\/session\/([^/]+)\/html$/, '/internal/html'],
    [/^\/session\/([^/]+)\/screenshot$/, '/internal/screenshot'],
    [/^\/session\/([^/]+)\/pdf$/, '/internal/pdf'],
    [/^\/session\/([^/]+)\/tabs$/, '/internal/tabs'],
    [/^\/session\/([^/]+)\/tab\/new$/, '/internal/tab/new'],
  ];
  for (const [pattern, containerPath] of patterns) {
    const match = pathname.match(pattern);
    if (match) {
      return { sessionId: match[1], containerPath };
    }
  }
  return null;
}

async function buildLocalBrowserHostFetch(
  env: Awaited<ReturnType<typeof createBrowserHostEnv>> | Awaited<ReturnType<typeof createBrowserHostEnvForTests>>,
): Promise<LocalFetch> {
  return async (request, _executionContext = createLocalExecutionContext()) => {
    const url = new URL(request.url);

    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ status: 'ok', service: 'takos-browser-host' });
    }

    if (url.pathname === '/create' && request.method === 'POST') {
      const payload = await request.json().catch(() => null) as CreateSessionPayload | null;
      if (!payload?.sessionId || !payload.spaceId || !payload.userId) {
        return jsonResponse({ error: 'Missing required fields: sessionId, spaceId, userId' }, 400);
      }
      try {
        const stub = getLocalBrowserGatewayStub(env, payload.sessionId);
        return jsonResponse(await stub.createSession(payload), 201);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
      }
    }

    const sessionMatch = url.pathname.match(/^\/session\/([^/]+)$/);
    if (sessionMatch && request.method === 'GET') {
      const stub = getLocalBrowserGatewayStub(env, sessionMatch[1]);
      const state = await stub.getSessionState();
      if (!state) {
        return jsonResponse({ error: 'Session not found' }, 404);
      }
      return jsonResponse(state);
    }

    if (sessionMatch && request.method === 'DELETE') {
      try {
        const stub = getLocalBrowserGatewayStub(env, sessionMatch[1]);
        await stub.destroySession();
        return jsonResponse({ ok: true, message: `Session ${sessionMatch[1]} destroyed` });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
      }
    }

    const forward = browserForwardPath(url.pathname);
    if (forward) {
      try {
        const stub = getLocalBrowserGatewayStub(env, forward.sessionId);
        const init: RequestInit = {
          method: request.method,
          headers: request.headers,
        };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          init.body = await request.text();
        }
        const response = await stub.forwardToContainer(forward.containerPath, init);
        return new Response(response.body, { status: response.status, headers: response.headers });
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
      }
    }

    return new Response('Not found', { status: 404 });
  };
}

function resolveServiceUrl(envVarName: string, defaultPort: number): string {
  const explicit = process.env[envVarName]?.trim();
  if (explicit) return explicit;
  return `http://127.0.0.1:${defaultPort}/`;
}

function resolveOptionalServiceForwardUrl(envVarName: string, defaultPort: number): string | null {
  const explicit = process.env[envVarName]?.trim();
  if (explicit) return explicit;
  if (process.env.VITEST) return null;
  return `http://127.0.0.1:${defaultPort}/`;
}

function createLocalRuntimeGatewayStub(runtimeServiceUrl: string | null = null): LocalRuntimeGatewayStub {
  const tokens = new Map<string, { sessionId: string; spaceId: string }>();

  return {
    async verifyProxyToken(token: string) {
      return tokens.get(token) ?? null;
    },
    async fetch(request: Request) {
      const url = new URL(request.url);
      if (url.pathname === '/container/health') {
        if (runtimeServiceUrl) {
          return forwardRequestToBase(runtimeServiceUrl, request, '/health');
        }
        return new Response('ok', { status: 200 });
      }

      if (url.pathname === '/sessions' && request.method === 'POST') {
        const token = request.headers.get('X-Takos-Proxy-Token');
        const payload = await request.clone().json().catch(() => null);
        if (token && payload && typeof payload === 'object') {
          const body = payload as Record<string, unknown>;
          if (typeof body.session_id === 'string' && typeof body.space_id === 'string') {
            tokens.set(token, { sessionId: body.session_id, spaceId: body.space_id });
          }
        }
        if (runtimeServiceUrl) {
          return forwardRequestToBase(runtimeServiceUrl, request);
        }
        return jsonResponse({ ok: true, started: true }, 201);
      }

      if (runtimeServiceUrl) {
        return forwardRequestToBase(runtimeServiceUrl, request);
      }

      return jsonResponse({ ok: true, path: url.pathname });
    },
  };
}

function createLocalExecutorGatewayStub(executorServiceUrl: string | null = null): LocalExecutorGatewayStub {
  const tokens = new Map<string, ProxyTokenInfo>();

  return {
    async dispatchStart(body: AgentExecutorDispatchPayload) {
      const serviceId = body.serviceId || body.workerId;
      const controlToken = crypto.randomUUID().replace(/-/g, '');
      const controlConfig: AgentExecutorControlConfig = {
        controlRpcBaseUrl: process.env.CONTROL_RPC_BASE_URL
          ?? `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.executorHost}`,
        controlRpcToken: controlToken,
      };
      tokens.set(controlToken, { runId: body.runId, serviceId, capability: 'control' });

      if (executorServiceUrl) {
        const response = await globalThis.fetch(buildServiceRequest(executorServiceUrl, '/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            serviceId,
            workerId: body.workerId || serviceId,
            ...controlConfig,
          }),
        }));
        return {
          ok: response.ok,
          status: response.status,
          body: await response.text(),
        };
      }

      return {
        ok: true,
        status: 202,
        body: JSON.stringify({
          ok: true,
          local: true,
          runId: body.runId,
          serviceId,
          workerId: body.workerId || serviceId,
          ...controlConfig,
        }),
      };
    },
    async verifyProxyToken(token: string) {
      return tokens.get(token) ?? null;
    },
  };
}

const localExecutorProxyUsageCounters = new Map<string, number>();

function recordLocalExecutorProxyUsage(path: string): void {
  const bucket = path === '/rpc/control/tool-catalog'
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
  localExecutorProxyUsageCounters.set(bucket, (localExecutorProxyUsageCounters.get(bucket) ?? 0) + 1);
}

function getLocalExecutorProxyUsageSnapshot(): Record<string, number> {
  return Object.fromEntries([...localExecutorProxyUsageCounters.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function localExecutorUnauthorized(): Response {
  return jsonResponse({ error: 'Unauthorized' }, 401);
}

function localExecutorError(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

function readRunServiceId(body: Record<string, unknown>): string | null {
  if (typeof body.serviceId === 'string' && body.serviceId.length > 0) return body.serviceId;
  if (typeof body.workerId === 'string' && body.workerId.length > 0) return body.workerId;
  return null;
}

function getLocalExecutorGatewayBinding(env: LocalExecutorHostEnv, runId: string): LocalExecutorGatewayStub {
  const namespace = env.EXECUTOR_CONTAINER as DurableNamespaceBinding;
  if (typeof namespace.getByName === 'function') {
    return namespace.getByName(runId) as unknown as LocalExecutorGatewayStub;
  }
  return namespace.get(namespace.idFromName(runId)) as unknown as LocalExecutorGatewayStub;
}

async function resolveLocalExecutionUserIdForRun(env: LocalExecutorHostEnv, runId: string): Promise<string> {
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
    return workspace.ownerAccountId;
  }

  if (workspace?.type === 'user') {
    return runRow.accountId;
  }

  return runRow.accountId;
}

async function localHandleRunBootstrap(runId: string, env: LocalExecutorHostEnv): Promise<Response> {
  if (!runId) return localExecutorError('Missing runId', 400);

  const db = getDb(env.DB);
  const run = await db.select({
    status: runs.status,
    accountId: runs.accountId,
    sessionId: runs.sessionId,
    threadId: runs.threadId,
    agentType: runs.agentType,
  }).from(runs).where(eq(runs.id, runId)).get();

  if (!run) {
    return localExecutorError(`Run not found: ${runId}`, 404);
  }

  const thread = await db.select({
    accountId: threads.accountId,
  }).from(threads).where(eq(threads.id, run.threadId)).get();

  if (!thread) {
    return localExecutorError(`Thread not found: ${run.threadId}`, 404);
  }

  if (thread.accountId !== run.accountId) {
    return localExecutorError(`Thread ${run.threadId} does not belong to account ${run.accountId}`, 409);
  }

  const userId = await resolveLocalExecutionUserIdForRun(env, runId);
  return jsonResponse({
    status: run.status,
    spaceId: run.accountId,
    sessionId: run.sessionId ?? null,
    threadId: run.threadId,
    userId,
    agentType: run.agentType,
  });
}

async function localHandleRunStatus(body: Record<string, unknown>, env: LocalExecutorHostEnv): Promise<Response> {
  const runId = typeof body.runId === 'string' ? body.runId : null;
  if (!runId) return localExecutorError('Missing runId', 400);
  const db = getDb(env.DB);
  const row = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId)).limit(1);
  return jsonResponse({ status: row[0]?.status ?? null });
}

async function localHandleRunRecord(body: Record<string, unknown>, env: LocalExecutorHostEnv): Promise<Response> {
  const runId = typeof body.runId === 'string' ? body.runId : null;
  if (!runId) return localExecutorError('Missing runId', 400);
  const db = getDb(env.DB);
  const run = await db.select({
    status: runs.status,
    input: runs.input,
    parentRunId: runs.parentRunId,
  }).from(runs).where(eq(runs.id, runId)).get();
  return jsonResponse({
    status: run?.status ?? null,
    input: run?.input ?? null,
    parentRunId: run?.parentRunId ?? null,
  });
}

async function localHandleHeartbeat(body: Record<string, unknown>, env: LocalExecutorHostEnv): Promise<Response> {
  const runId = typeof body.runId === 'string' ? body.runId : null;
  const serviceId = readRunServiceId(body);
  const leaseVersion = typeof body.leaseVersion === 'number' ? body.leaseVersion : undefined;
  if (!runId || !serviceId) return localExecutorError('Missing runId or serviceId', 400);

  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const conditions = [eq(runs.id, runId), eq(runs.serviceId, serviceId)];
  if (typeof leaseVersion === 'number') conditions.push(eq(runs.leaseVersion, leaseVersion));
  const result = await db.update(runs).set({ serviceHeartbeat: now }).where(and(...conditions));
  if (result.meta.changes === 0) {
    return localExecutorError('Lease lost', 409);
  }
  return jsonResponse({ success: true });
}

async function localHandleRunFail(body: Record<string, unknown>, env: LocalExecutorHostEnv): Promise<Response> {
  const runId = typeof body.runId === 'string' ? body.runId : null;
  const serviceId = readRunServiceId(body);
  const leaseVersion = typeof body.leaseVersion === 'number' ? body.leaseVersion : undefined;
  const errorMessage = typeof body.error === 'string' ? body.error : null;
  if (!runId || !serviceId) return localExecutorError('Missing runId or serviceId', 400);
  if (!errorMessage?.trim()) return localExecutorError('Missing error', 400);

  const db = getDb(env.DB);
  const conditions = [eq(runs.id, runId), eq(runs.serviceId, serviceId), eq(runs.status, 'running')];
  if (typeof leaseVersion === 'number') conditions.push(eq(runs.leaseVersion, leaseVersion));
  const result = await db.update(runs).set({
    status: 'failed',
    error: errorMessage,
    completedAt: new Date().toISOString(),
  }).where(and(...conditions));
  return jsonResponse({ success: true, updated: result.meta.changes > 0 });
}

async function localHandleRunReset(body: Record<string, unknown>, env: LocalExecutorHostEnv): Promise<Response> {
  const runId = typeof body.runId === 'string' ? body.runId : null;
  const serviceId = readRunServiceId(body);
  if (!runId || !serviceId) return localExecutorError('Missing runId or serviceId', 400);
  const db = getDb(env.DB);
  await db.update(runs)
    .set({ status: 'queued', serviceId: null, serviceHeartbeat: null })
    .where(and(eq(runs.id, runId), eq(runs.serviceId, serviceId), eq(runs.status, 'running')));
  return jsonResponse({ success: true });
}

async function localHandleRunContext(body: Record<string, unknown>, env: LocalExecutorHostEnv): Promise<Response> {
  const runId = typeof body.runId === 'string' ? body.runId : null;
  if (!runId) return localExecutorError('Missing runId', 400);

  const db = getDb(env.DB);
  const run = await db.select({
    status: runs.status,
    threadId: runs.threadId,
    sessionId: runs.sessionId,
  }).from(runs).where(eq(runs.id, runId)).get();

  if (!run) {
    return jsonResponse({
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

  return jsonResponse({
    status: run.status ?? null,
    threadId: run.threadId ?? null,
    sessionId: run.sessionId ?? null,
    lastUserMessage: latestUserMessage?.content ?? null,
  });
}

async function localHandleNoLlmComplete(body: Record<string, unknown>, env: LocalExecutorHostEnv): Promise<Response> {
  const runId = typeof body.runId === 'string' ? body.runId : null;
  const serviceId = readRunServiceId(body);
  const response = typeof body.response === 'string' ? body.response : null;
  if (!runId || !serviceId) return localExecutorError('Missing runId or serviceId', 400);
  if (!response?.trim()) return localExecutorError('Missing response', 400);

  const db = getDb(env.DB);
  const run = await db.select({
    id: runs.id,
    threadId: runs.threadId,
    sessionId: runs.sessionId,
    serviceId: runs.serviceId,
  }).from(runs).where(eq(runs.id, runId)).get();

  if (!run) return localExecutorError('Run not found', 404);
  if (run.serviceId !== serviceId) return localExecutorError('Run service mismatch', 409);

  if (run.threadId) {
    await persistMessage(
      { db: env.DB, env: env as never, threadId: run.threadId },
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
  } catch {
    // Local completion should not fail on notifier transport issues.
  }

  return jsonResponse({ success: true });
}

async function localHandleExecutorControlRpc(request: Request, env: LocalExecutorHostEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  const runId = request.headers.get('X-Takos-Run-Id');
  const token = readBearerToken(request.headers.get('Authorization'));
  if (!runId || !token) return localExecutorUnauthorized();

  const stub = getLocalExecutorGatewayBinding(env, runId);
  const tokenInfo = await stub.verifyProxyToken(token);
  if (!tokenInfo || tokenInfo.capability !== 'control') return localExecutorUnauthorized();

  const body = request.method === 'POST'
    ? await request.json().catch(() => ({}))
    : Object.fromEntries(new URL(request.url).searchParams.entries());

  if (typeof body === 'object' && body !== null) {
    const bodyRunId = typeof (body as Record<string, unknown>).runId === 'string'
      ? (body as Record<string, unknown>).runId as string
      : null;
    const bodyServiceId = readRunServiceId(body as Record<string, unknown>);
    if (bodyRunId && bodyRunId !== tokenInfo.runId) return localExecutorUnauthorized();
    if (bodyServiceId && bodyServiceId !== tokenInfo.serviceId) return localExecutorUnauthorized();
  }

  recordLocalExecutorProxyUsage(path);

  switch (path) {
    case '/rpc/control/heartbeat':
      return localHandleHeartbeat(body as Record<string, unknown>, env);
    case '/rpc/control/run-status':
      return localHandleRunStatus(body as Record<string, unknown>, env);
    case '/rpc/control/run-record':
      return localHandleRunRecord(body as Record<string, unknown>, env);
    case '/rpc/control/run-bootstrap':
      return localHandleRunBootstrap(typeof (body as Record<string, unknown>).runId === 'string' ? (body as Record<string, unknown>).runId as string : '', env);
    case '/rpc/control/run-fail':
      return localHandleRunFail(body as Record<string, unknown>, env);
    case '/rpc/control/run-reset':
      return localHandleRunReset(body as Record<string, unknown>, env);
    case '/rpc/control/api-keys':
      return jsonResponse({
        openai: env.OPENAI_API_KEY ?? null,
        anthropic: env.ANTHROPIC_API_KEY ?? null,
        google: env.GOOGLE_API_KEY ?? null,
      });
    case '/rpc/control/billing-run-usage': {
      const billingRunId = typeof (body as Record<string, unknown>).runId === 'string'
        ? (body as Record<string, unknown>).runId as string
        : null;
      if (!billingRunId) return localExecutorError('Missing runId', 400);
      await recordRunUsageBatch(env as never, billingRunId);
      return jsonResponse({ recorded: true });
    }
    case '/rpc/control/run-context':
      return localHandleRunContext(body as Record<string, unknown>, env);
    case '/rpc/control/no-llm-complete':
      return localHandleNoLlmComplete(body as Record<string, unknown>, env);
    default:
      return localExecutorError(`Unsupported local executor control RPC: ${path}`, 501);
  }
}

async function buildLocalExecutorHostFetch(env: LocalExecutorHostEnv): Promise<LocalFetch> {
  return async (request, _executionContext = createLocalExecutionContext()) => {
    const url = new URL(request.url);

    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ status: 'ok', service: 'takos-executor-host' });
    }

    if (url.pathname === '/internal/proxy-usage' && request.method === 'GET') {
      return jsonResponse({
        status: 'ok',
        service: 'takos-executor-host',
        counts: getLocalExecutorProxyUsageSnapshot(),
      });
    }

    if (url.pathname === '/dispatch' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as AgentExecutorDispatchPayload | null;
      const serviceId = body?.serviceId || body?.workerId;
      if (!body?.runId || !serviceId) {
        return localExecutorError('Missing runId or serviceId', 400);
      }
      body.serviceId = serviceId;
      body.workerId = body.workerId || serviceId;
      const stub = getLocalExecutorGatewayBinding(env, body.runId);
      const result = await stub.dispatchStart(body);
      return new Response(result.body, { status: result.status });
    }

    if (url.pathname.startsWith('/rpc/control/')) {
      return localHandleExecutorControlRpc(request, env);
    }

    return new Response('takos-executor-host', { status: 200 });
  };
}

function createLocalBrowserGatewayStub(browserServiceUrl: string | null = null): LocalBrowserGatewayStub {
  const tokens = new Map<string, BrowserSessionTokenInfo>();
  let state: BrowserSessionState | null = null;

  return {
    async createSession(payload: CreateSessionPayload) {
      const proxyToken = crypto.randomUUID().replace(/-/g, '');
      tokens.set(proxyToken, {
        sessionId: payload.sessionId,
        spaceId: payload.spaceId,
        userId: payload.userId,
      });
      state = {
        sessionId: payload.sessionId,
        spaceId: payload.spaceId,
        userId: payload.userId,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      if (browserServiceUrl) {
        const response = await globalThis.fetch(buildServiceRequest(browserServiceUrl, '/internal/bootstrap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: payload.url,
            viewport: payload.viewport,
          }),
        }));
        if (!response.ok) {
          throw new Error(`Browser bootstrap failed: ${await response.text()}`);
        }
      }
      state = state ? { ...state, status: 'active' } : state;
      return { ok: true, proxyToken };
    },
    async verifyProxyToken(token: string) {
      return tokens.get(token) ?? null;
    },
    async getSessionState() {
      return state;
    },
    async destroySession() {
      state = state ? { ...state, status: 'stopped' } : null;
      tokens.clear();
    },
    async forwardToContainer(path: string, init?: RequestInit) {
      if (browserServiceUrl) {
        return globalThis.fetch(buildServiceRequest(browserServiceUrl, path, init));
      }
      const request = new Request(`http://browser.local${path}`, init);
      return this.fetch(request);
    },
    async fetch(request: Request) {
      const url = new URL(request.url);
      if (url.pathname === '/internal/healthz') {
        return new Response('ok', { status: 200 });
      }
      if (url.pathname === '/internal/bootstrap' && request.method === 'POST') {
        return jsonResponse({ ok: true, bootstrapped: true }, 200);
      }
      return jsonResponse({ ok: true, path: url.pathname });
    },
  };
}

async function createRuntimeHostEnvForTests() {
  const webFetch = await createLocalWebFetchForTests();
  const stub = createLocalRuntimeGatewayStub(
    resolveOptionalServiceForwardUrl('TAKOS_LOCAL_RUNTIME_URL', DEFAULT_LOCAL_SERVICE_PORTS.runtime),
  );
  const runtimeFactory = () => stub as unknown as DurableObjectStub;
  const runtimeNamespace = createInMemoryDurableObjectNamespace(runtimeFactory) as unknown as DurableNamespaceBinding;
  return {
    RUNTIME_CONTAINER: runtimeNamespace,
    TAKOS_WEB: { fetch: (request: Request) => webFetch(request) },
    ADMIN_DOMAIN: process.env.ADMIN_DOMAIN ?? 'admin.localhost',
    PROXY_BASE_URL: process.env.PROXY_BASE_URL ?? 'http://runtime-host.local',
  };
}

async function createRuntimeHostEnv() {
  const stub = createLocalRuntimeGatewayStub(
    resolveOptionalServiceForwardUrl('TAKOS_LOCAL_RUNTIME_URL', DEFAULT_LOCAL_SERVICE_PORTS.runtime),
  );
  const runtimeFactory = () => stub as unknown as DurableObjectStub;
  const runtimeNamespace = createInMemoryDurableObjectNamespace(runtimeFactory) as unknown as DurableNamespaceBinding;
  return {
    RUNTIME_CONTAINER: runtimeNamespace,
    TAKOS_WEB: createForwardingBinding(resolveServiceUrl('TAKOS_LOCAL_WEB_URL', DEFAULT_LOCAL_PORTS.web)),
    ADMIN_DOMAIN: process.env.ADMIN_DOMAIN ?? 'admin.localhost',
    PROXY_BASE_URL: process.env.PROXY_BASE_URL ?? `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.runtimeHost}`,
  };
}

async function createExecutorHostEnvForTests() {
  const baseEnv = await createTakosWebEnv();
  const runtimeFetch = await createLocalRuntimeHostFetchForTests();
  const browserFetch = await createLocalBrowserHostFetchForTests();
  const stub = createLocalExecutorGatewayStub(
    resolveOptionalServiceForwardUrl('TAKOS_LOCAL_EXECUTOR_URL', DEFAULT_LOCAL_SERVICE_PORTS.executor),
  );
  const executorFactory = () => stub as unknown as DurableObjectStub;
  const executorNamespace = createInMemoryDurableObjectNamespace(executorFactory) as unknown as DurableNamespaceBinding;

  return {
    ...baseEnv,
    EXECUTOR_CONTAINER: executorNamespace,
    TAKOS_EGRESS: { fetch: async (request: Request) => globalThis.fetch(request) },
    RUNTIME_HOST: { fetch: async (request: Request) => runtimeFetch(request) },
    BROWSER_HOST: { fetch: async (request: Request) => browserFetch(request) },
    CONTROL_RPC_BASE_URL: process.env.CONTROL_RPC_BASE_URL
      ?? `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.executorHost}`,
    PROXY_BASE_URL: process.env.PROXY_BASE_URL ?? 'http://executor-host.local',
  };
}

async function createExecutorHostEnv() {
  const baseEnv = await createTakosWebEnv();
  const stub = createLocalExecutorGatewayStub(
    resolveOptionalServiceForwardUrl('TAKOS_LOCAL_EXECUTOR_URL', DEFAULT_LOCAL_SERVICE_PORTS.executor),
  );
  const executorFactory = () => stub as unknown as DurableObjectStub;
  const executorNamespace = createInMemoryDurableObjectNamespace(executorFactory) as unknown as DurableNamespaceBinding;

  return {
    ...baseEnv,
    EXECUTOR_CONTAINER: executorNamespace,
    TAKOS_EGRESS: { fetch: async (request: Request) => globalThis.fetch(request) },
    RUNTIME_HOST: createForwardingBinding(resolveServiceUrl('TAKOS_LOCAL_RUNTIME_HOST_URL', DEFAULT_LOCAL_PORTS.runtimeHost)),
    BROWSER_HOST: createForwardingBinding(resolveServiceUrl('TAKOS_LOCAL_BROWSER_HOST_URL', DEFAULT_LOCAL_PORTS.browserHost)),
    CONTROL_RPC_BASE_URL: process.env.CONTROL_RPC_BASE_URL
      ?? `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.executorHost}`,
    PROXY_BASE_URL: process.env.PROXY_BASE_URL ?? `http://127.0.0.1:${DEFAULT_LOCAL_PORTS.executorHost}`,
  };
}

async function createBrowserHostEnvForTests() {
  const stub = createLocalBrowserGatewayStub(
    resolveOptionalServiceForwardUrl('TAKOS_LOCAL_BROWSER_URL', DEFAULT_LOCAL_SERVICE_PORTS.browser),
  );
  const browserFactory = () => stub as unknown as DurableObjectStub;
  const browserNamespace = createInMemoryDurableObjectNamespace(browserFactory) as unknown as DurableNamespaceBinding;
  return {
    BROWSER_CONTAINER: browserNamespace,
    BROWSER_CHECKPOINTS: undefined,
    TAKOS_EGRESS: { fetch: async (request: Request) => globalThis.fetch(request) },
  };
}

async function createBrowserHostEnv() {
  const stub = createLocalBrowserGatewayStub(
    resolveOptionalServiceForwardUrl('TAKOS_LOCAL_BROWSER_URL', DEFAULT_LOCAL_SERVICE_PORTS.browser),
  );
  const browserFactory = () => stub as unknown as DurableObjectStub;
  const browserNamespace = createInMemoryDurableObjectNamespace(browserFactory) as unknown as DurableNamespaceBinding;
  return {
    BROWSER_CONTAINER: browserNamespace,
    BROWSER_CHECKPOINTS: undefined,
    TAKOS_EGRESS: { fetch: async (request: Request) => globalThis.fetch(request) },
  };
}

export async function createLocalRuntimeHostFetch(): Promise<LocalFetch> {
  const env = await createRuntimeHostEnv();
  return buildLocalRuntimeHostFetch(env);
}

export async function createLocalExecutorHostFetch(): Promise<LocalFetch> {
  const env = await createExecutorHostEnv();
  return buildLocalExecutorHostFetch(env);
}

export async function createLocalBrowserHostFetch(): Promise<LocalFetch> {
  const env = await createBrowserHostEnv();
  return buildLocalBrowserHostFetch(env);
}

export async function createLocalRuntimeHostFetchForTests(): Promise<LocalFetch> {
  const env = await createRuntimeHostEnvForTests();
  return buildLocalRuntimeHostFetch(env);
}

export async function createLocalExecutorHostFetchForTests(): Promise<LocalFetch> {
  const env = await createExecutorHostEnvForTests();
  return buildLocalExecutorHostFetch(env);
}

export async function createLocalBrowserHostFetchForTests(): Promise<LocalFetch> {
  const env = await createBrowserHostEnvForTests();
  return buildLocalBrowserHostFetch(env);
}
