/**
 * takos-executor-host Worker
 *
 * Hosts tiered executor containers (CF Containers DO sidecars) and forwards
 * container control RPC to the main takos worker.
 *
 * Architecture:
 *   takos-worker → POST /dispatch → this worker → container.dispatchStart(...)
 *   container → POST /rpc/control/* → this worker → env.TAKOS_CONTROL
 *
 * Implementation is split across focused modules:
 *   - executor-utils.ts        — types, response helpers, error classification, proxy usage
 *   - executor-auth.ts         — control RPC capability mapping
 *   - executor-dispatch.ts     — container dispatch logic
 *   - executor-proxy-config.ts — proxy config / token generation
 */

import type {
  DurableObjectState,
  ExportedHandler,
  ScheduledEvent,
} from "@cloudflare/workers-types";

import { HostContainerRuntime } from "./container-runtime.ts";
import {
  createEnvGuard,
  validateExecutorHostEnv,
} from "../../shared/utils/validate-env.ts";
import {
  type AgentExecutorControlConfig,
  type AgentExecutorDispatchPayload,
  dispatchAgentExecutorStart,
  forwardAgentExecutorDispatch,
  resolveAgentExecutorServiceId,
} from "./executor-dispatch.ts";
import {
  buildAgentExecutorContainerEnvVars,
  buildAgentExecutorProxyConfig,
} from "./executor-proxy-config.ts";

import { constantTimeEqual } from "../../shared/utils/hash.ts";
import { logError } from "../../shared/utils/logger.ts";
import {
  errorJsonResponse,
  jsonResponse,
} from "../../shared/utils/http-response.ts";

import {
  err,
  forwardToControlPlane,
  getExecutorPoolConfig,
  getProxyUsageSnapshot,
  isControlRpcPath,
  parseExecutorTier,
  recordProxyUsage,
  resolveContainerNamespace,
  resolveExecutorTierCapacity,
  unauthorized,
} from "./executor-utils.ts";
import type {
  AgentExecutorEnv,
  Env,
  ExecutorContainerStub,
  ExecutorPoolLoad,
  ExecutorTier,
  ProxyTokenInfo,
} from "./executor-utils.ts";
import {
  claimsMatchRequestBody,
  getRequiredProxyCapability,
} from "./executor-auth.ts";

// ---------------------------------------------------------------------------
// Re-exports — maintain backward compatibility for all external importers
// ---------------------------------------------------------------------------

export type { AgentExecutorEnv, ProxyTokenInfo };
export { getRequiredProxyCapability };

// ---------------------------------------------------------------------------
// Durable Objects — Tiered executor containers
//
// Three tiers share the same implementation but run on different CF Container
// instance types (configured in wrangler.executor.toml):
//   Tier 1 (lite):   lightweight, always-on, max ~20 instances
//   Tier 2 (basic):  scale-out, max ~200 instances
//   Tier 3 (custom): max memory (12 GiB), max ~25 instances
//
// The dispatch handler selects the tier based on a `tier` field in the
// dispatch payload (defaults to tier 1).
// ---------------------------------------------------------------------------

