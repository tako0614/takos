/**
 * Executor RPC dispatch
 *
 * The executor-host verifies the per-run proxy token + scope, then dispatches
 * each container Control RPC into the matching handler IN-PROCESS via
 * `dispatchControlRpc` below. takos / takosumi / the executor-host all live in
 * the same worker isolate, so there is no service-binding hop: the request body
 * is already a parsed record, the run is already token-bound, and the handlers
 * read DB / services directly. All handlers keep their original behavior; only
 * the redundant self-HTTP round-trip + internal-token recheck are gone.
 */

import type { Env } from "../shared/types/index.ts";
import { logError } from "../shared/utils/logger.ts";

// Handler imports from the existing executor subsystem — these contain the
// actual business logic (DB queries, tool execution, memory graph, billing, etc.)
import {
  handleCurrentSession,
  handleHeartbeat,
  handleIsCancelled,
  handleNoLlmComplete,
  handleRunBootstrap,
  handleRunContext,
  handleRunFail,
  handleRunRecord,
  handleRunReset,
  handleRunStatus,
} from "./container-hosts/executor-run-state.ts";

import {
  handleAddMessage,
  handleConversationHistory,
  handleMemoryActivation,
  handleMemoryFinalize,
  handleRunConfig,
  handleRunEvent,
  handleSkillCatalog,
  handleSkillPlan,
  handleSkillRuntimeContext,
  handleToolCatalog,
  handleToolCleanup,
  handleToolExecute,
  handleUpdateRunStatus,
} from "./container-hosts/executor-control-rpc.ts";

import { recordRunUsageBatch } from "../application/services/app-usage/usage-recorder.ts";
import {
  agentControlRpcPath,
  CONTROL_RPC_ENDPOINTS,
  err,
  ok,
} from "./container-hosts/executor-utils.ts";
import { getDb } from "../infra/db/index.ts";
import { runs } from "../infra/db/schema.ts";
import { eq } from "drizzle-orm";

// Terminal run statuses: a run in any of these states must not be handed
// deployment-global provider keys. Mirrors isTerminalRunStatus in
// container-hosts/executor-host.ts (the proxy-token revocation gate).
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

/**
 * Least-privilege gate for the deployment-global provider key handout.
 *
 * The caller is already authenticated as the run bound to `body.runId`: the
 * executor-host overwrites this field from the verified proxy token before
 * dispatching here in-process. This check adds a freshness requirement: the
 * token-bound run must still be active. A run that has gone terminal (or no
 * longer exists) must not be able to keep pulling shared provider credentials,
 * even though its proxy token may not yet have been revoked.
 *
 * Returns `null` when the run is active (caller may proceed), otherwise the
 * rejection Response. Identity stays token-bound: we read the run by the
 * `runId` the token authorized, never by an attacker-chosen target.
 */
