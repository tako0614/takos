/**
 * Shared utility functions, response helpers, and types for the executor-host
 * subsystem. The main fetch entrypoint and executor control RPC handlers depend
 * on these.
 */

import type {
  DurableObjectNamespace,
  MessageQueueBinding,
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
import {
  signTakosumiInternalRequest as signTakosInternalRequest,
  type TakosumiActorContext as TakosActorContext,
} from "takosumi-contract/internal/rpc";

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
  TAKOS_WORKER: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  /** Preferred service binding to takosumi for canonical agent-control RPC. */
  TAKOSUMI?: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  };
  TAKOSUMI_INTERNAL_URL?: string;
  TAKOS_INTERNAL_SERVICE_SECRET?: string;
  /** Shared secret for authenticating forwarded requests to the main worker. */
  EXECUTOR_PROXY_SECRET: string;
  INDEX_QUEUE?: MessageQueueBinding<IndexJobQueueMessage>;
  TAKOS_AGENT_CONTROL_RPC_BASE_URL?: string;
  TAKOS_AGENT_START_TOKEN?: string;
  EXECUTOR_TIER1_WARM_POOL_SIZE?: string;
  EXECUTOR_TIER1_MAX_CONCURRENT_RUNS?: string;
  EXECUTOR_TIER3_POOL_SIZE?: string;
  EXECUTOR_TIER3_MAX_CONCURRENT_RUNS?: string;
  EXECUTOR_POOL_REVISION?: string;
  /**
   * Opt-in escape hatch to inject durable provider keys directly into pooled
   * executor containers. Defaults to OFF; see buildAgentExecutorContainerEnvVars.
   */
  EXECUTOR_INJECT_PROVIDER_KEYS_DIRECT?: string;
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
  /**
   * The scope set this token grants. Minted as an array of least-privilege
   * scopes (see proxyScopesForRunKind). A single value / legacy `"control"`
   * remains accepted for already-stored tokens; expandProxyCapability resolves
   * either form to the concrete scope set during the endpoint check.
   */
  capability: ProxyCapability | ProxyCapability[];
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

/**
 * Least-privilege proxy-token scopes. Each control-RPC endpoint maps to exactly
 * one of these per-purpose scopes (see executor-auth.ts). A minted proxy token
 * carries a *set* of scopes (`ProxyTokenInfo.capability` may be an array); an
 * endpoint is reachable only if its required scope is in the token's set.
 *
 * `"control"` is a back-compat alias: legacy in-flight tokens were minted with
 * the single value `"control"`, which is treated as "the full agent scope set"
 * so already-dispatched runs keep working across a deploy.
 */
export type ProxyScope =
  | "run-lifecycle"
  | "conversation"
  | "memory"
  | "tools"
  | "skills"
  | "provider-keys";

export type ProxyCapability = ProxyScope | "control";

/** Full scope set granted to agent runs (and to the legacy "control" alias). */
export const AGENT_PROXY_SCOPES: readonly ProxyScope[] = [
  "run-lifecycle",
  "conversation",
  "memory",
  "tools",
  "skills",
  "provider-keys",
];

/**
 * Reduced scope set granted to workflow / actions runs. Workflow runs drive
 * run lifecycle, execute tools, and fetch provider keys, but do NOT touch the
 * conversation / memory / skill control-RPC surface that only agent runs need.
 */
export const WORKFLOW_PROXY_SCOPES: readonly ProxyScope[] = [
  "run-lifecycle",
  "tools",
  "provider-keys",
];

/**
 * Resolve the scope set a run kind is granted. Defaults to the full agent set
 * for any unknown / unset kind (fail-open ONLY toward the broader agent set,
 * never toward a smaller-than-intended set, so agents never regress).
 */
export function proxyScopesForRunKind(
  runKind: "agent" | "workflow" | undefined,
): ProxyScope[] {
  return runKind === "workflow"
    ? [...WORKFLOW_PROXY_SCOPES]
    : [...AGENT_PROXY_SCOPES];
}