function createExecutorContainerClass(
  tier: ExecutorTier,
  sleepAfterOverride?: string,
) {
  return class extends HostContainerRuntime<Env> {
    defaultPort = 8080;
    sleepAfter = sleepAfterOverride ?? "5m";
    pingEndpoint = "container/health";

    private cachedTokens: Map<string, ProxyTokenInfo> | null = null;

    constructor(ctx: DurableObjectState<Record<string, never>>, env: Env) {
      super(ctx, env);
      this.envVars = {
        ...buildAgentExecutorContainerEnvVars(env),
        EXECUTOR_TIER: String(tier),
        MAX_CONCURRENT_RUNS: String(resolveExecutorTierCapacity(env, tier)),
      };
    }

    private async loadTokenMap(): Promise<Map<string, ProxyTokenInfo>> {
      if (this.cachedTokens) return this.cachedTokens;
      const stored = await this.ctx.storage.get<
        Record<string, ProxyTokenInfo>
      >("proxyTokens");
      this.cachedTokens = new Map(Object.entries(stored ?? {}));
      return this.cachedTokens;
    }

    private async persistTokenMap(
      tokens: Map<string, ProxyTokenInfo>,
    ): Promise<void> {
      await this.ctx.storage.put("proxyTokens", Object.fromEntries(tokens));
      this.cachedTokens = tokens;
    }

    private async pruneStaleTokens(
      tokens: Map<string, ProxyTokenInfo>,
    ): Promise<Map<string, ProxyTokenInfo>> {
      const now = Date.now();
      let changed = false;
      for (const [token, info] of tokens) {
        const lastSeen = info.lastHeartbeatAt ?? info.startedAt;
        if (
          typeof lastSeen === "number" &&
          now - lastSeen > STALE_PROXY_TOKEN_MS
        ) {
          tokens.delete(token);
          changed = true;
        }
      }
      if (changed) await this.persistTokenMap(tokens);
      return tokens;
    }

    private getContainerId(body?: AgentExecutorDispatchPayload): string {
      return body?.executorContainerId || `tier${tier}-unknown`;
    }

    async getLoad(): Promise<ExecutorPoolLoad> {
      const tokens = await this.pruneStaleTokens(await this.loadTokenMap());
      return {
        tier,
        containerId: this.getContainerId(),
        active: tokens.size,
        capacity: resolveExecutorTierCapacity(this.env, tier),
      };
    }

    async warm(): Promise<ExecutorPoolLoad> {
      await this.startAndWaitForPorts(8080);
      return await this.getLoad();
    }

    async dispatchStart(
      body: AgentExecutorDispatchPayload,
    ): Promise<import("./executor-dispatch.ts").AgentExecutorDispatchResult> {
      const serviceId = resolveAgentExecutorServiceId(body);
      if (!serviceId) {
        return {
          ok: false,
          status: 400,
          body: JSON.stringify({ error: "Missing serviceId or workerId" }),
        };
      }
      const tokens = await this.loadTokenMap();
      const capacity = resolveExecutorTierCapacity(this.env, tier);
      if (tokens.size >= capacity) {
        return {
          ok: false,
          status: 503,
          body: JSON.stringify({
            error: "At capacity",
            tier,
            active: tokens.size,
            capacity,
          }),
        };
      }
      const controlConfig: AgentExecutorControlConfig =
        buildAgentExecutorProxyConfig(this.env, {
          runId: body.runId,
          serviceId,
        });
      const executorContainerId = this.getContainerId(body);
      const now = Date.now();
      tokens.set(controlConfig.controlRpcToken, {
        runId: body.runId,
        serviceId,
        capability: "control",
        executorTier: tier,
        executorContainerId,
        startedAt: now,
        lastHeartbeatAt: now,
      });
      await this.persistTokenMap(tokens);

      try {
        const result = await dispatchAgentExecutorStart(
          {
            startAndWaitForPorts: this.startAndWaitForPorts.bind(this),
            fetch: async (request: Request) => {
              this.renewActivityTimeout();
              const tcpPort = this.container.getTcpPort(8080);
              return await tcpPort.fetch(
                request.url.replace("https:", "http:"),
                request,
              );
            },
          },
          {
            ...body,
            executorTier: tier,
            executorContainerId,
          },
          controlConfig,
        );
        if (!result.ok) {
          await this.revokeProxyToken(controlConfig.controlRpcToken);
        }
        return result;
      } catch (error) {
        await this.revokeProxyToken(controlConfig.controlRpcToken);
        throw error;
      }
    }

    async verifyProxyToken(token: string): Promise<ProxyTokenInfo | null> {
      const tokens = await this.loadTokenMap();
      for (const [storedToken, info] of tokens) {
        if (constantTimeEqual(token, storedToken)) return info;
      }
      return null;
    }

    async touchProxyToken(token: string): Promise<void> {
      const tokens = await this.loadTokenMap();
      const info = tokens.get(token);
      if (!info) return;
      tokens.set(token, { ...info, lastHeartbeatAt: Date.now() });
      await this.persistTokenMap(tokens);
    }

    async revokeProxyToken(token: string): Promise<void> {
      const tokens = await this.loadTokenMap();
      tokens.delete(token);
      await this.persistTokenMap(tokens);
    }

    async revokeProxyTokens(): Promise<void> {
      await this.ctx.storage.delete("proxyTokens");
      this.cachedTokens = new Map();
    }
  };
}

/** Tier 1 — lite instances, always-on, low concurrency */
export const ExecutorContainerTier1 = createExecutorContainerClass(1, "10m");
/** Tier 2 — basic instances, scale-out */
export const ExecutorContainerTier2 = createExecutorContainerClass(2, "5m");
/** Tier 3 — large instances, max memory */
export const ExecutorContainerTier3 = createExecutorContainerClass(3, "3m");
/** Legacy class name kept so existing Durable Object migrations remain valid. */
export const TakosAgentExecutorContainer = ExecutorContainerTier1;

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

// Cached environment validation guard.
const envGuard = createEnvGuard(validateExecutorHostEnv);
const STALE_PROXY_TOKEN_MS = 15 * 60 * 1000;