async function rejectApiKeysIfRunInactive(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response | null> {
  const runId = typeof body.runId === "string" && body.runId.length > 0
    ? body.runId
    : null;
  if (!runId) {
    return err("Missing runId", 400);
  }
  let status: string | null;
  try {
    const db = getDb(env.DB);
    const row = await db.select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();
    status = row?.status ?? null;
  } catch (e) {
    logError("api-keys run-active check failed", e, {
      module: "executor-proxy-api",
    });
    return err("Run lookup failed", 503);
  }
  // Missing run or terminal run: deny. Only an in-flight run (queued / running)
  // may receive the shared provider keys.
  if (status === null || TERMINAL_RUN_STATUSES.has(status)) {
    return err("Run is not active", 403);
  }
  return null;
}

// ---------------------------------------------------------------------------
// In-process control-RPC dispatch
// ---------------------------------------------------------------------------

/**
 * Generic control-RPC handlers, keyed by endpoint slug. Every handler takes the
 * parsed body and env and returns a Response; tool-cleanup is normalized to the
 * same shape (it ignores env). The two bespoke endpoints (run-usage, api-keys)
 * are NOT here — they carry extra metering / least-privilege logic and are
 * dispatched directly below.
 */
const CONTROL_RPC_HANDLERS: Record<
  string,
  (body: Record<string, unknown>, env: Env) => Response | Promise<Response>
> = {
  // run lifecycle / status
  "heartbeat": handleHeartbeat,
  "run-status": handleRunStatus,
  "run-record": handleRunRecord,
  "run-bootstrap": handleRunBootstrap,
  "run-fail": handleRunFail,
  "run-reset": handleRunReset,
  "run-context": handleRunContext,
  "run-config": handleRunConfig,
  "no-llm-complete": handleNoLlmComplete,
  "current-session": handleCurrentSession,
  "is-cancelled": handleIsCancelled,
  "update-run-status": handleUpdateRunStatus,
  "run-event": handleRunEvent,
  // conversation / session / messages
  "conversation-history": handleConversationHistory,
  "add-message": handleAddMessage,
  // memory
  "memory-activation": handleMemoryActivation,
  "memory-finalize": handleMemoryFinalize,
  // skills
  "skill-runtime-context": handleSkillRuntimeContext,
  "skill-catalog": handleSkillCatalog,
  "skill-plan": handleSkillPlan,
  // tools
  "tool-catalog": handleToolCatalog,
  "tool-execute": handleToolExecute,
  "tool-cleanup": (body) => handleToolCleanup(body),
};

// --- Bespoke endpoint handlers (run-usage, api-keys) ---
//
// These two carry extra metering / least-privilege logic and so are not in the
// generic CONTROL_RPC_HANDLERS map. Each takes the already-parsed body + env
// and returns a Response, matching the generic handler shape.

async function handleRunUsage(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const runId = typeof body.runId === "string" ? body.runId : undefined;
  if (!runId) return err("Missing runId", 400);
  try {
    await recordRunUsageBatch(env, runId);
    return ok({ recorded: true });
  } catch (usageErr) {
    logError(`Usage recording failed for run ${runId}`, usageErr, {
      module: "executor-proxy-api",
    });
    return ok({ recorded: false, error: "usage_recording_failed" });
  }
}

async function handleApiKeys(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  // Only hand out the deployment-global provider keys while the token-bound
  // run is still active; a missing/terminal run is rejected.
  const inactive = await rejectApiKeysIfRunInactive(body, env);
  if (inactive) return inactive;
  return ok({
    openai: env.OPENAI_API_KEY ?? null,
    anthropic: env.ANTHROPIC_API_KEY ?? null,
    google: env.GOOGLE_API_KEY ?? null,
  });
}

/**
 * Lookup from the agent-control RPC path the executor-host already verified
 * (`/api/internal/v1/agent-control/<name>`) to the in-process handler. Derived
 * from the single CONTROL_RPC_ENDPOINTS registry so route / scope / dispatch
 * coverage stays in lockstep: every registry entry resolves either to a generic
 * handler or to one of the two bespoke handlers, and a registry entry that
 * resolves to neither is a build/boot bug.
 */
const CONTROL_RPC_DISPATCH: ReadonlyMap<
  string,
  (body: Record<string, unknown>, env: Env) => Response | Promise<Response>
> = new Map(
  CONTROL_RPC_ENDPOINTS.map(({ name }) => {
    const handler = CONTROL_RPC_HANDLERS[name] ??
      (name === "run-usage"
        ? handleRunUsage
        : name === "api-keys"
        ? handleApiKeys
        : undefined);
    if (!handler) {
      throw new Error(`No control-RPC handler registered for "${name}"`);
    }
    return [agentControlRpcPath(name), handler] as const;
  }),
);

/**
 * Dispatch a verified container Control RPC to its handler IN-PROCESS.
 *
 * The executor-host has already verified the per-run proxy token, overwritten
 * runId/serviceId from the token, and checked endpoint scope, so `body` is a
 * parsed, token-bound record. We map the agent-control path to its handler and
 * invoke it directly — no service-binding hop, no internal-token recheck.
 *
 * Returns `null` only when `path` is not a mapped control-RPC path, so the
 * caller can surface a 404 for an unknown endpoint.
 */
export function dispatchControlRpc(
  path: string,
  body: Record<string, unknown>,
  env: Env,
): Response | Promise<Response> | null {
  const handler = CONTROL_RPC_DISPATCH.get(path);
  if (!handler) return null;
  return handler(body, env);
}
