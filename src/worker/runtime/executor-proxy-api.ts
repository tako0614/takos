/**
 * Executor RPC Proxy API
 *
 * Exposes /internal/executor-rpc/* endpoints on the main takos worker.
 * The executor-host (thin proxy) forwards container Control RPC requests here
 * via its TAKOS_WORKER service binding, keeping all DB/service access within
 * the main control-plane worker.
 *
 * Authentication: validates X-Takos-Internal header (shared secret between
 * executor-host and main worker via env var).
 */

import { Hono } from "hono";
import { verifyTakosumiInternalRequestFromHeaders as verifyTakosInternalRequestFromHeaders } from "takosumi-contract/internal/rpc";
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
  CONTROL_RPC_ENDPOINTS,
  err,
  ok,
  parseExecutorRpcBody,
} from "./container-hosts/executor-utils.ts";
import { getDb } from "../infra/db/index.ts";
import { runs } from "../infra/db/schema.ts";
import { eq } from "drizzle-orm";

const APP_AGENT_CONTROL_BACKEND_CAPABILITY = "app.agent-control.backend";

// Terminal run statuses: a run in any of these states must not be handed
// deployment-global provider keys. Mirrors isTerminalRunStatus in
// container-hosts/executor-host.ts (the proxy-token revocation gate).
const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

/**
 * Least-privilege gate for the deployment-global provider key handout.
 *
 * The caller is already authenticated as the run bound to `body.runId` (the
 * executor-host overwrites this field from the verified proxy token, and the
 * signed-backend bridge derives it from the token-bound actor — see
 * forwardToTakosumiAgentControl). This check adds a freshness requirement: the
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
// Auth middleware: validate internal service binding token
// ---------------------------------------------------------------------------

function validateInternalToken(request: Request, env: Env): boolean {
  const token = request.headers.get("X-Takos-Internal");
  if (!token) return false;
  const expected = env.EXECUTOR_PROXY_SECRET;
  if (!expected || typeof expected !== "string") return false;
  // Constant-time comparison
  if (token.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createExecutorProxyRouter() {
  const router = new Hono<{ Bindings: Env }>();

  // Auth guard for all routes
  router.use("*", async (c, next): Promise<void | Response> => {
    if (!validateInternalToken(c.req.raw, c.env)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });
  router.route("/", createExecutorHandlersRouter());

  return router;
}

export function createAgentControlBackendRouter() {
  const router = new Hono<{ Bindings: Env }>();

  router.use("*", async (c, next): Promise<void | Response> => {
    if (!await validateSignedBackendRequest(c.req.raw, c.env)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });
  router.route("/", createExecutorHandlersRouter());

  return router;
}

/**
 * Generic control-RPC handlers, keyed by endpoint slug. Every handler takes the
 * parsed body and env and returns a Response; tool-cleanup is normalized to the
 * same shape (it ignores env). The two bespoke endpoints (run-usage, api-keys)
 * are NOT here — they carry extra metering / least-privilege logic and are
 * registered directly below.
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

function createExecutorHandlersRouter() {
  const router = new Hono<{ Bindings: Env }>();

  // --- Generic control-RPC routes (parse + dispatch), derived from the single
  // CONTROL_RPC_ENDPOINTS registry so route / scope / forward coverage stays in
  // lockstep. Bespoke endpoints (run-usage, api-keys) are skipped here and
  // registered below. A registry entry without a handler is a build/boot bug,
  // so we fail loudly rather than silently 404. ---
  for (const { name } of CONTROL_RPC_ENDPOINTS) {
    const handler = CONTROL_RPC_HANDLERS[name];
    if (!handler) continue; // bespoke (run-usage / api-keys) — see below
    router.post(`/${name}`, async (c) => {
      const parsed = await parseExecutorRpcBody(c.req);
      if (!parsed.ok) return parsed.response;
      return handler(parsed.value, c.env);
    });
  }

  // --- Run usage metering ---

  router.post("/run-usage", async (c) => {
    const body = await c.req.json() as { runId?: string };
    if (!body.runId) return err("Missing runId", 400);
    try {
      await recordRunUsageBatch(c.env, body.runId);
      return ok({ recorded: true });
    } catch (usageErr) {
      logError(`Usage recording failed for run ${body.runId}`, usageErr, {
        module: "executor-proxy-api",
      });
      return ok({ recorded: false, error: "usage_recording_failed" });
    }
  });

  // --- API keys ---

  router.post("/api-keys", async (c) => {
    const parsed = await parseExecutorRpcBody(c.req);
    if (!parsed.ok) return parsed.response;
    // Only hand out the deployment-global provider keys while the token-bound
    // run is still active; a missing/terminal run is rejected.
    const inactive = await rejectApiKeysIfRunInactive(parsed.value, c.env);
    if (inactive) return inactive;
    return ok({
      openai: c.env.OPENAI_API_KEY ?? null,
      anthropic: c.env.ANTHROPIC_API_KEY ?? null,
      google: c.env.GOOGLE_API_KEY ?? null,
    });
  });

  return router;
}

async function validateSignedBackendRequest(
  request: Request,
  env: Env,
): Promise<boolean> {
  const secret = env.TAKOS_INTERNAL_SERVICE_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const body = await request.clone().text();
  const verified = await verifyTakosInternalRequestFromHeaders({
    method: request.method,
    path: url.pathname,
    query: url.search,
    body,
    secret,
    headers: request.headers,
    expectedCaller: "takosumi",
    expectedAudience: "takos-worker",
    requiredCapabilities: [APP_AGENT_CONTROL_BACKEND_CAPABILITY],
  });
  return verified !== undefined;
}
