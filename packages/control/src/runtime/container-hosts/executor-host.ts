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
 *
 * Implementation is split across focused modules:
 *   - executor-utils.ts        — types, response helpers, error classification, proxy usage
 *   - executor-auth.ts         — capability mapping, resource access validation
 *   - executor-run-state.ts    — run lifecycle DB handlers (heartbeat, status, fail, reset, …)
 *   - executor-control-rpc.ts  — control-plane RPC handlers (tools, memory, messages, events)
 *   - executor-proxy-handlers.ts — binding proxy handlers (DB, R2, DO, Vectorize, AI, …)
 *   - executor-dispatch.ts     — container dispatch logic
 *   - executor-proxy-config.ts — proxy config / token generation
 */

import {
  HostContainerInternals,
  HostContainerRuntime,
} from './container-runtime.ts';
import { recordRunUsageBatch } from '../../application/services/billing/billing';
import { validateExecutorHostEnv, createEnvGuard } from '../../shared/utils/validate-env';
import {
  dispatchAgentExecutorStart,
  forwardAgentExecutorDispatch,
  resolveAgentExecutorServiceId,
  type AgentExecutorDispatchPayload,
  type AgentExecutorControlConfig,
} from './executor-dispatch';
import {
  buildAgentExecutorContainerEnvVars,
  buildAgentExecutorProxyConfig,
} from './executor-proxy-config';
import { extractBearerToken } from '../../shared/utils';
import { constantTimeEqual } from '../../shared/utils/hash';
import { logError } from '../../shared/utils/logger';

// Sub-module imports — utilities, auth, run state, control RPC, proxy handlers
import {
  ok,
  err,
  unauthorized,
  recordProxyUsage,
  getProxyUsageSnapshot,
  isControlRpcPath,
  forwardToControlPlane,
} from './executor-utils';
import type {
  AgentExecutorEnv,
  ProxyTokenInfo,
  Env,
} from './executor-utils';
import {
  getRequiredProxyCapability,
  validateProxyResourceAccess,
  claimsMatchRequestBody,
} from './executor-auth';
import {
  handleHeartbeat,
  handleRunStatus,
  handleRunRecord,
  handleRunBootstrap,
  handleRunFail,
  handleRunReset,
  handleRunContext,
  handleNoLlmComplete,
  handleCurrentSession,
  handleIsCancelled,
} from './executor-run-state';
import {
  handleConversationHistory,
  handleSkillPlan,
  handleMemoryActivation,
  handleMemoryFinalize,
  handleAddMessage,
  handleUpdateRunStatus,
  handleToolCatalog,
  handleToolExecute,
  handleToolCleanup,
  handleRunEvent,
} from './executor-control-rpc';
import {
  handleDbProxy,
  handleR2Proxy,
  handleNotifierProxy,
  handleVectorizeProxy,
  handleAiProxy,
  handleEgressProxy,
  handleRuntimeProxy,
  handleBrowserProxy,
  handleQueueProxy,
} from './executor-proxy-handlers';

// ---------------------------------------------------------------------------
// Re-exports — maintain backward compatibility for all external importers
// ---------------------------------------------------------------------------

export type { AgentExecutorEnv, ProxyTokenInfo };
export { getRequiredProxyCapability, validateProxyResourceAccess };

// ---------------------------------------------------------------------------
// Durable Object — TakosAgentExecutorContainer
// ---------------------------------------------------------------------------

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

  async dispatchStart(body: AgentExecutorDispatchPayload): Promise<import('./executor-dispatch').AgentExecutorDispatchResult> {
    const serviceId = resolveAgentExecutorServiceId(body);
    if (!serviceId) {
      return {
        ok: false,
        status: 400,
        body: JSON.stringify({ error: 'Missing serviceId or workerId' }),
      };
    }
    const controlConfig: AgentExecutorControlConfig = buildAgentExecutorProxyConfig(this.env, {
      runId: body.runId,
      serviceId,
    });
    const tokenMap: Record<string, ProxyTokenInfo> = {
      [controlConfig.controlRpcToken]: { runId: body.runId, serviceId, capability: 'control' },
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
        service_id: tokenInfo.serviceId,
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

      // Forward control RPC paths to the main takos-web worker if TAKOS_CONTROL
      // service binding is configured. This allows executor-host to be deployed
      // independently without direct imports from the control package internals.
      // When TAKOS_CONTROL is not configured, falls through to the legacy local handlers.
      if (isControlRpcPath(path)) {
        const forwarded = await forwardToControlPlane(path, body, env);
        if (forwarded) return forwarded;
      }

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
