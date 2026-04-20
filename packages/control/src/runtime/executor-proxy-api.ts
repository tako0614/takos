/**
 * Executor RPC Proxy API
 *
 * Exposes /internal/executor-rpc/* endpoints on the main takos worker.
 * The executor-host (thin proxy) forwards container Control RPC requests here
 * via its TAKOS_CONTROL service binding, keeping all DB/service access within
 * the main control-plane worker.
 *
 * Authentication: validates X-Takos-Internal header (shared secret between
 * executor-host and main worker via env var).
 */

import { Hono } from "hono";
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

import { recordRunUsageBatch } from "../application/services/billing/billing.ts";
import { err, ok } from "./container-hosts/executor-utils.ts";

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

  // --- Run lifecycle ---

  router.post("/heartbeat", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleHeartbeat(body, c.env);
  });

  router.post("/run-status", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleRunStatus(body, c.env);
  });

  router.post("/run-record", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleRunRecord(body, c.env);
  });

  router.post("/run-bootstrap", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleRunBootstrap(body, c.env);
  });

  router.post("/run-fail", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleRunFail(body, c.env);
  });

  router.post("/run-reset", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleRunReset(body, c.env);
  });

  router.post("/run-context", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleRunContext(body, c.env);
  });

  router.post("/run-config", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleRunConfig(body, c.env);
  });

  router.post("/no-llm-complete", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleNoLlmComplete(body, c.env);
  });

  router.post("/current-session", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleCurrentSession(body, c.env);
  });

  router.post("/is-cancelled", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleIsCancelled(body, c.env);
  });

  // --- Control RPC ---

  router.post("/conversation-history", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleConversationHistory(body, c.env);
  });

  router.post("/skill-runtime-context", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleSkillRuntimeContext(body, c.env);
  });

  router.post("/skill-catalog", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleSkillCatalog(body, c.env);
  });

  router.post("/skill-plan", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleSkillPlan(body, c.env);
  });

  router.post("/memory-activation", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleMemoryActivation(body, c.env);
  });

  router.post("/memory-finalize", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleMemoryFinalize(body, c.env);
  });

  router.post("/add-message", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleAddMessage(body, c.env);
  });

  router.post("/update-run-status", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleUpdateRunStatus(body, c.env);
  });

  router.post("/tool-catalog", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleToolCatalog(body, c.env);
  });

  router.post("/tool-execute", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleToolExecute(body, c.env);
  });

  router.post("/tool-cleanup", async (c) => {
    const body = await c.req.json();
    return handleToolCleanup(body);
  });

  router.post("/run-event", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return handleRunEvent(body, c.env);
  });

  // --- Billing ---

  router.post("/billing-run-usage", async (c) => {
    const body = await c.req.json() as { runId?: string };
    if (!body.runId) return err("Missing runId", 400);
    try {
      await recordRunUsageBatch(c.env, body.runId);
      return ok({ recorded: true });
    } catch (billingErr) {
      logError(`Billing recording failed for run ${body.runId}`, billingErr, {
        module: "executor-proxy-api",
      });
      return ok({ recorded: false, error: "billing_failed" });
    }
  });

  // --- API keys ---

  router.post("/api-keys", async (c) => {
    return ok({
      openai: c.env.OPENAI_API_KEY ?? null,
      anthropic: c.env.ANTHROPIC_API_KEY ?? null,
      google: c.env.GOOGLE_API_KEY ?? null,
    });
  });

  return router;
}
