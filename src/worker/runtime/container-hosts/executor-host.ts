/**
 * Executor container host handler
 *
 * Hosts tiered executor containers (runtime containers DO sidecars) and
 * forwards container control RPC to the main takos worker. In Cloudflare
 * deployments this is called in-process by the unified takos Worker.
 *
 * Architecture:
 *   takos-worker → POST /dispatch → this worker → container.dispatchStart(...)
 *   container → POST /api/internal/v1/agent-control/* → Takos Worker handlers
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
import { assertRunExecutionAccess } from "./executor-run-state.ts";
import {
  abortRemoteToolExecutorsForLease,
  abortRemoteToolExecutorsForRun,
  abortSupersededRemoteToolExecutors,
  ensureRunLease,
} from "./executor-control-rpc.ts";

// ---------------------------------------------------------------------------
// Public executor-host helper exports
// ---------------------------------------------------------------------------

export type { AgentExecutorEnv, ProxyTokenInfo };
export { getRequiredProxyCapability };

export const STALE_PROXY_TOKEN_MS = 15 * 60 * 1000;

const DEFAULT_AGENT_CONTROL_BODY_BYTES = 2 * 1024 * 1024;
const AGENT_CONTROL_BODY_LIMITS: Readonly<Record<string, number>> = {
  "/api/internal/v1/agent-control/run-event": 128 * 1024,
  "/api/internal/v1/agent-control/tool-execute": 512 * 1024,
  "/api/internal/v1/agent-control/engine-checkpoint-save": 2 * 1024 * 1024,
  "/api/internal/v1/agent-control/complete-run": 10 * 1024 * 1024,
  "/api/internal/v1/agent-control/engine-checkpoint-save": 17 * 1024 * 1024,
};

export class AgentControlBodyError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413,
  ) {
    super(message);
  }
}

/** Read a control body without letting chunked requests bypass endpoint caps. */
export async function readBoundedAgentControlJson(
  request: Request,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new AgentControlBodyError("Control RPC body is too large", 413);
  }
  if (!request.body) {
    throw new AgentControlBodyError("Invalid control RPC JSON", 400);
  }
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AgentControlBodyError("Control RPC body is too large", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AgentControlBodyError("Invalid control RPC JSON", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AgentControlBodyError(
      "Control RPC body must be a JSON object",
      400,
    );
  }
  return parsed as Record<string, unknown>;
}

/**
 * Read the protocol advertised by a successfully started container image.
 * Missing/invalid fields deliberately remain v1-compatible during a rolling
 * deployment; only the exact v2 contract upgrades the reserved token.
 */
export function runtimeProtocolVersionFromStartResult(result: {
  ok: boolean;
  body: string;
}): 2 | undefined {
  if (!result.ok) return undefined;
  try {
    const payload = JSON.parse(result.body) as Record<string, unknown>;
    return payload.runtimeProtocolVersion === 2 ? 2 : undefined;
  } catch {
    return undefined;
  }
}

/** Upgrade only the random token that received the matching `/start`. */
export function upgradeProxyTokenRuntimeProtocol(
  tokens: Map<string, ProxyTokenInfo>,
  token: string,
  expected: Pick<ProxyTokenInfo, "runId" | "serviceId" | "leaseVersion">,
  version: 2,
): boolean {
  const info = tokens.get(token);
  if (
    !info ||
    !proxyTokenMatchesLease(
      info,
      expected.runId,
      expected.serviceId,
      expected.leaseVersion,
    ) ||
    info.runtimeProtocolVersion === version
  ) {
    return false;
  }
  tokens.set(token, { ...info, runtimeProtocolVersion: version });
  return true;
}

/** The run lease identity that makes a proxy token authoritative. */
export function proxyTokenMatchesLease(
  info: Pick<ProxyTokenInfo, "runId" | "serviceId" | "leaseVersion">,
  runId: string,
  serviceId: string,
  leaseVersion?: number,
): boolean {
  return (
    info.runId === runId &&
    info.serviceId === serviceId &&
    info.leaseVersion === leaseVersion
  );
}

