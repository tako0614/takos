/**
 * Run state management — DB lookups, heartbeat, status transitions,
 * and run lifecycle handlers for the executor-host subsystem.
 */

import { getDb } from "../../infra/db/index.ts";
import { accounts, messages, runs, threads } from "../../infra/db/schema.ts";
import { and, desc, eq } from "drizzle-orm";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import type { SelectOf } from "../../shared/types/drizzle-utils.ts";
import type { Env } from "../../shared/types/index.ts";
import { AuthorizationError, NotFoundError } from "takos-common/errors";
import { persistMessage } from "../../application/services/agent/message-persistence.ts";
import {
  buildRunNotifierEmitPayload,
  buildRunNotifierEmitRequest,
  buildTerminalPayload,
  getRunNotifierStub,
} from "../../application/services/run-notifier/index.ts";
import {
  classifyProxyError,
  err,
  ok,
  readRunServiceId,
} from "./executor-utils.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunBootstrap = {
  status: SelectOf<typeof runs>["status"] | null;
  spaceId: string;
  sessionId: string | null;
  threadId: string;
  userId: string;
  agentType: string;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export async function resolveExecutionUserIdForRun(
  env: Env,
  runId: string,
): Promise<string> {
  const db = getDb(env.DB);
  const runRow = await db.select({
    accountId: runs.accountId,
    requesterAccountId: runs.requesterAccountId,
  }).from(runs).where(eq(runs.id, runId)).get();

  if (!runRow?.accountId) {
    throw new NotFoundError(`Run ${runId} while resolving execution user`);
  }

  if (runRow.requesterAccountId) {
    return runRow.requesterAccountId;
  }

  const workspace = await db.select({
    type: accounts.type,
    ownerAccountId: accounts.ownerAccountId,
  }).from(accounts).where(eq(accounts.id, runRow.accountId)).get();

  if (workspace?.ownerAccountId) {
    logWarn(
      `Run ${runId} missing requester_account_id; falling back to workspace owner`,
      { module: "executor-host" },
    );
    return workspace.ownerAccountId;
  }

  if (workspace?.type === "user") {
    return runRow.accountId;
  }

  logWarn(
    `Run ${runId} missing requester_account_id; falling back to workspace account id`,
    { module: "executor-host" },
  );
  return runRow.accountId;
}

export async function getRunBootstrap(
  env: Env,
  runId: string,
): Promise<RunBootstrap> {
  const db = getDb(env.DB);
  const run = await db.select({
    id: runs.id,
    status: runs.status,
    accountId: runs.accountId,
    sessionId: runs.sessionId,
    threadId: runs.threadId,
    agentType: runs.agentType,
  }).from(runs).where(eq(runs.id, runId)).get();

  if (!run) {
    throw new NotFoundError(`Run ${runId}`);
  }

  const thread = await db.select({
    accountId: threads.accountId,
  }).from(threads).where(eq(threads.id, run.threadId)).get();

  if (!thread) {
    throw new NotFoundError(`Thread ${run.threadId}`);
  }

  if (thread.accountId !== run.accountId) {
    throw new AuthorizationError(
      `Thread ${run.threadId} does not belong to account ${run.accountId}`,
    );
  }

  const userId = await resolveExecutionUserIdForRun(env, runId);

  return {
    status: run.status,
    spaceId: run.accountId,
    sessionId: run.sessionId ?? null,
    threadId: run.threadId,
    userId,
    agentType: run.agentType,
  };
}

// ---------------------------------------------------------------------------
// Proxy / RPC handlers — run lifecycle
// ---------------------------------------------------------------------------

