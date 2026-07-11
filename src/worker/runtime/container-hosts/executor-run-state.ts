/**
 * Run state management — DB lookups, heartbeat, status transitions,
 * and run lifecycle handlers for the executor-host subsystem.
 */

import { getDb } from "../../infra/db/index.ts";
import { accounts, messages, runs, threads } from "../../infra/db/schema.ts";
import { and, desc, eq } from "drizzle-orm";
import { logError, logWarn } from "../../shared/utils/logger.ts";
import { affectedRowCount } from "../../shared/utils/affected-row-count.ts";
import type { SelectOf } from "../../shared/types/drizzle-utils.ts";
import type { Env } from "../../shared/types/index.ts";
import {
  AuthorizationError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";
import {
  classifyProxyError,
  err,
  ok,
  readRunServiceId,
} from "./executor-utils.ts";
import { resolveSpaceRole } from "../../application/services/platform/capabilities.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RunBootstrap = {
  status: SelectOf<typeof runs>["status"] | null;
  spaceId: string;
  installationId?: string;
  runtimeNamespace?: string;
  threadId: string;
  userId: string;
  agentType: string;
};

export type RunBootstrapInstallationContext = Pick<
  RunBootstrap,
  "installationId" | "runtimeNamespace"
>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export function readRunBootstrapInstallationContext(
  input: string | null | undefined,
): RunBootstrapInstallationContext {
  const parsed = parseRunInputObject(input);
  if (!parsed) return {};

  const installationId =
    readStringValue(parsed, [
      "installationId",
      "installation_id",
      "appInstallationId",
      "app_installation_id",
    ]) ??
    readNestedStringValue(parsed, ["installation", "id"]) ??
    readNestedStringValue(parsed, ["appInstallation", "id"]) ??
    readNestedStringValue(parsed, ["accounts", "installationId"]);
  const runtimeNamespace =
    readStringValue(parsed, [
      "runtimeNamespace",
      "runtime_namespace",
      "runtimeTargetId",
      "runtime_target_id",
    ]) ??
    readNestedStringValue(parsed, ["runtime", "namespace"]) ??
    readNestedStringValue(parsed, ["runtime", "targetId"]) ??
    readNestedStringValue(parsed, ["runtimeBinding", "targetId"]) ??
    readNestedStringValue(parsed, ["runtimeBinding", "target_id"]);

  return {
    ...(installationId ? { installationId } : {}),
    ...(runtimeNamespace ? { runtimeNamespace } : {}),
  };
}

function parseRunInputObject(
  input: string | null | undefined,
): Record<string, unknown> | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function readStringValue(
  source: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function readNestedStringValue(
  source: Record<string, unknown>,
  path: readonly string[],
): string | undefined {
  let current: unknown = source;
  for (const segment of path) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.trim()
    ? current.trim()
    : undefined;
}

export async function resolveExecutionUserIdForRun(
  env: Env,
  runId: string,
): Promise<string> {
  const db = getDb(env.DB);
  const runRow = await db
    .select({
      accountId: runs.accountId,
      requesterAccountId: runs.requesterAccountId,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();

  if (!runRow?.accountId) {
    throw new NotFoundError(`Run ${runId} while resolving execution user`);
  }

  if (runRow.requesterAccountId) {
    return runRow.requesterAccountId;
  }

  const workspace = await db
    .select({
      type: accounts.type,
      ownerAccountId: accounts.ownerAccountId,
    })
    .from(accounts)
    .where(eq(accounts.id, runRow.accountId))
    .get();

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

/**
 * Revalidate the requester represented by a durable Run against current
 * Workspace membership. Queued runs and long-lived containers must not retain
 * the viewer fallback after the requester is removed or suspended.
 */
export async function assertRunExecutionAccess(
  env: Env,
  runId: string,
): Promise<{
  userId: string;
  role: NonNullable<Awaited<ReturnType<typeof resolveSpaceRole>>>;
}> {
  const db = getDb(env.DB);
  const run = await db
    .select({ accountId: runs.accountId })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();
  if (!run) throw new NotFoundError(`Run ${runId}`);
  const userId = await resolveExecutionUserIdForRun(env, runId);
  const role = await resolveSpaceRole(env.DB, run.accountId, userId);
  if (!role) {
    throw new AuthorizationError(
      `Run requester ${userId} no longer has access to account ${run.accountId}`,
    );
  }
  return { userId, role };
}

export async function getRunBootstrap(
  env: Env,
  runId: string,
): Promise<RunBootstrap> {
  const db = getDb(env.DB);
  const run = await db
    .select({
      id: runs.id,
      status: runs.status,
      accountId: runs.accountId,
      input: runs.input,
      threadId: runs.threadId,
      agentType: runs.agentType,
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();

  if (!run) {
    throw new NotFoundError(`Run ${runId}`);
  }

  const thread = await db
    .select({
      accountId: threads.accountId,
    })
    .from(threads)
    .where(eq(threads.id, run.threadId))
    .get();

  if (!thread) {
    throw new NotFoundError(`Thread ${run.threadId}`);
  }

  if (thread.accountId !== run.accountId) {
    throw new AuthorizationError(
      `Thread ${run.threadId} does not belong to account ${run.accountId}`,
    );
  }

  const { userId } = await assertRunExecutionAccess(env, runId);

  return {
    status: run.status,
    spaceId: run.accountId,
    ...readRunBootstrapInstallationContext(run.input),
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
    const conditions = [
      eq(runs.id, runId),
      eq(runs.serviceId, serviceId),
      eq(runs.status, "running"),
    ];
    if (typeof leaseVersion === "number") {
      conditions.push(eq(runs.leaseVersion, leaseVersion));
    }
    const result = await db
      .update(runs)
      .set({ serviceHeartbeat: now })
      .where(and(...conditions));
    if (affectedRowCount(result) === 0) {
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
    const row = await db
      .select({ status: runs.status })
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
    const run = await db
      .select({
        status: runs.status,
        input: runs.input,
        parentRunId: runs.parentRunId,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();
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
    const result = await db
      .update(runs)
      .set({
        status: "failed",
        error: errorMessage,
        completedAt: new Date().toISOString(),
      })
      .where(and(...conditions));
    if (affectedRowCount(result) === 0) return err("Lease lost", 409);
    return ok({ success: true, updated: true });
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
  const { runId, leaseVersion } = body as {
    runId: string;
    leaseVersion?: number;
  };
  const serviceId = readRunServiceId(body);
  if (!runId || !serviceId) return err("Missing runId or serviceId", 400);

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
    const result = await db
      .update(runs)
      .set({
        status: "queued",
        serviceId: null,
        serviceHeartbeat: null,
        completionKey: null,
        completedAt: null,
      })
      .where(and(...conditions));
    if (affectedRowCount(result) === 0) return err("Lease lost", 409);
    return ok({ success: true });
  } catch (e: unknown) {
    logError(`Run reset error`, e, { module: "executor-host" });
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
    const run = await db
      .select({
        status: runs.status,
      })
      .from(runs)
      .where(eq(runs.id, runId))
      .get();
    return ok({ cancelled: run?.status === "cancelled" });
  } catch (e: unknown) {
    logError("Is cancelled RPC error", e, { module: "executor-host" });
    const classified = classifyProxyError(e);
    return err(classified.message, classified.status);
  }
}