/**
 * Expand a stored token capability into the concrete scope set it grants.
 * Accepts the new array form, a single scope, or the legacy `"control"` alias
 * (which expands to the full agent scope set). Unknown values yield an empty
 * set (fail-closed: an endpoint check against it will reject).
 */
export function expandProxyCapability(
  capability: ProxyCapability | ProxyCapability[] | undefined,
): Set<ProxyScope> {
  const out = new Set<ProxyScope>();
  const add = (value: ProxyCapability) => {
    if (value === "control") {
      for (const scope of AGENT_PROXY_SCOPES) out.add(scope);
      return;
    }
    out.add(value);
  };
  if (Array.isArray(capability)) {
    for (const value of capability) add(value);
  } else if (capability) {
    add(capability);
  }
  return out;
}

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
// Ingress body parsing
// ---------------------------------------------------------------------------

/**
 * Reads a JSON request body and confirms it is a plain object record before
 * surfacing it to executor RPC handlers. Replaces the implicit
 * `c.req.json<Record<string, unknown>>()` cast with an explicit structural
 * check so handlers can rely on the `Record<string, unknown>` shape without
 * having to defend against arrays / primitives / null escaping the parse step.
 *
 * Returns either the validated record (`ok: true`) or a 400 `err` response
 * (`ok: false`) preserving the behavior of pre-parser sites that previously
 * surfaced the same status via `classifyProxyError` on field-access TypeErrors.
 */
export async function parseExecutorRpcBody(
  req: { json(): Promise<unknown> },
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response }
> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: err("Invalid JSON body", 400) };
  }
  if (
    typeof raw !== "object" || raw === null || Array.isArray(raw)
  ) {
    return {
      ok: false,
      response: err("Request body must be a JSON object", 400),
    };
  }
  return { ok: true, value: raw as Record<string, unknown> };
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

// Per-isolate, in-memory counters. NOT a service-wide aggregate: each Workers
// isolate has its own Map and the counts reset on cold start. The
// /internal/proxy-usage endpoint surfaces these as `scope: "isolate"` so callers
// do not mistake one isolate's partial counts for the whole service total.
// Aggregate via a metrics sink (analytics engine) if a true service-wide total
// is needed.
const proxyUsageCounters = new Map<string, number>();
export const AGENT_CONTROL_RPC_PATH_PREFIX = "/api/internal/v1/agent-control";

export function agentControlRpcPath(endpoint: string): string {
  return `${AGENT_CONTROL_RPC_PATH_PREFIX}/${endpoint.replace(/^\/+/, "")}`;
}

export function isAgentControlRpcPath(path: string): boolean {
  return path.startsWith(`${AGENT_CONTROL_RPC_PATH_PREFIX}/`);
}

function isControlRpcEndpoint(path: string, endpoint: string): boolean {
  return path === agentControlRpcPath(endpoint);
}

