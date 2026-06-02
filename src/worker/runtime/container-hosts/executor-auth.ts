/**
 * Proxy authentication, capability mapping, and resource access validation
 * for the executor-host subsystem.
 */

import {
  agentControlRpcPath,
  expandProxyCapability,
  isAgentControlRpcPath,
  type ProxyCapability,
  type ProxyScope,
} from "./executor-utils.ts";

// ---------------------------------------------------------------------------
// Proxy capability resolution
// ---------------------------------------------------------------------------

/**
 * Per-endpoint least-privilege scope map. Every control-RPC endpoint maps to
 * exactly one scope. Agent runs hold every scope here; workflow runs hold only
 * the run-lifecycle / tools / provider-keys subset (see proxyScopesForRunKind),
 * so a workflow token cannot reach conversation / memory / skill endpoints.
 */
const CONTROL_RPC_ENDPOINT_SCOPES: Record<string, ProxyScope> = {
  // run lifecycle / status
  "heartbeat": "run-lifecycle",
  "run-status": "run-lifecycle",
  "run-record": "run-lifecycle",
  "run-bootstrap": "run-lifecycle",
  "run-fail": "run-lifecycle",
  "run-reset": "run-lifecycle",
  "run-usage": "run-lifecycle",
  "run-context": "run-lifecycle",
  "run-config": "run-lifecycle",
  "no-llm-complete": "run-lifecycle",
  "update-run-status": "run-lifecycle",
  "is-cancelled": "run-lifecycle",
  "run-event": "run-lifecycle",
  // conversation / session / messages
  "current-session": "conversation",
  "conversation-history": "conversation",
  "add-message": "conversation",
  // memory
  "memory-activation": "memory",
  "memory-finalize": "memory",
  // skills
  "skill-runtime-context": "skills",
  "skill-catalog": "skills",
  "skill-plan": "skills",
  // tools
  "tool-catalog": "tools",
  "tool-execute": "tools",
  "tool-cleanup": "tools",
  // provider keys
  "api-keys": "provider-keys",
};

const CONTROL_RPC_ENDPOINTS = new Set(
  Object.keys(CONTROL_RPC_ENDPOINT_SCOPES),
);

/**
 * Resolve the scope a control-RPC path requires. Returns null for any path that
 * is not a recognized control-RPC endpoint (callers MUST treat null as
 * unauthorized — fail closed).
 */
export function getRequiredProxyCapability(
  path: string,
): ProxyScope | null {
  if (!isAgentControlRpcPath(path)) return null;
  const endpoint = path.slice(agentControlRpcPath("").length);
  return CONTROL_RPC_ENDPOINT_SCOPES[endpoint] ?? null;
}

/**
 * Membership check used by the executor host: a request to `path` is authorized
 * iff the path maps to a known scope AND the token's scope set (expanded from
 * its stored capability, including the legacy `"control"` full-agent alias)
 * contains that scope. Fail-closed for unknown paths / empty scope sets.
 */
export function isProxyRequestAuthorized(
  path: string,
  capability: ProxyCapability | ProxyCapability[] | undefined,
): boolean {
  const required = getRequiredProxyCapability(path);
  if (!required) return false;
  return expandProxyCapability(capability).has(required);
}

export { CONTROL_RPC_ENDPOINTS };

// ---------------------------------------------------------------------------
// Claims / body matching
// ---------------------------------------------------------------------------

/**
 * Verify that a control-RPC request body is bound to the same run / service the
 * verified proxy token was issued for.
 *
 * This MUST fail closed: the proxy token is the only credential the executor
 * container holds, and the claims here are derived from that verified token
 * (executor-host.ts builds `run_id` / `service_id` from `verifyProxyToken`).
 * The body is otherwise attacker-controlled — downstream control handlers act
 * on `body.runId` / `body.serviceId` (and id-derived `threadId` / `spaceId`),
 * so a token scoped to run A must not be allowed to drive an RPC whose body
 * targets a different (or unspecified) run.
 *
 * Therefore: when the token claim binds a run/service id, the body MUST assert
 * the same id. Omitting the id (the historical fail-open hole) is rejected.
 */
export function claimsMatchRequestBody(
  claims: Record<string, unknown>,
  body: Record<string, unknown>,
): boolean {
  const claimRunId = typeof claims.run_id === "string" ? claims.run_id : null;
  const claimServiceId = typeof claims.service_id === "string"
    ? claims.service_id
    : typeof claims.worker_id === "string"
    ? claims.worker_id
    : null;
  const bodyRunId = typeof body.runId === "string" ? body.runId : null;
  const bodyServiceId = typeof body.serviceId === "string"
    ? body.serviceId
    : typeof body.workerId === "string"
    ? body.workerId
    : null;

  // Fail closed: a bound claim requires the body to carry the matching id.
  // (Skipping the comparison when the body omits the id let a token scoped to
  // one run drive control RPCs against an attacker-chosen target.)
  if (claimRunId) {
    if (bodyRunId === null || bodyRunId !== claimRunId) return false;
  }
  if (claimServiceId) {
    if (bodyServiceId === null || bodyServiceId !== claimServiceId) {
      return false;
    }
  }
  return true;
}