/** Remove every token for a run, returning the number removed. */
export function removeProxyTokensForRun(
  tokens: Map<string, ProxyTokenInfo>,
  runId: string,
): number {
  let removed = 0;
  for (const [token, info] of tokens) {
    if (info.runId !== runId) continue;
    tokens.delete(token);
    removed++;
  }
  return removed;
}

/** Remove tokens whose last verified heartbeat is older than the TTL. */
export function removeStaleProxyTokens(
  tokens: Map<string, ProxyTokenInfo>,
  nowMs = Date.now(),
): number {
  let removed = 0;
  for (const [token, info] of tokens) {
    const lastSeen = info.lastHeartbeatAt ?? info.startedAt;
    if (
      typeof lastSeen !== "number" ||
      !Number.isFinite(lastSeen) ||
      lastSeen > nowMs + 60_000 ||
      nowMs - lastSeen > STALE_PROXY_TOKEN_MS
    ) {
      tokens.delete(token);
      removed++;
    }
  }
  return removed;
}

/** Remove every token for one exact (possibly stale) run lease. */
export function removeProxyTokensForLease(
  tokens: Map<string, ProxyTokenInfo>,
  runId: string,
  serviceId: string,
  leaseVersion?: number,
): number {
  let removed = 0;
  for (const [token, info] of tokens) {
    if (!proxyTokenMatchesLease(info, runId, serviceId, leaseVersion)) {
      continue;
    }
    tokens.delete(token);
    removed++;
  }
  return removed;
}

/**
 * Remove leases older than the newly claimed one without ever deleting a
 * higher-version token. That monotonic guard makes a delayed /dispatch safe:
 * if lease N+1 is claimed while lease N is sweeping the pool, N cannot revoke
 * N+1's token. Equal-version mismatches are invalid and are fenced by the DB
 * check before and after the sweep.
 */
