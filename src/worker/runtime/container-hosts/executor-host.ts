/**
 * Executor container host handler
 *
 * Hosts tiered executor containers (runtime containers DO sidecars) and
 * forwards container control RPC to the main takos worker. In Cloudflare
 * deployments this is called in-process by the unified takos Worker.
 *
 * Architecture:
 *   takos-worker → POST /dispatch → this worker → container.dispatchStart(...)
 *   container → POST /api/internal/v1/agent-control/* → this worker → takosumi
 *
 * Implementation is split across focused modules:
 *   - executor-utils.ts        — types, response helpers, error classification, proxy usage
 *   - executor-auth.ts         — control RPC capability mapping
 *   - executor-dispatch.ts     — container dispatch logic
 *   - executor-proxy-config.ts — proxy config / token generation
 */

import type {
  DurableObjectStateBinding,
  PlatformHandler,
  PlatformScheduledEvent,
} from "../../shared/types/bindings.ts";

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

import { constantTimeEqualsString } from "takosumi-contract/internal-crypto";
import { logError } from "../../shared/utils/logger.ts";
import {
  errorJsonResponse,
  jsonResponse,
} from "../../shared/utils/http-response.ts";

import {
  err,
  getExecutorPoolConfig,
  getProxyUsageSnapshot,
  isAgentControlRpcPath,
  isControlRpcPath,
  parseExecutorTier,
  proxyScopesForRunKind,
  recordProxyUsage,
  resolveContainerNamespace,
  resolveExecutorTierCapacity,
  unauthorized,
} from "./executor-utils.ts";
import { dispatchControlRpc } from "../executor-proxy-api.ts";
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
  isProxyRequestAuthorized,
} from "./executor-auth.ts";

// ---------------------------------------------------------------------------
// Public executor-host helper exports
// ---------------------------------------------------------------------------

export type { AgentExecutorEnv, ProxyTokenInfo };
export { getRequiredProxyCapability };