function poolSlotId(env: Env, tier: ExecutorTier, index: number): string {
  const suffix = normalizePoolRevision(env.EXECUTOR_POOL_REVISION);
  const base = tier === 1
    ? `tier1-warm-${index}`
    : `tier${tier}-scale-${index}`;
  return suffix ? `${base}-${suffix}` : base;
}

function normalizePoolRevision(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const revision = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return revision || null;
}

async function readPoolLoad(
  env: Env,
  tier: ExecutorTier,
  containerId: string,
): Promise<{
  stub: ExecutorContainerStub;
  load: ExecutorPoolLoad;
}> {
  const ns = resolveContainerNamespace(env, tier);
  const stub = ns.getByName(containerId);
  const load = stub.getLoad ? await stub.getLoad() : {
    tier,
    containerId,
    active: 0,
    capacity: resolveExecutorTierCapacity(env, tier),
  };
  return {
    stub,
    load: {
      ...load,
      tier,
      containerId,
      capacity: load.capacity || resolveExecutorTierCapacity(env, tier),
    },
  };
}

async function collectExecutorPoolLoads(env: Env): Promise<ExecutorPoolLoad[]> {
  const config = getExecutorPoolConfig(env);
  const loads: ExecutorPoolLoad[] = [];

  for (let i = 0; i < config.tier1WarmPoolSize; i++) {
    loads.push((await readPoolLoad(env, 1, poolSlotId(env, 1, i))).load);
  }

  if (env.EXECUTOR_CONTAINER_TIER3) {
    for (let i = 0; i < config.tier3PoolSize; i++) {
      loads.push((await readPoolLoad(env, 3, poolSlotId(env, 3, i))).load);
    }
  }

  return loads;
}

async function selectExecutorPoolSlot(env: Env): Promise<
  {
    tier: ExecutorTier;
    containerId: string;
    stub: ExecutorContainerStub;
  } | null
> {
  const config = getExecutorPoolConfig(env);

  for (let i = 0; i < config.tier1WarmPoolSize; i++) {
    const containerId = poolSlotId(env, 1, i);
    const { stub, load } = await readPoolLoad(env, 1, containerId);
    if (load.active < load.capacity) return { tier: 1, containerId, stub };
  }

  if (!env.EXECUTOR_CONTAINER_TIER3) return null;

  let best:
    | {
      tier: ExecutorTier;
      containerId: string;
      stub: ExecutorContainerStub;
      load: ExecutorPoolLoad;
    }
    | null = null;
  for (let i = 0; i < config.tier3PoolSize; i++) {
    const containerId = poolSlotId(env, 3, i);
    const { stub, load } = await readPoolLoad(env, 3, containerId);
    if (load.active >= load.capacity) continue;
    if (!best || load.active < best.load.active) {
      best = { tier: 3, containerId, stub, load };
    }
  }

  if (!best) return null;
  return {
    tier: best.tier,
    containerId: best.containerId,
    stub: best.stub,
  };
}

