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
  getProxyUsageSnapshot,
  isControlRpcPath,
  parseExecutorTier,
  recordProxyUsage,
  resolveContainerNamespace,
  unauthorized,
} from "./executor-utils.ts";
import type {
  AgentExecutorEnv,
  Env,
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
  tier: import("./executor-utils.ts").ExecutorTier,
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
      };
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
      const controlConfig: AgentExecutorControlConfig =
        buildAgentExecutorProxyConfig(this.env, {
          runId: body.runId,
          serviceId,
        });
      const tokenMap: Record<string, ProxyTokenInfo> = {
        [controlConfig.controlRpcToken]: {
          runId: body.runId,
          serviceId,
          capability: "control",
        },
      };
      await this.ctx.storage.put("proxyTokens", tokenMap);
      this.cachedTokens = new Map(Object.entries(tokenMap));

      return await dispatchAgentExecutorStart(
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
        body,
        controlConfig,
      );
    }

    async verifyProxyToken(token: string): Promise<ProxyTokenInfo | null> {
      if (!this.cachedTokens) {
        const stored = await this.ctx.storage.get<
          Record<string, ProxyTokenInfo>
        >("proxyTokens");
        if (!stored) return null;
        this.cachedTokens = new Map(Object.entries(stored));
      }
      for (const [storedToken, info] of this.cachedTokens) {
        if (constantTimeEqual(token, storedToken)) return info;
      }
      return null;
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

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

// Cached environment validation guard.
const envGuard = createEnvGuard(validateExecutorHostEnv);

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

      const tier = parseExecutorTier(body.tier);
      const ns = resolveContainerNamespace(env, tier);
      const stub = ns.getByName(runId);

      // Container dispatch is the canonical OSS execution path.
      return await forwardAgentExecutorDispatch(stub, body);
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
      if (!runId || !token) {
        return unauthorized();
      }

      // Verify token via DO RPC (DO stores the random tokens generated at dispatch)
      const ns = resolveContainerNamespace(env, tier);
      const stub = ns.getByName(runId);
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
        if (
          shouldRevokeProxyTokensAfterControlForward(path, body)
        ) {
          await revokeProxyTokensAfterTerminalResponse(forwarded, stub);
        }
        return forwarded;
      }

      return err(`Unknown proxy path: ${path}`, 404);
    }

    return new Response("takos-executor-host", { status: 200 });
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
  if (path === "/rpc/control/update-run-status") {
    return isTerminalRunStatus(body.status);
  }
  if (path === "/rpc/control/run-event") {
    return isTerminalRunEvent(body.type, body.data);
  }
  return false;
}

async function revokeProxyTokensAfterTerminalResponse(
  response: Response,
  stub: { revokeProxyTokens?(): Promise<void> },
): Promise<void> {
  if (!response.ok || !stub.revokeProxyTokens) {
    return;
  }
  try {
    await stub.revokeProxyTokens();
  } catch (error) {
    logError("Proxy token revoke failed after terminal run update", error, {
      module: "executor-host",
    });
  }
}