export function recordProxyUsage(path: string): void {
  const bucket = isControlRpcEndpoint(path, "tool-catalog")
    ? "tool-catalog"
    : isControlRpcEndpoint(path, "tool-execute")
    ? "tool-execute"
    : isControlRpcEndpoint(path, "tool-cleanup")
    ? "tool-cleanup"
    : isControlRpcEndpoint(path, "run-event")
    ? "run-event"
    : isAgentControlRpcPath(path)
    ? "other-control-rpc"
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
 */
const CONTROL_RPC_ENDPOINT_MAP: Record<string, string> = {
  "heartbeat": "/internal/executor-rpc/heartbeat",
  "run-status": "/internal/executor-rpc/run-status",
  "run-record": "/internal/executor-rpc/run-record",
  "run-bootstrap": "/internal/executor-rpc/run-bootstrap",
  "run-fail": "/internal/executor-rpc/run-fail",
  "run-reset": "/internal/executor-rpc/run-reset",
  "run-context": "/internal/executor-rpc/run-context",
  "run-config": "/internal/executor-rpc/run-config",
  "no-llm-complete": "/internal/executor-rpc/no-llm-complete",
  "current-session": "/internal/executor-rpc/current-session",
  "is-cancelled": "/internal/executor-rpc/is-cancelled",
  "conversation-history": "/internal/executor-rpc/conversation-history",
  "skill-runtime-context": "/internal/executor-rpc/skill-runtime-context",
  "skill-catalog": "/internal/executor-rpc/skill-catalog",
  "skill-plan": "/internal/executor-rpc/skill-plan",
  "memory-activation": "/internal/executor-rpc/memory-activation",
  "memory-finalize": "/internal/executor-rpc/memory-finalize",
  "add-message": "/internal/executor-rpc/add-message",
  "update-run-status": "/internal/executor-rpc/update-run-status",
  "tool-catalog": "/internal/executor-rpc/tool-catalog",
  "tool-execute": "/internal/executor-rpc/tool-execute",
  "tool-cleanup": "/internal/executor-rpc/tool-cleanup",
  "run-event": "/internal/executor-rpc/run-event",
  "run-usage": "/internal/executor-rpc/run-usage",
  "api-keys": "/internal/executor-rpc/api-keys",
};

const CONTROL_RPC_PATH_MAP: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(CONTROL_RPC_ENDPOINT_MAP).map(([endpoint, target]) => [
      agentControlRpcPath(endpoint),
      target,
    ]),
  ),
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
  const targetPath = CONTROL_RPC_PATH_MAP[path];
  if (!targetPath) return null;

  try {
    const takosumiResponse = await forwardToTakosumiAgentControl(
      targetPath,
      body,
      env,
    );
    if (takosumiResponse) return takosumiResponse;
  } catch (e) {
    return err(
      `Takosumi agent-control forwarding failed: ${
        e instanceof Error ? e.message : String(e)
      }`,
      502,
    );
  }

  const controlBinding = env.TAKOS_WORKER;
  if (!controlBinding) {
    return err("TAKOS_WORKER service binding not configured", 503);
  }

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

async function forwardToTakosumiAgentControl(
  appExecutorRpcPath: string,
  body: Record<string, unknown>,
  env: Env,
): Promise<Response | null> {
  const secret = env.TAKOS_INTERNAL_SERVICE_SECRET;
  const takosumiBinding = env.TAKOSUMI;
  const takosumiBaseUrl =
    (env.TAKOSUMI_INTERNAL_URL ?? "https://takosumi.internal")
      .replace(/\/+$/, "");
  if (!secret || !takosumiBinding) return null;

  const endpoint = appExecutorRpcPath.replace(
    /^\/internal\/executor-rpc\//,
    "",
  );
  const targetPath = agentControlRpcPath(endpoint);
  const bodyText = JSON.stringify(body);
  const signed = await signTakosInternalRequest({
    method: "POST",
    path: targetPath,
    body: bodyText,
    actor: createAgentControlActor(body),
    caller: "takos-worker",
    audience: "takosumi",
    capabilities: ["agent-control.invoke"],
    timestamp: new Date().toISOString(),
    secret,
  });
  return await takosumiBinding.fetch(
    new Request(`${takosumiBaseUrl}${targetPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...signed.headers,
      },
      body: bodyText,
    }),
  );
}

function createAgentControlActor(
  body: Record<string, unknown>,
): TakosActorContext {
  const runId = typeof body.runId === "string" ? body.runId : "unknown";
  const spaceId = typeof body.spaceId === "string" ? body.spaceId : undefined;
  return {
    actorAccountId: "takos-worker",
    roles: ["service"],
    requestId: `agent-control-${runId}-${crypto.randomUUID()}`,
    principalKind: "service",
    serviceId: "takos-worker",
    ...(spaceId ? { spaceId } : {}),
  };
}