export function removeSupersededProxyTokens(
  tokens: Map<string, ProxyTokenInfo>,
  runId: string,
  serviceId: string,
  leaseVersion?: number,
): number {
  let removed = 0;
  for (const [token, info] of tokens) {
    if (info.runId !== runId) continue;
    if (proxyTokenMatchesLease(info, runId, serviceId, leaseVersion)) continue;

    const isHigherVersion =
      typeof info.leaseVersion === "number" &&
      (typeof leaseVersion !== "number" || info.leaseVersion > leaseVersion);
    if (isHigherVersion) continue;

    tokens.delete(token);
    removed++;
  }
  return removed;
}

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
      return removeStaleProxyTokens(tokens) > 0;
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
        // Expired reservations do not consume capacity. Pruning must happen
        // before the size check, not only after a successful heartbeat or on a
        // separate load endpoint, otherwise an idle container can report false
        // exhaustion for up to the lifetime of the Durable Object.
        const tokens = await this.pruneStaleTokens(await this.loadTokenMap());
        const capacity = resolveExecutorTierCapacity(this.env, tier);
        if (tokens.size >= capacity) {
          return { admitted: false as const, active: tokens.size, capacity };
        }
        const now = Date.now();
        tokens.set(controlConfig.controlRpcToken, {
          runId: body.runId,
          serviceId,
          leaseVersion: body.leaseVersion,
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
        const negotiatedVersion = runtimeProtocolVersionFromStartResult(result);
        if (negotiatedVersion === 2) {
          await this.doState.blockConcurrencyWhile(async () => {
            const tokens = await this.loadTokenMap();
            if (
              upgradeProxyTokenRuntimeProtocol(
                tokens,
                controlConfig.controlRpcToken,
                {
                  runId: body.runId,
                  serviceId,
                  leaseVersion: body.leaseVersion,
                },
                negotiatedVersion,
              )
            ) {
              await this.persistTokenMap(tokens);
            }
          });
        }
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
      return await this.doState.blockConcurrencyWhile(async () => {
        // Verification is the authorization boundary, so TTL expiry is
        // enforced here as well as on dispatch/heartbeat maintenance paths.
        const tokens = await this.pruneStaleTokens(await this.loadTokenMap());
        for (const [storedToken, info] of tokens) {
          if (constantTimeEqualsString(token, storedToken)) return info;
        }
        return null;
      });
    }

    async touchProxyToken(token: string): Promise<void> {
      await this.doState.blockConcurrencyWhile(async () => {
        const tokens = await this.loadTokenMap();
        const info = tokens.get(token);
        if (!info) return;
        // The agent runs in the container after /start has already returned.
        // Custom Durable Object RPCs do not renew Container activity
        // automatically, so a healthy background run would otherwise be stopped
        // at sleepAfter (3m on tier 3) despite its control heartbeat. Treat a
        // verified, successful run heartbeat as container activity.
        this.renewActivityTimeout();
        tokens.set(token, { ...info, lastHeartbeatAt: Date.now() });
        // Reap stale tokens on the heartbeat path so GC no longer depends on
        // dispatch traffic. This path already persists, so it adds no extra write.
        this.removeStaleTokens(tokens);
        await this.persistTokenMap(tokens);
      });
    }

    async revokeProxyToken(token: string): Promise<void> {
      await this.doState.blockConcurrencyWhile(async () => {
        const tokens = await this.loadTokenMap();
        if (tokens.delete(token)) await this.persistTokenMap(tokens);
      });
    }

    async revokeProxyTokensForRun(runId: string): Promise<number> {
      return await this.doState.blockConcurrencyWhile(async () => {
        const tokens = await this.loadTokenMap();
        const removed = removeProxyTokensForRun(tokens, runId);
        if (removed > 0) await this.persistTokenMap(tokens);
        return removed;
      });
    }

    async revokeProxyTokensForLease(
      runId: string,
      serviceId: string,
      leaseVersion?: number,
    ): Promise<number> {
      return await this.doState.blockConcurrencyWhile(async () => {
        const tokens = await this.loadTokenMap();
        const removed = removeProxyTokensForLease(
          tokens,
          runId,
          serviceId,
          leaseVersion,
        );
        if (removed > 0) await this.persistTokenMap(tokens);
        return removed;
      });
    }

    async revokeSupersededProxyTokens(
      runId: string,
      serviceId: string,
      leaseVersion?: number,
    ): Promise<number> {
      return await this.doState.blockConcurrencyWhile(async () => {
        const tokens = await this.loadTokenMap();
        const removed = removeSupersededProxyTokens(
          tokens,
          runId,
          serviceId,
          leaseVersion,
        );
        if (removed > 0) await this.persistTokenMap(tokens);
        return removed;
      });
    }

    async revokeProxyTokens(): Promise<void> {
      await this.doState.blockConcurrencyWhile(async () => {
        await this.ctx.storage.delete("proxyTokens");
        this.cachedTokens = new Map();
      });
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
  const targets: Array<{ tier: ExecutorTier; containerId: string }> = [];
  for (let i = 0; i < config.tier1WarmPoolSize; i++) {
    targets.push({ tier: 1, containerId: poolSlotId(env, 1, i) });
  }
  if (env.EXECUTOR_CONTAINER_TIER3) {
    for (let i = 0; i < config.tier3PoolSize; i++) {
      targets.push({ tier: 3, containerId: poolSlotId(env, 3, i) });
    }
  }
  return await Promise.all(
    targets.map(
      async ({ tier, containerId }) =>
        (await readPoolLoad(env, tier, containerId)).load,
    ),
  );
}

type ProxyTokenContainerTarget = {
  tier: ExecutorTier;
  containerId: string;
  stub: ExecutorContainerStub;
};

function collectProxyTokenContainerTargets(
  env: Env,
  runId: string,
  additional?: { tier: ExecutorTier; containerId: string },
): ProxyTokenContainerTarget[] {
  const config = getExecutorPoolConfig(env);
  const targets = new Map<string, ProxyTokenContainerTarget>();
  const add = (tier: ExecutorTier, containerId: string) => {
    const key = `${tier}:${containerId}`;
    if (targets.has(key)) return;
    targets.set(key, {
      tier,
      containerId,
      stub: resolveContainerNamespace(env, tier).getByName(containerId),
    });
  };

  for (let i = 0; i < config.tier1WarmPoolSize; i++) {
    add(1, poolSlotId(env, 1, i));
  }
  if (env.EXECUTOR_CONTAINER_TIER3) {
    for (let i = 0; i < config.tier3PoolSize; i++) {
      add(3, poolSlotId(env, 3, i));
    }
  }

  // Explicit-tier dispatches historically defaulted their container id to the
  // run id. Include those stable names as well as the managed pool. A caller
  // that supplies a custom explicit id is included through `additional`.
  add(1, runId);
  if (env.EXECUTOR_CONTAINER_TIER2) add(2, runId);
  if (env.EXECUTOR_CONTAINER_TIER3) add(3, runId);
  if (additional) add(additional.tier, additional.containerId);
  return [...targets.values()];
}

async function revokeAcrossProxyTokenContainers(
  targets: ProxyTokenContainerTarget[],
  revoke: (stub: ExecutorContainerStub) => Promise<number>,
  operation: string,
  runId: string,
): Promise<number> {
  const settled = await Promise.allSettled(
    targets.map(({ stub }) => revoke(stub)),
  );
  let removed = 0;
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "fulfilled") {
      removed += result.value;
      continue;
    }
    const target = targets[i];
    logError(`Proxy token ${operation} failed`, result.reason, {
      module: "executor-host",
      runId,
      tier: target.tier,
      executorContainerId: target.containerId,
    });
  }
  return removed;
}

