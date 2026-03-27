/**
 * Executor RPC Proxy API
 *
 * Exposes /internal/executor-rpc/* endpoints on the main takos-web worker.
 * The executor-host (thin proxy) forwards container Control RPC requests here
 * via its TAKOS_CONTROL service binding, keeping all DB/service access within
 * the main control-plane worker.
 *
 * Authentication: validates X-Takos-Internal header (shared secret between
 * executor-host and main worker via env var).
 */

import { Hono } from 'hono';
import type { Env } from '../shared/types';
import { logError } from '../shared/utils/logger';

// Handler imports from the existing executor subsystem — these contain the
// actual business logic (DB queries, tool execution, memory graph, billing, etc.)
import {
  handleHeartbeat,
  handleRunStatus,
  handleRunRecord,
  handleRunBootstrap,
  handleRunFail,
  handleRunReset,
  handleRunContext,
  handleNoLlmComplete,
  handleCurrentSession,
  handleIsCancelled,
} from './container-hosts/executor-run-state';

import {
  handleConversationHistory,
  handleSkillPlan,
  handleMemoryActivation,
  handleMemoryFinalize,
  handleAddMessage,
  handleUpdateRunStatus,
  handleToolCatalog,
  handleToolExecute,
  handleToolCleanup,
  handleRunEvent,
} from './container-hosts/executor-control-rpc';

import { recordRunUsageBatch } from '../application/services/billing/billing';
import { ok, err } from './container-hosts/executor-utils';

// ---------------------------------------------------------------------------
// Auth middleware: validate internal service binding token
// ---------------------------------------------------------------------------

function validateInternalToken(request: Request, env: Env): boolean {
  const token = request.headers.get('X-Takos-Internal');
  if (!token) return false;
  const expected = (env as unknown as Record<string, unknown>).EXECUTOR_PROXY_SECRET;
  if (!expected || typeof expected !== 'string') return false;
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
  router.use('*', async (c, next) => {
    if (!validateInternalToken(c.req.raw, c.env)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });

  // --- Run lifecycle ---

  router.post('/heartbeat', async (c) => {
    const body = await c.req.json();
    return handleHeartbeat(body, c.env as never);
  });

  router.post('/run-status', async (c) => {
    const body = await c.req.json();
    return handleRunStatus(body, c.env as never);
  });

  router.post('/run-record', async (c) => {
    const body = await c.req.json();
    return handleRunRecord(body, c.env as never);
  });

  router.post('/run-bootstrap', async (c) => {
    const body = await c.req.json();
    return handleRunBootstrap(body, c.env as never);
  });

  router.post('/run-fail', async (c) => {
    const body = await c.req.json();
    return handleRunFail(body, c.env as never);
  });

  router.post('/run-reset', async (c) => {
    const body = await c.req.json();
    return handleRunReset(body, c.env as never);
  });

  router.post('/run-context', async (c) => {
    const body = await c.req.json();
    return handleRunContext(body, c.env as never);
  });

  router.post('/no-llm-complete', async (c) => {
    const body = await c.req.json();
    return handleNoLlmComplete(body, c.env as never);
  });

  router.post('/current-session', async (c) => {
    const body = await c.req.json();
    return handleCurrentSession(body, c.env as never);
  });

  router.post('/is-cancelled', async (c) => {
    const body = await c.req.json();
    return handleIsCancelled(body, c.env as never);
  });

  // --- Control RPC ---

  router.post('/conversation-history', async (c) => {
    const body = await c.req.json();
    return handleConversationHistory(body, c.env as never);
  });

  router.post('/skill-plan', async (c) => {
    const body = await c.req.json();
    return handleSkillPlan(body, c.env as never);
  });

  router.post('/memory-activation', async (c) => {
    const body = await c.req.json();
    return handleMemoryActivation(body, c.env as never);
  });

  router.post('/memory-finalize', async (c) => {
    const body = await c.req.json();
    return handleMemoryFinalize(body, c.env as never);
  });

  router.post('/add-message', async (c) => {
    const body = await c.req.json();
    return handleAddMessage(body, c.env as never);
  });

  router.post('/update-run-status', async (c) => {
    const body = await c.req.json();
    return handleUpdateRunStatus(body, c.env as never);
  });

  router.post('/tool-catalog', async (c) => {
    const body = await c.req.json();
    return handleToolCatalog(body, c.env as never);
  });

  router.post('/tool-execute', async (c) => {
    const body = await c.req.json();
    return handleToolExecute(body, c.env as never);
  });

  router.post('/tool-cleanup', async (c) => {
    const body = await c.req.json();
    return handleToolCleanup(body);
  });

  router.post('/run-event', async (c) => {
    const body = await c.req.json();
    return handleRunEvent(body, c.env as never);
  });

  // --- Billing ---

  router.post('/billing-run-usage', async (c) => {
    const body = await c.req.json() as { runId?: string };
    if (!body.runId) return err('Missing runId', 400);
    try {
      await recordRunUsageBatch(c.env as never, body.runId);
      return ok({ recorded: true });
    } catch (billingErr) {
      logError(`Billing recording failed for run ${body.runId}`, billingErr, { module: 'executor-proxy-api' });
      return ok({ recorded: false, error: 'billing_failed' });
    }
  });

  // --- API keys ---

  router.post('/api-keys', async (c) => {
    const env = c.env as unknown as Record<string, unknown>;
    return ok({
      openai: env.OPENAI_API_KEY ?? null,
      anthropic: env.ANTHROPIC_API_KEY ?? null,
      google: env.GOOGLE_API_KEY ?? null,
    });
  });

  return router;
}