async function warmTier1Pool(env: Env): Promise<ExecutorPoolLoad[]> {
  const config = getExecutorPoolConfig(env);
  const warmed: ExecutorPoolLoad[] = [];
  for (let i = 0; i < config.tier1WarmPoolSize; i++) {
    const containerId = poolSlotId(env, 1, i);
    const { stub } = await readPoolLoad(env, 1, containerId);
    const load = stub.warm
      ? await stub.warm()
      : (await readPoolLoad(env, 1, containerId)).load;
    warmed.push({ ...load, tier: 1, containerId });
  }
  return warmed;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Validate environment on first request (cached).
    const envError = envGuard(env);
    if (envError) {
      return errorJsonResponse("Configuration Error", 503, {
        message:
          "Executor host is misconfigured. Please contact administrator.",
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health" && request.method === "GET") {
      return jsonResponse({ status: "ok", service: "takos-executor-host" });
    }

    if (path === "/internal/proxy-usage" && request.method === "GET") {
      return jsonResponse({
        status: "ok",
        service: "takos-executor-host",
        counts: getProxyUsageSnapshot(),
      });
    }

    if (path === "/internal/executor-pool" && request.method === "GET") {
      return jsonResponse({
        status: "ok",
        service: "takos-executor-host",
        pools: await collectExecutorPoolLoads(env),
      });
    }

    // /dispatch — called by takos-worker via service binding (same CF account).
    // Service binding provides implicit authentication; no JWT required.
    if (path === "/dispatch" && request.method === "POST") {
      const body = await request.json() as AgentExecutorDispatchPayload & {
        tier?: unknown;
      };
      const { runId } = body;

      if (!runId) {
        return errorJsonResponse("Missing runId", 400);
      }

      if (body.tier !== undefined || body.executorTier !== undefined) {
        const tier = parseExecutorTier(body.executorTier ?? body.tier);
        const ns = resolveContainerNamespace(env, tier);
        const containerId = body.executorContainerId || runId;
        const stub = ns.getByName(containerId);
        return await forwardAgentExecutorDispatch(stub, {
          ...body,
          executorTier: tier,
          executorContainerId: containerId,
        });
      }

      const selected = await selectExecutorPoolSlot(env);
      if (!selected) {
        return errorJsonResponse("No executor capacity available", 503);
      }
      return await forwardAgentExecutorDispatch(selected.stub, {
        ...body,
        executorTier: selected.tier,
        executorContainerId: selected.containerId,
      });
    }

    // /proxy/* and /rpc/control/* — called by executor/container with per-run tokens
    if (path.startsWith("/proxy/") || path.startsWith("/rpc/control/")) {
      const runId = request.headers.get("X-Takos-Run-Id");
      const authHeader = request.headers.get("Authorization");
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7).trim() || null
        : null;
      const tier = parseExecutorTier(
        request.headers.get("X-Takos-Executor-Tier"),
      );
      const executorContainerId = request.headers.get(
        "X-Takos-Executor-Container-Id",
      );
      if (!runId || !token) {
        return unauthorized();
      }

      // Verify token via DO RPC (DO stores the random tokens generated at dispatch)
      const ns = resolveContainerNamespace(env, tier);
      const stub = ns.getByName(executorContainerId || runId);
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

      if (request.method !== "POST" && request.method !== "GET") {
        return err("Method not allowed", 405);
      }

      const body = request.method === "POST"
        ? await request.json() as Record<string, unknown>
        : Object.fromEntries(url.searchParams.entries());
      if (!claimsMatchRequestBody(claims, body)) {
        return unauthorized();
      }
      const requiredCapability = getRequiredProxyCapability(path);
      if (!requiredCapability || requiredCapability !== tokenInfo.capability) {
        return unauthorized();
      }

      recordProxyUsage(path);

      if (isControlRpcPath(path)) {
        const forwarded = await forwardToControlPlane(path, body, env);
        if (!forwarded) {
          return err(`Unknown control RPC path: ${path}`, 404);
        }
        if (path === "/rpc/control/heartbeat" && forwarded.ok) {
          await stub.touchProxyToken?.(token);
        }
        if (
          shouldRevokeProxyTokensAfterControlForward(path, body)
        ) {
          await revokeProxyTokenAfterTerminalResponse(forwarded, stub, token);
        }
        return forwarded;
      }

      return err(`Unknown proxy path: ${path}`, 404);
    }

    return new Response("takos-executor-host", { status: 200 });
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const envError = envGuard(env);
    if (envError) return;
    try {
      await warmTier1Pool(env);
    } catch (error) {
      logError("Executor warm pool cron failed", error, {
        module: "executor-host",
      });
    }
  },
} satisfies ExportedHandler<Env>;

function isTerminalRunStatus(status: unknown): boolean {
  return status === "completed" || status === "failed" ||
    status === "cancelled";
}

function isTerminalRunEvent(type: unknown, data: unknown): boolean {
  if (
    type === "completed" || type === "error" || type === "cancelled" ||
    type === "run.failed"
  ) {
    return true;
  }
  if (type !== "run_status" || !data || typeof data !== "object") {
    return false;
  }
  const payload = data as Record<string, unknown>;
  if (isTerminalRunStatus(payload.status)) {
    return true;
  }
  const run = payload.run;
  return Boolean(
    run && typeof run === "object" &&
      isTerminalRunStatus((run as Record<string, unknown>).status),
  );
}

function shouldRevokeProxyTokensAfterControlForward(
  path: string,
  body: Record<string, unknown>,
): boolean {
  if (
    path === "/proxy/run/fail" ||
    path === "/rpc/control/run-fail" ||
    path === "/proxy/run/reset" ||
    path === "/rpc/control/run-reset" ||
    path === "/rpc/control/no-llm-complete"
  ) {
    return true;
  }
  if (path === "/rpc/control/run-event") {
    return isTerminalRunEvent(body.type, body.data);
  }
  return false;
}

async function revokeProxyTokenAfterTerminalResponse(
  response: Response,
  stub: {
    revokeProxyToken?(token: string): Promise<void>;
    revokeProxyTokens?(): Promise<void>;
  },
  token: string,
): Promise<void> {
  if (!response.ok) {
    return;
  }
  try {
    if (stub.revokeProxyToken) {
      await stub.revokeProxyToken(token);
      return;
    }
    await stub.revokeProxyTokens?.();
  } catch (error) {
    logError("Proxy token revoke failed after terminal control RPC", error, {
      module: "executor-host",
    });
  }
}