// ---------------------------------------------------------------------------
// Durable Objects — Tiered executor containers
//
// Three tiers share the same implementation but run on different runtime
// container instance types (configured in the unified wrangler.toml):
//   Tier 1 (lite):   lightweight, always-on, max ~20 instances
//   Tier 2 (basic):  scale-out, max ~200 instances
//   Tier 3 (custom): max memory (12 GiB), max ~25 instances
//
// Explicit `tier` / `executorTier` dispatch payloads target that tier directly.
// Dispatches without a tier use the managed pool: warm tier 1 first, then tier 3
// spillover when configured and available.
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
    /**
     * The Durable Object state binding, retained for blockConcurrencyWhile.
     * The base runtime exposes `ctx` typed only as a storage container, so we
     * keep the full DO state separately to serialize read-modify-write paths.
     */
    private readonly doState: DurableObjectStateBinding<Record<string, never>>;

    constructor(
      ctx: DurableObjectStateBinding<Record<string, never>>,
      env: Env,
    ) {
      super(ctx, env);
      this.doState = ctx;
      this.envVars = {
        ...buildAgentExecutorContainerEnvVars(env),
        EXECUTOR_TIER: String(tier),
        MAX_CONCURRENT_RUNS: String(resolveExecutorTierCapacity(env, tier)),
      };
    }

    private async loadTokenMap(): Promise<Map<string, ProxyTokenInfo>> {
      if (this.cachedTokens) return this.cachedTokens;
      const stored =
        await this.ctx.storage.get<Record<string, ProxyTokenInfo>>(
          "proxyTokens",
        );
      this.cachedTokens = new Map(Object.entries(stored ?? {}));
      return this.cachedTokens;
    }

    private async persistTokenMap(
      tokens: Map<string, ProxyTokenInfo>,
    ): Promise<void> {
      await this.ctx.storage.put("proxyTokens", Object.fromEntries(tokens));
      this.cachedTokens = tokens;
    }

    /** Remove tokens past STALE_PROXY_TOKEN_MS in place; true if any removed. */
    private removeStaleTokens(tokens: Map<string, ProxyTokenInfo>): boolean {
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
      return changed;
    }

    private async pruneStaleTokens(
      tokens: Map<string, ProxyTokenInfo>,
    ): Promise<Map<string, ProxyTokenInfo>> {
      if (this.removeStaleTokens(tokens)) await this.persistTokenMap(tokens);
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
      const executorContainerId = this.getContainerId(body);
      const controlConfig: AgentExecutorControlConfig =
        buildAgentExecutorProxyConfig(this.env);

      // Serialize the capacity check + token reservation + persist so the
      // "At capacity" guard is authoritative under concurrent dispatches.
      // Without this, two concurrent dispatchStart RPCs to the same container
      // DO could both observe size < capacity and both admit, overshooting
      // MAX_CONCURRENT_RUNS. The token insert itself is the reservation.
      const reserved = await this.doState.blockConcurrencyWhile(async () => {
        const tokens = await this.loadTokenMap();
        const capacity = resolveExecutorTierCapacity(this.env, tier);
        if (tokens.size >= capacity) {
          return { admitted: false as const, active: tokens.size, capacity };
        }
        const now = Date.now();
        tokens.set(controlConfig.controlRpcToken, {
          runId: body.runId,
          serviceId,
          // Mint the least-privilege scope SET for this run kind. Agent runs
          // get the full scope set; workflow runs get the reduced set (no
          // conversation / memory / skills). Defaults to the agent set when
          // runKind is unset (back-compat).
          capability: proxyScopesForRunKind(body.runKind),
          executorTier: tier,
          executorContainerId,
          startedAt: now,
          lastHeartbeatAt: now,
        });
        await this.persistTokenMap(tokens);
        return { admitted: true as const };
      });

      if (!reserved.admitted) {
        return {
          ok: false,
          status: 503,
          body: JSON.stringify({
            error: "At capacity",
            tier,
            active: reserved.active,
            capacity: reserved.capacity,
          }),
        };
      }

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
        if (constantTimeEqualsString(token, storedToken)) return info;
      }
      return null;
    }

    async touchProxyToken(token: string): Promise<void> {
      const tokens = await this.loadTokenMap();
      const info = tokens.get(token);
      if (!info) return;
      tokens.set(token, { ...info, lastHeartbeatAt: Date.now() });
      // Reap stale tokens on the heartbeat path so GC no longer depends on
      // dispatch traffic. This path already persists, so it adds no extra write.
      this.removeStaleTokens(tokens);
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
/**
 * Tier 2 — basic instances. RESERVED / currently unused: the managed pool
 * (`selectExecutorPoolSlot`) routes tier 1 → tier 3 and never selects tier 2,
 * and no caller requests tier 2 via `resolveContainerNamespace`, so this class
 * receives no traffic today. It is kept (not deleted) because removing a Durable
 * Object class requires a wrangler `deleted_classes` migration in the deploy
 * config. To fully remove it: drop the class + the `EXECUTOR_CONTAINER_TIER2`
 * binding + add the `deleted_classes` migration. To put it back in rotation: add
 * tier-2 pool sizing and select it in
 * `selectExecutorPoolSlot`.
 */
export const ExecutorContainerTier2 = createExecutorContainerClass(2, "5m");
/** Tier 3 — large instances, max memory */
export const ExecutorContainerTier3 = createExecutorContainerClass(3, "3m");
/** Stable class name retained because Wrangler Durable Object migrations bind it. */
export const TakosAgentExecutorContainer = ExecutorContainerTier1;

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

// Cached environment validation guard.
const envGuard = createEnvGuard(validateExecutorHostEnv);
const STALE_PROXY_TOKEN_MS = 15 * 60 * 1000;

function poolSlotId(env: Env, tier: ExecutorTier, index: number): string {
  const suffix = normalizePoolRevision(env.EXECUTOR_POOL_REVISION);
  const base =
    tier === 1 ? `tier1-warm-${index}` : `tier${tier}-scale-${index}`;
  return suffix ? `${base}-${suffix}` : base;
}

function normalizePoolRevision(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const revision = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return revision || null;
}

function dispatchPayloadWithContainerControl(
  env: Env,
  body: AgentExecutorDispatchPayload,
): AgentExecutorDispatchPayload {
  const controlRpcBaseUrl = env.TAKOS_AGENT_CONTROL_RPC_BASE_URL?.trim();
  const startToken = env.TAKOS_AGENT_START_TOKEN?.trim();
  return {
    ...body,
    ...(controlRpcBaseUrl ? { controlRpcBaseUrl } : {}),
    ...(startToken ? { startToken } : {}),
  };
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
  const load = stub.getLoad
    ? await stub.getLoad()
    : {
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

async function selectExecutorPoolSlot(env: Env): Promise<{
  tier: ExecutorTier;
  containerId: string;
  stub: ExecutorContainerStub;
} | null> {
  const config = getExecutorPoolConfig(env);

  for (let i = 0; i < config.tier1WarmPoolSize; i++) {
    const containerId = poolSlotId(env, 1, i);
    const { stub, load } = await readPoolLoad(env, 1, containerId);
    if (load.active < load.capacity) return { tier: 1, containerId, stub };
  }

  // Tier 2 is intentionally skipped: it has no pool sizing and receives no
  // managed traffic (reserved tier — see ExecutorContainerTier2). The pool
  // scales tier 1 → tier 3 only.
  if (!env.EXECUTOR_CONTAINER_TIER3) return null;

  let best: {
    tier: ExecutorTier;
    containerId: string;
    stub: ExecutorContainerStub;
    load: ExecutorPoolLoad;
  } | null = null;
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
      // `scope: "isolate"` — these counts are per-Workers-isolate and reset on
      // cold start; they are NOT a service-wide aggregate (see executor-utils).
      return jsonResponse({
        status: "ok",
        service: "takos-executor-host",
        scope: "isolate",
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
      const body = (await request.json()) as AgentExecutorDispatchPayload & {
        tier?: unknown;
      };
      const { runId } = body;

      if (!runId) {
        return errorJsonResponse("Missing runId", 400);
      }
      if (!resolveAgentExecutorServiceId(body)) {
        return errorJsonResponse("Missing serviceId or workerId", 400);
      }

      if (body.tier !== undefined || body.executorTier !== undefined) {
        const tier = parseExecutorTier(body.executorTier ?? body.tier);
        const ns = resolveContainerNamespace(env, tier);
        const containerId = body.executorContainerId || runId;
        const stub = ns.getByName(containerId);
        return await forwardAgentExecutorDispatch(
          stub,
          dispatchPayloadWithContainerControl(env, {
            ...body,
            executorTier: tier,
            executorContainerId: containerId,
          }),
        );
      }

      const selected = await selectExecutorPoolSlot(env);
      if (!selected) {
        return errorJsonResponse("No executor capacity available", 503);
      }
      return await forwardAgentExecutorDispatch(
        selected.stub,
        dispatchPayloadWithContainerControl(env, {
          ...body,
          executorTier: selected.tier,
          executorContainerId: selected.containerId,
        }),
      );
    }

    if (path.startsWith("/proxy/")) {
      return unauthorized();
    }

    // Control RPC paths are called by executor/container with per-run tokens.
    if (isAgentControlRpcPath(path)) {
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

      // Build claims-equivalent object for existing validation logic. The
      // capability may be a scope array or a single concrete scope; normalize to
      // a flat scope list for the claims view.
      const claims: Record<string, unknown> = {
        run_id: tokenInfo.runId,
        service_id: tokenInfo.serviceId,
        worker_id: tokenInfo.serviceId,
        proxy_capabilities: Array.isArray(tokenInfo.capability)
          ? tokenInfo.capability
          : [tokenInfo.capability],
      };

      if (request.method !== "POST" && request.method !== "GET") {
        return err("Method not allowed", 405);
      }

      const body =
        request.method === "POST"
          ? ((await request.json()) as Record<string, unknown>)
          : Object.fromEntries(url.searchParams.entries());

      // Fail closed: bind the request target to the verified proxy token rather
      // than trusting caller-supplied ids. The container holds only this token,
      // so the run/service it was issued for is authoritative. Overwriting (not
      // merely comparing) closes the historical hole where a body that simply
      // omitted runId/serviceId bypassed the per-run scoping — e.g. add-message
      // sends only threadId, so without this it could be steered at any thread.
      body.runId = tokenInfo.runId;
      body.serviceId = tokenInfo.serviceId;
      if (typeof body.workerId === "string") {
        body.workerId = tokenInfo.serviceId;
      }
      if (!claimsMatchRequestBody(claims, body)) {
        return unauthorized();
      }
      // Membership check: the endpoint's required scope must be present in the
      // token's scope set. A workflow token therefore cannot reach conversation
      // / memory / skill endpoints it was not granted.
      if (!isProxyRequestAuthorized(path, tokenInfo.capability)) {
        return unauthorized();
      }

      recordProxyUsage(path);

      if (isControlRpcPath(path)) {
        // Dispatch in-process: takos / takosumi / the executor-host share this
        // worker isolate, so there is no service-binding hop. The proxy token +
        // scope are already verified and body.runId/serviceId are token-bound.
        const dispatched = dispatchControlRpc(path, body, env);
        if (!dispatched) {
          return err(`Unknown control RPC path: ${path}`, 404);
        }
        const forwarded = await dispatched;
        if (
          path === "/api/internal/v1/agent-control/heartbeat" &&
          forwarded.ok
        ) {
          await stub.touchProxyToken?.(token);
        }
        if (shouldRevokeProxyTokensAfterControlForward(path, body)) {
          await revokeProxyTokenAfterTerminalResponse(forwarded, stub, token);
        }
        return forwarded;
      }

      return err(`Unknown proxy path: ${path}`, 404);
    }

    return new Response("takos-executor-host", { status: 200 });
  },

  async scheduled(_event: PlatformScheduledEvent, env: Env): Promise<void> {
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
} satisfies PlatformHandler<Env>;

function isTerminalRunStatus(status: unknown): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function isTerminalRunEvent(type: unknown, data: unknown): boolean {
  if (
    type === "completed" ||
    type === "error" ||
    type === "cancelled" ||
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
    run &&
    typeof run === "object" &&
    isTerminalRunStatus((run as Record<string, unknown>).status),
  );
}

function shouldRevokeProxyTokensAfterControlForward(
  path: string,
  body: Record<string, unknown>,
): boolean {
  if (
    path === "/api/internal/v1/agent-control/run-fail" ||
    path === "/api/internal/v1/agent-control/run-reset" ||
    path === "/api/internal/v1/agent-control/no-llm-complete"
  ) {
    return true;
  }
  if (path === "/api/internal/v1/agent-control/run-event") {
    return isTerminalRunEvent(body.type, body.data);
  }
  if (path === "/api/internal/v1/agent-control/update-run-status") {
    return isTerminalRunStatus(body.status);
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
