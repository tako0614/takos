/**
 * Proxy authentication, capability mapping, and resource access validation
 * for the executor-host subsystem.
 */

import {
  agentControlRpcPath,
  isAgentControlRpcPath,
  type ProxyCapability,
} from "./executor-utils.ts";

// ---------------------------------------------------------------------------
// Proxy capability resolution
// ---------------------------------------------------------------------------

export function getRequiredProxyCapability(
  path: string,
): ProxyCapability | null {
  if (
    isAgentControlRpcPath(path) &&
    CONTROL_RPC_ENDPOINTS.has(path.slice(agentControlRpcPath("").length))
  ) {
    return "control";
  }

  // Unknown proxy/control paths must be rejected; null signals unauthorized.
  return null;
}

const CONTROL_RPC_ENDPOINTS = new Set([
  "heartbeat",
  "run-status",
  "run-record",
  "run-bootstrap",
  "run-fail",
  "run-reset",
  "api-keys",
  "run-usage",
  "run-context",
  "run-config",
  "no-llm-complete",
  "conversation-history",
  "skill-runtime-context",
  "skill-catalog",
  "skill-plan",
  "memory-activation",
  "memory-finalize",
  "add-message",
  "update-run-status",
  "current-session",
  "is-cancelled",
  "tool-catalog",
  "tool-execute",
  "tool-cleanup",
  "run-event",
]);

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