/** Revoke all known proxy credentials after cancellation or terminal status. */
export async function revokeRunProxyTokens(
  env: Env,
  runId: string,
  additional?: { tier: ExecutorTier; containerId: string },
): Promise<number> {
  abortRemoteToolExecutorsForRun(runId);
  const targets = collectProxyTokenContainerTargets(env, runId, additional);
  return await revokeAcrossProxyTokenContainers(
    targets,
    async (stub) => (await stub.revokeProxyTokensForRun?.(runId)) ?? 0,
    "run revoke",
    runId,
  );
}

async function revokeRunLeaseProxyTokens(
  env: Env,
  runId: string,
  serviceId: string,
  leaseVersion: number | undefined,
  additional?: { tier: ExecutorTier; containerId: string },
): Promise<number> {
  abortRemoteToolExecutorsForLease({ runId, serviceId, leaseVersion });
  const targets = collectProxyTokenContainerTargets(env, runId, additional);
  return await revokeAcrossProxyTokenContainers(
    targets,
    async (stub) =>
      (await stub.revokeProxyTokensForLease?.(
        runId,
        serviceId,
        leaseVersion,
      )) ?? 0,
    "lease revoke",
    runId,
  );
}

async function revokeSupersededRunProxyTokens(
  env: Env,
  runId: string,
  serviceId: string,
  leaseVersion: number | undefined,
  additional?: { tier: ExecutorTier; containerId: string },
): Promise<number> {
  abortSupersededRemoteToolExecutors({ runId, serviceId, leaseVersion });
  const targets = collectProxyTokenContainerTargets(env, runId, additional);
  return await revokeAcrossProxyTokenContainers(
    targets,
    async (stub) =>
      (await stub.revokeSupersededProxyTokens?.(
        runId,
        serviceId,
        leaseVersion,
      )) ?? 0,
    "superseded lease revoke",
    runId,
  );
}