export async function handleHeartbeat(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId, leaseVersion } = body as {
    runId: string;
    leaseVersion?: number;
  };
  const serviceId = readRunServiceId(body);
  if (!runId || !serviceId) return err("Missing runId or serviceId", 400);

  try {
    const db = getDb(env.DB);
    const now = new Date().toISOString();
    const conditions = [eq(runs.id, runId), eq(runs.serviceId, serviceId)];
    if (typeof leaseVersion === "number") {
      conditions.push(eq(runs.leaseVersion, leaseVersion));
    }
    const result = await db.update(runs)
      .set({ serviceHeartbeat: now })
      .where(and(...conditions));
    if (result.meta.changes === 0) {
      return err("Lease lost", 409);
    }
    return ok({ success: true });
  } catch (e: unknown) {
    logError(`Heartbeat error`, e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleRunStatus(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err("Missing runId", 400);

  try {
    const db = getDb(env.DB);
    const row = await db.select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    return ok({ status: row[0]?.status ?? null });
  } catch (e: unknown) {
    logError(`Run status error`, e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleRunRecord(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err("Missing runId", 400);

  try {
    const db = getDb(env.DB);
    const run = await db.select({
      status: runs.status,
      input: runs.input,
      parentRunId: runs.parentRunId,
    }).from(runs).where(eq(runs.id, runId)).get();
    return ok({
      status: run?.status ?? null,
      input: run?.input ?? null,
      parentRunId: run?.parentRunId ?? null,
    });
  } catch (e: unknown) {
    logError("Run record error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleRunBootstrap(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err("Missing runId", 400);

  try {
    return ok(await getRunBootstrap(env, runId));
  } catch (e: unknown) {
    logError("Run bootstrap error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleRunFail(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const {
    runId,
    leaseVersion,
    error: errorMessage,
  } = body as {
    runId?: string;
    leaseVersion?: number;
    error?: string;
  };
  const serviceId = readRunServiceId(body);
  if (!runId || !serviceId) return err("Missing runId or serviceId", 400);
  if (typeof errorMessage !== "string" || errorMessage.trim().length === 0) {
    return err("Missing error", 400);
  }

  try {
    const db = getDb(env.DB);
    const conditions = [
      eq(runs.id, runId),
      eq(runs.serviceId, serviceId),
      eq(runs.status, "running"),
    ];
    if (typeof leaseVersion === "number") {
      conditions.push(eq(runs.leaseVersion, leaseVersion));
    }
    const result = await db.update(runs)
      .set({
        status: "failed",
        error: errorMessage,
        completedAt: new Date().toISOString(),
      })
      .where(and(...conditions));
    return ok({ success: true, updated: result.meta.changes > 0 });
  } catch (e: unknown) {
    logError(`Run fail error`, e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleRunReset(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId } = body as { runId: string };
  const serviceId = readRunServiceId(body);
  if (!runId || !serviceId) return err("Missing runId or serviceId", 400);

  try {
    const db = getDb(env.DB);
    await db.update(runs)
      .set({ status: "queued", serviceId: null, serviceHeartbeat: null })
      .where(
        and(
          eq(runs.id, runId),
          eq(runs.serviceId, serviceId),
          eq(runs.status, "running"),
        ),
      );
    return ok({ success: true });
  } catch (e: unknown) {
    logError(`Run reset error`, e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleRunContext(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err("Missing runId", 400);

  try {
    const db = getDb(env.DB);
    const run = await db.select({
      status: runs.status,
      threadId: runs.threadId,
      sessionId: runs.sessionId,
    }).from(runs).where(eq(runs.id, runId)).get();

    if (!run) {
      return ok({
        status: null,
        threadId: null,
        sessionId: null,
        lastUserMessage: null,
      });
    }

    const latestUserMessage = run.threadId
      ? await db.select({ content: messages.content })
        .from(messages)
        .where(
          and(eq(messages.threadId, run.threadId), eq(messages.role, "user")),
        )
        .orderBy(desc(messages.sequence))
        .get()
      : null;

    return ok({
      status: run.status ?? null,
      threadId: run.threadId ?? null,
      sessionId: run.sessionId ?? null,
      lastUserMessage: latestUserMessage?.content ?? null,
    });
  } catch (e: unknown) {
    logError("Run context error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleNoLlmComplete(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId, response } = body as {
    runId?: string;
    response?: string;
  };
  const serviceId = readRunServiceId(body);
  if (!runId || !serviceId) return err("Missing runId or serviceId", 400);
  if (typeof response !== "string" || response.trim().length === 0) {
    return err("Missing response", 400);
  }

  try {
    const db = getDb(env.DB);
    const run = await db.select({
      id: runs.id,
      status: runs.status,
      threadId: runs.threadId,
      sessionId: runs.sessionId,
      serviceId: runs.serviceId,
    }).from(runs).where(eq(runs.id, runId)).get();

    if (!run) return err("Run not found", 404);
    if (run.serviceId !== serviceId) return err("Run service mismatch", 409);

    if (run.threadId) {
      await persistMessage(
        {
          db: env.DB,
          env,
          threadId: run.threadId,
        },
        { role: "assistant", content: response },
      );
    }

    const completedAt = new Date().toISOString();
    await db.update(runs)
      .set({
        status: "completed",
        output: JSON.stringify({ response, mode: "no-llm" }),
        usage: JSON.stringify({ inputTokens: 0, outputTokens: 0 }),
        completedAt,
      })
      .where(and(eq(runs.id, runId), eq(runs.serviceId, serviceId)));

    try {
      const stub = getRunNotifierStub(env, runId);
      await stub.fetch(buildRunNotifierEmitRequest(
        buildRunNotifierEmitPayload(runId, "message", { content: response }),
      ));
      await stub.fetch(buildRunNotifierEmitRequest(
        buildRunNotifierEmitPayload(
          runId,
          "completed",
          buildTerminalPayload(runId, "completed", {
            success: true,
            mode: "no-llm",
          }, run.sessionId ?? null),
        ),
      ));
    } catch (notifyError) {
      logError("No-LLM completion notifier emit failed", notifyError, {
        module: "executor-host",
      });
    }

    return ok({ success: true });
  } catch (e: unknown) {
    logError("No-LLM completion error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleCurrentSession(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId, spaceId } = body as { runId?: string; spaceId?: string };
  if (!runId || !spaceId) return err("Missing runId or spaceId", 400);

  try {
    const db = getDb(env.DB);
    const run = await db.select({
      sessionId: runs.sessionId,
    }).from(runs).where(and(eq(runs.id, runId), eq(runs.accountId, spaceId)))
      .get();
    return ok({ sessionId: run?.sessionId ?? null });
  } catch (e: unknown) {
    logError("Current session RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}

export async function handleIsCancelled(
  body: Record<string, unknown>,
  env: Env,
): Promise<Response> {
  const { runId } = body as { runId?: string };
  if (!runId) return err("Missing runId", 400);

  try {
    const db = getDb(env.DB);
    const run = await db.select({
      status: runs.status,
    }).from(runs).where(eq(runs.id, runId)).get();
    return ok({ cancelled: run?.status === "cancelled" });
  } catch (e: unknown) {
    logError("Is cancelled RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}
