/**
 * Shared utility functions, response helpers, and types for the executor-host
 * subsystem. The main fetch entrypoint and executor control RPC handlers depend
 * on these.
 */

import type {
  DurableObjectNamespace,
  Queue,
} from "../../shared/types/bindings.ts";
import {
  errorJsonResponse,
  jsonResponse,
} from "../../shared/utils/http-response.ts";
import { base64ToBytes } from "../../shared/utils/encoding-utils.ts";
import type {
  AiEnv,
  DbEnv,
  IndexJobQueueMessage,
  StorageEnv,
} from "../../shared/types/index.ts";

// ---------------------------------------------------------------------------
// Environment types
// ---------------------------------------------------------------------------

export type ExecutorTier = 1 | 2 | 3;

export interface ExecutorPoolConfig {
  tier1WarmPoolSize: number;
  tier1MaxConcurrentRuns: number;
  tier3PoolSize: number;
  tier3MaxConcurrentRuns: number;
}

export interface ExecutorPoolLoad {
  tier: ExecutorTier;
  containerId: string;
  active: number;
  capacity: number;
}

export interface AgentExecutorEnv extends DbEnv, StorageEnv, AiEnv {
  EXECUTOR_CONTAINER: ContainerNamespace;
  EXECUTOR_CONTAINER_TIER2?: ContainerNamespace;
  EXECUTOR_CONTAINER_TIER3?: ContainerNamespace;
  /** Service binding to main takos worker for control RPC forwarding. */
  TAKOS_CONTROL: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  /** Shared secret for authenticating forwarded requests to the main worker. */
  EXECUTOR_PROXY_SECRET: string;
  INDEX_QUEUE?: Queue<IndexJobQueueMessage>;
  CONTROL_RPC_BASE_URL?: string;
  EXECUTOR_TIER1_WARM_POOL_SIZE?: string;
  EXECUTOR_TIER1_MAX_CONCURRENT_RUNS?: string;
  EXECUTOR_TIER3_POOL_SIZE?: string;
  EXECUTOR_TIER3_MAX_CONCURRENT_RUNS?: string;
  EXECUTOR_POOL_REVISION?: string;
}

// Local alias for internal usage across sub-modules
export type Env = AgentExecutorEnv;

// ---------------------------------------------------------------------------
// Container stub / namespace interfaces
// ---------------------------------------------------------------------------

import type {
  AgentExecutorDispatchPayload,
  AgentExecutorDispatchResult,
} from "./executor-dispatch.ts";

/** Token metadata stored alongside each random proxy token. */
export interface ProxyTokenInfo {
  runId: string;
  serviceId: string;
  capability: ProxyCapability;
  executorTier?: ExecutorTier;
  executorContainerId?: string;
  startedAt?: number;
  lastHeartbeatAt?: number;
}

export interface ExecutorContainerStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  dispatchStart(
    body: AgentExecutorDispatchPayload,
  ): Promise<AgentExecutorDispatchResult>;
  warm?(): Promise<ExecutorPoolLoad>;
  getLoad?(): Promise<ExecutorPoolLoad>;
  verifyProxyToken(token: string): Promise<ProxyTokenInfo | null>;
  touchProxyToken?(token: string): Promise<void>;
  revokeProxyToken?(token: string): Promise<void>;
  revokeProxyTokens?(): Promise<void>;
}

export interface ContainerNamespace
  extends DurableObjectNamespace<ExecutorContainerStub> {
  get(id: unknown): ExecutorContainerStub;
  getByName(name: string): ExecutorContainerStub;
}

/**
 * Resolve the ContainerNamespace for a given executor tier.
 * Falls back to EXECUTOR_CONTAINER (tier 1) when the tier-specific binding is not configured.
 */
export function resolveContainerNamespace(
  env: AgentExecutorEnv,
  tier: ExecutorTier,
): ContainerNamespace {
  if (tier === 3 && env.EXECUTOR_CONTAINER_TIER3) {
    return env.EXECUTOR_CONTAINER_TIER3;
  }
  if (tier === 2 && env.EXECUTOR_CONTAINER_TIER2) {
    return env.EXECUTOR_CONTAINER_TIER2;
  }
  return env.EXECUTOR_CONTAINER;
}

/**
 * Parse executor tier from dispatch payload or proxy header.
 * Defaults to tier 1 if not specified.
 */
