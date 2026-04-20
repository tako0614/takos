/**
 * Proxy authentication, capability mapping, and resource access validation
 * for the executor-host subsystem.
 */

import type { ProxyCapability } from "./executor-utils.ts";

// ---------------------------------------------------------------------------
// Proxy capability resolution
// ---------------------------------------------------------------------------

export function getRequiredProxyCapability(
  path: string,
): ProxyCapability | null {
  if (
    path === "/proxy/heartbeat" ||
    path === "/proxy/run/status" ||
    path === "/proxy/run/fail" ||
    path === "/proxy/run/reset" ||
    path === "/proxy/api-keys" ||
    path === "/proxy/billing/run-usage" ||
    path === "/rpc/control/heartbeat" ||
    path === "/rpc/control/run-status" ||
    path === "/rpc/control/run-record" ||
    path === "/rpc/control/run-bootstrap" ||
    path === "/rpc/control/run-fail" ||
    path === "/rpc/control/run-reset" ||
    path === "/rpc/control/api-keys" ||
    path === "/rpc/control/billing-run-usage" ||
    path === "/rpc/control/run-context" ||
    path === "/rpc/control/run-config" ||
    path === "/rpc/control/no-llm-complete" ||
    path === "/rpc/control/conversation-history" ||
    path === "/rpc/control/skill-runtime-context" ||
    path === "/rpc/control/skill-catalog" ||
    path === "/rpc/control/skill-plan" ||
    path === "/rpc/control/memory-activation" ||
    path === "/rpc/control/memory-finalize" ||
    path === "/rpc/control/add-message" ||
    path === "/rpc/control/update-run-status" ||
    path === "/rpc/control/current-session" ||
    path === "/rpc/control/is-cancelled" ||
    path === "/rpc/control/tool-catalog" ||
    path === "/rpc/control/tool-execute" ||
    path === "/rpc/control/tool-cleanup" ||
    path === "/rpc/control/run-event"
  ) {
    return "control";
  }

  // Unknown proxy paths must be rejected — return null signals unauthorized
  return null;
}

// ---------------------------------------------------------------------------
// Claims / body matching
// ---------------------------------------------------------------------------

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

  if (claimRunId && bodyRunId && claimRunId !== bodyRunId) return false;
  if (claimServiceId && bodyServiceId && claimServiceId !== bodyServiceId) {
    return false;
  }
  return true;
}