async function selectExecutorPoolSlot(env: Env): Promise<{
  tier: ExecutorTier;
  containerId: string;
  stub: ExecutorContainerStub;
} | null> {
  const config = getExecutorPoolConfig(env);
  const tier1 = await Promise.all(
    Array.from({ length: config.tier1WarmPoolSize }, (_, index) => {
      const containerId = poolSlotId(env, 1, index);
      return readPoolLoad(env, 1, containerId);
    }),
  );
  const availableTier1 = tier1
    .filter(({ load }) => load.active < load.capacity)
    .sort(
      (left, right) =>
        left.load.active - right.load.active ||
        left.load.containerId.localeCompare(right.load.containerId),
    )[0];
  if (availableTier1) {
    return {
      tier: 1,
      containerId: availableTier1.load.containerId,
      stub: availableTier1.stub,
    };
  }

  // Tier 2 is intentionally skipped: it has no pool sizing and receives no
  // managed traffic (reserved tier — see ExecutorContainerTier2). The pool
  // scales tier 1 → tier 3 only.
  if (!env.EXECUTOR_CONTAINER_TIER3) return null;

  const best = (
    await Promise.all(
      Array.from({ length: config.tier3PoolSize }, (_, index) => {
        const containerId = poolSlotId(env, 3, index);
        return readPoolLoad(env, 3, containerId);
      }),
    )
  )
    .filter(({ load }) => load.active < load.capacity)
    .sort(
      (left, right) =>
        left.load.active - right.load.active ||
        left.load.containerId.localeCompare(right.load.containerId),
    )[0];

  if (!best) return null;
  return {
    tier: 3,
    containerId: best.load.containerId,
    stub: best.stub,
  };
}