export function parseExecutorTier(value: unknown): ExecutorTier {
  const n = typeof value === "number"
    ? value
    : typeof value === "string"
    ? parseInt(value, 10)
    : NaN;
  if (n === 2 || n === 3) return n;
  return 1;
}

function parsePositiveInteger(
  value: unknown,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
    ? Number(value)
    : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  const integer = Math.floor(parsed);
  const min = options.min ?? 1;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(Math.max(integer, min), max);
}

export function getExecutorPoolConfig(
  env: Pick<
    AgentExecutorEnv,
    | "EXECUTOR_TIER1_WARM_POOL_SIZE"
    | "EXECUTOR_TIER1_MAX_CONCURRENT_RUNS"
    | "EXECUTOR_TIER3_POOL_SIZE"
    | "EXECUTOR_TIER3_MAX_CONCURRENT_RUNS"
  >,
): ExecutorPoolConfig {
  return {
    tier1WarmPoolSize: parsePositiveInteger(
      env.EXECUTOR_TIER1_WARM_POOL_SIZE,
      1,
      { min: 1, max: 100 },
    ),
    tier1MaxConcurrentRuns: parsePositiveInteger(
      env.EXECUTOR_TIER1_MAX_CONCURRENT_RUNS,
      4,
      { min: 1, max: 100 },
    ),
    tier3PoolSize: parsePositiveInteger(
      env.EXECUTOR_TIER3_POOL_SIZE,
      25,
      { min: 1, max: 500 },
    ),
    tier3MaxConcurrentRuns: parsePositiveInteger(
      env.EXECUTOR_TIER3_MAX_CONCURRENT_RUNS,
      32,
      { min: 1, max: 500 },
    ),
  };
}

export function resolveExecutorTierCapacity(
  env: AgentExecutorEnv,
  tier: ExecutorTier,
): number {
  const config = getExecutorPoolConfig(env);
  if (tier === 3) return config.tier3MaxConcurrentRuns;
  if (tier === 1) return config.tier1MaxConcurrentRuns;
  return 1;
}

/**
 * Wrapper type for the Cloudflare AI binding that accepts dynamic model names.
 * The Cloudflare `Ai` type requires a specific `AiModels` key, but proxy callers
 * send arbitrary model name strings resolved at runtime.
 */
export interface AiRunBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export type ProxyCapability = "control";

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export function unauthorized(): Response {
  return errorJsonResponse("Unauthorized", 401);
}

export function ok(data: unknown): Response {
  return jsonResponse(data);
}

export function err(message: string, status = 500): Response {
  return errorJsonResponse(message, status);
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export function classifyProxyError(
  e: unknown,
): { status: number; message: string } {
  const name = e instanceof Error ? e.name : "";
  const msg = e instanceof Error ? e.message : String(e);

  // Timeout / AbortError
  if (
    name === "AbortError" || name === "TimeoutError" ||
    msg.includes("timed out") || msg.includes("timeout")
  ) {
    return { status: 504, message: "Proxy request timed out" };
  }

  // SQLite errors
  if (msg.includes("SQLITE_BUSY") || msg.includes("database is locked")) {
    return { status: 503, message: "Database busy, retry later" };
  }
  if (msg.includes("SQLITE_CONSTRAINT")) {
    return { status: 409, message: "Database constraint violation" };
  }
  if (msg.includes("SQLITE_ERROR") || msg.includes("D1_ERROR")) {
    return { status: 400, message: "Database query error" };
  }

  // Network errors
  if (
    name === "NetworkError" ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("fetch failed") ||
    msg.includes("network")
  ) {
    return { status: 502, message: "Upstream connection failed" };
  }

  // Client-side type/range errors
  if (e instanceof TypeError || e instanceof RangeError) {
    return { status: 400, message: "Invalid request" };
  }

  return { status: 500, message: "Internal proxy error" };
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export { base64ToBytes };

export function readRunServiceId(body: Record<string, unknown>): string | null {
  if (typeof body.serviceId === "string" && body.serviceId.length > 0) {
    return body.serviceId;
  }
  if (typeof body.workerId === "string" && body.workerId.length > 0) {
    return body.workerId;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Proxy usage tracking
// ---------------------------------------------------------------------------

const proxyUsageCounters = new Map<string, number>();

export function recordProxyUsage(path: string): void {
  const bucket = path === "/rpc/control/tool-catalog"
    ? "tool-catalog"
    : path === "/rpc/control/tool-execute"
    ? "tool-execute"
    : path === "/rpc/control/tool-cleanup"
    ? "tool-cleanup"
    : path === "/rpc/control/run-event"
    ? "run-event"
    : path.startsWith("/rpc/control/")
    ? "other-control-rpc"
    : path.startsWith("/proxy/")
    ? "legacy-control-rpc"
    : "other";
  proxyUsageCounters.set(bucket, (proxyUsageCounters.get(bucket) ?? 0) + 1);
}

export function getProxyUsageSnapshot(): Record<string, number> {
  return Object.fromEntries(
    [...proxyUsageCounters.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

// ---------------------------------------------------------------------------
// Control RPC forwarding (to main takos worker via service binding)
// ---------------------------------------------------------------------------

/**
 * Map from executor-host paths to the proxy API endpoint names.
 * Covers both /rpc/control/* and legacy /proxy/* control paths.
 */
const CONTROL_RPC_PATH_MAP: Record<string, string> = {
  "/rpc/control/heartbeat": "/internal/executor-rpc/heartbeat",
  "/proxy/heartbeat": "/internal/executor-rpc/heartbeat",
  "/rpc/control/run-status": "/internal/executor-rpc/run-status",
  "/proxy/run/status": "/internal/executor-rpc/run-status",
  "/rpc/control/run-record": "/internal/executor-rpc/run-record",
  "/rpc/control/run-bootstrap": "/internal/executor-rpc/run-bootstrap",
  "/rpc/control/run-fail": "/internal/executor-rpc/run-fail",
  "/proxy/run/fail": "/internal/executor-rpc/run-fail",
  "/rpc/control/run-reset": "/internal/executor-rpc/run-reset",
  "/proxy/run/reset": "/internal/executor-rpc/run-reset",
  "/rpc/control/run-context": "/internal/executor-rpc/run-context",
  "/rpc/control/run-config": "/internal/executor-rpc/run-config",
  "/rpc/control/no-llm-complete": "/internal/executor-rpc/no-llm-complete",
  "/rpc/control/current-session": "/internal/executor-rpc/current-session",
  "/rpc/control/is-cancelled": "/internal/executor-rpc/is-cancelled",
  "/rpc/control/conversation-history":
    "/internal/executor-rpc/conversation-history",
  "/rpc/control/skill-runtime-context":
    "/internal/executor-rpc/skill-runtime-context",
  "/rpc/control/skill-catalog": "/internal/executor-rpc/skill-catalog",
  "/rpc/control/skill-plan": "/internal/executor-rpc/skill-plan",
  "/rpc/control/memory-activation": "/internal/executor-rpc/memory-activation",
  "/rpc/control/memory-finalize": "/internal/executor-rpc/memory-finalize",
  "/rpc/control/add-message": "/internal/executor-rpc/add-message",
  "/rpc/control/update-run-status": "/internal/executor-rpc/update-run-status",
  "/rpc/control/tool-catalog": "/internal/executor-rpc/tool-catalog",
  "/rpc/control/tool-execute": "/internal/executor-rpc/tool-execute",
  "/rpc/control/tool-cleanup": "/internal/executor-rpc/tool-cleanup",
  "/rpc/control/run-event": "/internal/executor-rpc/run-event",
  "/rpc/control/billing-run-usage": "/internal/executor-rpc/billing-run-usage",
  "/proxy/billing/run-usage": "/internal/executor-rpc/billing-run-usage",
  "/rpc/control/api-keys": "/internal/executor-rpc/api-keys",
  "/proxy/api-keys": "/internal/executor-rpc/api-keys",
};

/**
 * Check if a path should be forwarded to the control plane.
 */
export function isControlRpcPath(path: string): boolean {
  return path in CONTROL_RPC_PATH_MAP;
}

/**
 * Forward a control RPC request to the main takos worker.
 * Returns null only when the path is not a mapped control RPC path.
 */
export async function forwardToControlPlane(
  path: string,
  body: Record<string, unknown>,
  env: Env,
): Promise<Response | null> {
  const controlBinding = env.TAKOS_CONTROL;
  if (!controlBinding) {
    return err("TAKOS_CONTROL service binding not configured", 503);
  }

  const targetPath = CONTROL_RPC_PATH_MAP[path];
  if (!targetPath) return null;

  try {
    return await controlBinding.fetch(
      new Request(`https://internal${targetPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Takos-Internal": env.EXECUTOR_PROXY_SECRET,
        },
        body: JSON.stringify(body),
      }),
    );
  } catch (e) {
    return err(
      `Control plane forwarding failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
      502,
    );
  }
}