async function warmTier1Pool(env: Env): Promise<ExecutorPoolLoad[]> {
  const config = getExecutorPoolConfig(env);
  return await Promise.all(
    Array.from({ length: config.tier1WarmPoolSize }, async (_, index) => {
      const containerId = poolSlotId(env, 1, index);
      const { stub } = await readPoolLoad(env, 1, containerId);
      const load = stub.warm
        ? await stub.warm()
        : (await readPoolLoad(env, 1, containerId)).load;
      return { ...load, tier: 1 as const, containerId };
    }),
  );
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
      const serviceId = resolveAgentExecutorServiceId(body);
      if (!serviceId) {
        return errorJsonResponse("Missing serviceId or workerId", 400);
      }

      const explicitTarget =
        body.tier !== undefined || body.executorTier !== undefined
          ? {
              tier: parseExecutorTier(body.executorTier ?? body.tier),
              containerId: body.executorContainerId || runId,
            }
          : undefined;

      // A delayed dispatch must never mint authority for a lease that has
      // already been replaced or cancelled. Validate before touching tokens,
      // sweep only older monotonic lease versions, then validate again so a
      // lease transition during the cross-DO sweep cannot start stale work.
      const leaseError = await ensureRunLease(env, runId, body);
      if (leaseError) return leaseError;
      await revokeSupersededRunProxyTokens(
        env,
        runId,
        serviceId,
        body.leaseVersion,
        explicitTarget,
      );
      const leaseRecheck = await ensureRunLease(env, runId, body);
      if (leaseRecheck) return leaseRecheck;

      if (explicitTarget) {
        const { tier, containerId } = explicitTarget;
        const ns = resolveContainerNamespace(env, tier);
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

      let body: Record<string, unknown>;
      try {
        body =
          request.method === "POST"
            ? await readBoundedAgentControlJson(
                request,
                AGENT_CONTROL_BODY_LIMITS[path] ??
                  DEFAULT_AGENT_CONTROL_BODY_BYTES,
              )
            : Object.fromEntries(url.searchParams.entries());
      } catch (error) {
        if (error instanceof AgentControlBodyError) {
          return err(error.message, error.status);
        }
        return err("Invalid control RPC JSON", 400);
      }

      // Fail closed: bind the request target to the verified proxy token rather
      // than trusting caller-supplied ids. The container holds only this token,
      // so the run/service it was issued for is authoritative. Overwriting (not
      // merely comparing) closes the historical hole where a body that simply
      // omitted runId/serviceId bypassed the per-run scoping — e.g. add-message
      // sends only threadId, so without this it could be steered at any thread.
      body.runId = tokenInfo.runId;
      body.serviceId = tokenInfo.serviceId;
      if (typeof tokenInfo.leaseVersion === "number") {
        body.leaseVersion = tokenInfo.leaseVersion;
      } else {
        // Never preserve a caller-supplied lease version when an older stored
        // token has no version metadata. serviceId still fences that legacy
        // token, while an attacker cannot claim a newer version in the body.
        delete body.leaseVersion;
      }
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

      // Membership is mutable authority. Revalidate it for every control RPC
      // so a queued or already-running container loses history, provider-key,
      // and tool access as soon as its requester is removed from the Workspace.
      try {
        await assertRunExecutionAccess(env, tokenInfo.runId);
      } catch {
        abortRemoteToolExecutorsForRun(tokenInfo.runId);
        return err("Run requester no longer has Workspace access", 403);
      }

      // Existing v1 tokens may finish during the Container rollout grace
      // window. Every newly minted v2 token is fenced to the atomic completion
      // protocol, so split transcript/status mutations are not a convention a
      // current container can bypass. Remove the v1 routes after the rollout
      // window no longer needs compatibility.
      if (rejectsLegacySplitFinalization(tokenInfo, path)) {
        return err("Legacy split finalization is not available", 410);
      }

      recordProxyUsage(path);

      if (isControlRpcPath(path)) {
        // Dispatch in-process: the Takos Worker and executor-host share this
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
        const target = {
          tier,
          containerId: executorContainerId || runId,
        };
        if (await responseSignalsLeaseLost(forwarded)) {
          await revokeProxyTokenBestEffort(stub, token, "lease-lost RPC");
          await revokeRunLeaseProxyTokens(
            env,
            tokenInfo.runId,
            tokenInfo.serviceId,
            tokenInfo.leaseVersion,
            target,
          );
        } else if (
          forwarded.ok &&
          shouldRevokeProxyTokensAfterControlForward(path, body)
        ) {
          await revokeProxyTokenBestEffort(stub, token, "terminal RPC");
          if (path === "/api/internal/v1/agent-control/run-reset") {
            // reset makes the row queued and a fresh lease may be claimed
            // immediately. Revoke only this old identity so a delayed cleanup
            // cannot delete an already-minted replacement token.
            await revokeRunLeaseProxyTokens(
              env,
              tokenInfo.runId,
              tokenInfo.serviceId,
              tokenInfo.leaseVersion,
              target,
            );
          } else {
            await revokeRunProxyTokens(env, tokenInfo.runId, target);
          }
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

const LEGACY_SPLIT_FINALIZATION_PATHS = new Set([
  "/api/internal/v1/agent-control/add-message",
  "/api/internal/v1/agent-control/update-run-status",
  "/api/internal/v1/agent-control/run-fail",
  "/api/internal/v1/agent-control/run-reset",
]);

export function rejectsLegacySplitFinalization(
  tokenInfo: Pick<ProxyTokenInfo, "runtimeProtocolVersion">,
  path: string,
): boolean {
  return (
    (tokenInfo.runtimeProtocolVersion ?? 1) >= 2 &&
    LEGACY_SPLIT_FINALIZATION_PATHS.has(path)
  );
}

function shouldRevokeProxyTokensAfterControlForward(
  path: string,
  body: Record<string, unknown>,
): boolean {
  if (
    path === "/api/internal/v1/agent-control/run-fail" ||
    path === "/api/internal/v1/agent-control/run-reset"
  ) {
    return true;
  }
  if (path === "/api/internal/v1/agent-control/update-run-status") {
    return isTerminalRunStatus(body.status);
  }
  if (path === "/api/internal/v1/agent-control/complete-run") {
    return isTerminalRunStatus(body.status);
  }
  return false;
}

async function responseSignalsLeaseLost(response: Response): Promise<boolean> {
  if (response.status !== 409) return false;
  try {
    const payload = (await response.clone().json()) as Record<string, unknown>;
    const error =
      typeof payload.error === "string"
        ? payload.error.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_")
        : "";
    return (
      error.startsWith("lease_lost") ||
      error === "run_service_mismatch" ||
      error === "run_is_not_active"
    );
  } catch {
    return false;
  }
}

async function revokeProxyTokenBestEffort(
  stub: ExecutorContainerStub,
  token: string,
  reason: string,
): Promise<void> {
  try {
    if (stub.revokeProxyToken) {
      await stub.revokeProxyToken(token);
    }
  } catch (error) {
    logError("Proxy token revoke failed", error, {
      module: "executor-host",
      reason,
    });
  }
}
