import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import type { Run } from "../../../shared/types/index.ts";
import {
  accounts,
  getDb,
  mcpConfirmationRunGrants,
  runContextRevisions,
  runGrants,
  runs,
} from "../../../infra/db/index.ts";
import {
  and,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";
import { resolveActorPrincipalId } from "../identity/principals.ts";
import { isInvalidArrayBufferError } from "../../../shared/utils/db-guards.ts";
import {
  asRunRow,
  type D1CountRow,
  type RunHierarchyNode,
  runRowToApi,
  type SpaceModelLookup,
} from "./run-serialization.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import type { BaseRunAuthority } from "./run-authority.ts";
import type { PreparedMcpConfirmationRunGrant } from "../platform/mcp/tool-confirmation.ts";

const TOP_LEVEL_RUN_RATE_LIMIT = {
  maxRunsPerMinute: 30,
  maxRunsPerHour: 500,
  maxConcurrentRuns: 20,
};

const CHILD_RUN_RATE_LIMIT = {
  maxRunsPerMinute: 20,
  maxRunsPerHour: 250,
  maxConcurrentRuns: 12,
};

type CreatePendingRunParams = {
  runId: string;
  threadId: string;
  spaceId: string;
  requesterAccountId: string;
  parentRunId: string | null;
  childThreadId: string | null;
  rootThreadId: string;
  rootRunId: string;
  agentType: string;
  model: string;
  input: string;
  createdAt: string;
  authority: BaseRunAuthority;
  confirmationGrant?: PreparedMcpConfirmationRunGrant | null;
};

type UpdateRunStatusParams = {
  runId: string;
  status: "queued" | "failed";
  error: string | null;
};

export type RunRateLimitResult = {
  allowed: boolean;
  reason?: string;
};

type RunRateLimitKind = "top_level" | "child";

async function withDrizzleInvalidArrayBufferFallback<T>(
  description: string,
  drizzleOp: () => Promise<T>,
  fallbackOp: () => Promise<T>,
): Promise<T> {
  try {
    return await drizzleOp();
  } catch (error) {
    if (!isInvalidArrayBufferError(error)) {
      throw error;
    }

    logWarn(
      `Falling back to SQL binding for ${description} after invalid array buffer error`,
      { module: "services/runs/create-thread-run-store" },
    );
    return fallbackOp();
  }
}

function readCount(row: D1CountRow | null | undefined): number {
  const parsed = Number(row?.count ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function checkRunRateLimitsFallback(
  db: SqlDatabaseBinding,
  principalId: string,
  spaceId: string,
  kind: RunRateLimitKind,
  clock: Clock = systemClock,
): Promise<RunRateLimitResult> {
  try {
    const rateLimit = kind === "child"
      ? CHILD_RUN_RATE_LIMIT
      : TOP_LEVEL_RUN_RATE_LIMIT;
    const parentPredicate = kind === "child" ? "IS NOT NULL" : "IS NULL";
    const nowMs = clock.now();
    const oneMinuteAgo = new Date(nowMs - 60 * 1000).toISOString();
    const oneHourAgo = new Date(nowMs - 60 * 60 * 1000).toISOString();

    const minuteCount = readCount(
      await db.prepare(`
      SELECT COUNT(*) AS count
      FROM runs
      WHERE account_id IN (
        SELECT id
        FROM accounts
        WHERE status = 'active'
          AND (owner_account_id = ? OR (type = 'user' AND id = ?))
      )
      AND parent_run_id ${parentPredicate}
      AND created_at > ?
    `).bind(principalId, principalId, oneMinuteAgo).first<D1CountRow>(),
    );

    if (minuteCount >= rateLimit.maxRunsPerMinute) {
      return {
        allowed: false,
        reason: kind === "child"
          ? `Child run rate limit exceeded: max ${rateLimit.maxRunsPerMinute} child runs per minute`
          : `Rate limit exceeded: max ${rateLimit.maxRunsPerMinute} runs per minute`,
      };
    }

    const hourCount = readCount(
      await db.prepare(`
      SELECT COUNT(*) AS count
      FROM runs
      WHERE account_id IN (
        SELECT id
        FROM accounts
        WHERE status = 'active'
          AND (owner_account_id = ? OR (type = 'user' AND id = ?))
      )
      AND parent_run_id ${parentPredicate}
      AND created_at > ?
    `).bind(principalId, principalId, oneHourAgo).first<D1CountRow>(),
    );

    if (hourCount >= rateLimit.maxRunsPerHour) {
      return {
        allowed: false,
        reason: kind === "child"
          ? `Child run rate limit exceeded: max ${rateLimit.maxRunsPerHour} child runs per hour`
          : `Rate limit exceeded: max ${rateLimit.maxRunsPerHour} runs per hour`,
      };
    }

    const concurrentCount = readCount(
      await db.prepare(`
      SELECT COUNT(*) AS count
      FROM runs
      WHERE account_id = ?
      AND parent_run_id ${parentPredicate}
      AND status IN ('queued', 'running')
    `).bind(spaceId).first<D1CountRow>(),
    );

    if (concurrentCount >= rateLimit.maxConcurrentRuns) {
      return {
        allowed: false,
        reason: kind === "child"
          ? `Too many concurrent child runs: max ${rateLimit.maxConcurrentRuns} per workspace`
          : `Too many concurrent runs: max ${rateLimit.maxConcurrentRuns} per workspace`,
      };
    }

    return { allowed: true };
  } catch (fallbackError) {
    logError(
      "Failed SQL fallback run rate limit lookup after error",
      fallbackError,
      { module: "services/runs/create-thread-run-store" },
    );
    // Fail closed: when the rate-limit lookup itself is unavailable we cannot
    // confirm the actor is under their limit, so we must deny rather than allow
    // unbounded runs. Allowing here would let a database/storage outage bypass
    // every per-actor and per-workspace run cap.
    return {
      allowed: false,
      reason: "Rate limit check unavailable, please retry shortly",
    };
  }
}

async function getRunHierarchyNodeFallback(
  db: SqlDatabaseBinding,
  runId: string,
): Promise<RunHierarchyNode | null> {
  const row = await db.prepare(`
    SELECT
      id,
      thread_id AS threadId,
      account_id AS accountId,
      parent_run_id AS parentRunId,
      root_thread_id AS rootThreadId,
      root_run_id AS rootRunId
    FROM runs
    WHERE id = ?
    LIMIT 1
  `).bind(runId).first<RunHierarchyNode>();

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    threadId: row.threadId,
    accountId: row.accountId,
    parentRunId: row.parentRunId ?? null,
    rootThreadId: row.rootThreadId ?? null,
    rootRunId: row.rootRunId ?? null,
  };
}

export async function getRunHierarchyNode(
  dbBinding: SqlDatabaseBinding,
  runId: string,
): Promise<RunHierarchyNode | null> {
  const db = getDb(dbBinding);
  return withDrizzleInvalidArrayBufferFallback(
    "parent run lookup",
    async () => {
      const row = await db.select({
        id: runs.id,
        threadId: runs.threadId,
        accountId: runs.accountId,
        parentRunId: runs.parentRunId,
        rootThreadId: runs.rootThreadId,
        rootRunId: runs.rootRunId,
      }).from(runs)
        .where(eq(runs.id, runId))
        .get();
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        threadId: row.threadId,
        accountId: row.accountId,
        parentRunId: row.parentRunId ?? null,
        rootThreadId: row.rootThreadId ?? null,
        rootRunId: row.rootRunId ?? null,
      };
    },
    () => getRunHierarchyNodeFallback(dbBinding, runId),
  );
}

async function getSpaceModelFallback(
  db: SqlDatabaseBinding,
  spaceId: string,
): Promise<SpaceModelLookup | null> {
  const row = await db.prepare(`
    SELECT
      ai_model AS aiModel
    FROM accounts
    WHERE id = ?
    LIMIT 1
  `).bind(spaceId).first<SpaceModelLookup>();

  if (!row) {
    return null;
  }

  return {
    aiModel: row.aiModel ?? null,
  };
}

export async function getSpaceModel(
  dbBinding: SqlDatabaseBinding,
  spaceId: string,
): Promise<SpaceModelLookup | null> {
  const db = getDb(dbBinding);
  return withDrizzleInvalidArrayBufferFallback(
    "space model lookup",
    async () => {
      const row = await db.select({ aiModel: accounts.aiModel })
        .from(accounts)
        .where(eq(accounts.id, spaceId))
        .get();
      if (!row) {
        return null;
      }
      return {
        aiModel: row.aiModel ?? null,
      };
    },
    () => getSpaceModelFallback(dbBinding, spaceId),
  );
}

async function getRunResponseFallback(
  db: SqlDatabaseBinding,
  runId: string,
): Promise<Run | null> {
  const row = await db.prepare(`
    SELECT
      id,
      thread_id AS threadId,
      account_id AS spaceId,
      session_id AS sessionId,
      parent_run_id AS parentRunId,
      child_thread_id AS childThreadId,
      root_thread_id AS rootThreadId,
      root_run_id AS rootRunId,
      agent_type AS agentType,
      model,
      status,
      current_context_revision,
      input,
      output,
      error,
      usage,
      service_id AS serviceId,
      service_heartbeat AS serviceHeartbeat,
      started_at AS startedAt,
      completed_at AS completedAt,
      created_at AS createdAt
    FROM runs
    WHERE id = ?
    LIMIT 1
  `).bind(runId).first<Record<string, unknown>>();

  return row ? runRowToApi(asRunRow(row)) : null;
}

export async function getRunResponse(
  dbBinding: SqlDatabaseBinding,
  runId: string,
): Promise<Run | null> {
  const db = getDb(dbBinding);
  return withDrizzleInvalidArrayBufferFallback(
    "run readback lookup",
    async () => {
      const row = await db.select().from(runs)
        .where(eq(runs.id, runId))
        .get();
      if (!row) return null;
      return runRowToApi(asRunRow({
        id: row.id,
        threadId: row.threadId,
        spaceId: row.accountId,
        sessionId: row.sessionId,
        parentRunId: row.parentRunId,
        childThreadId: row.childThreadId,
        rootThreadId: row.rootThreadId,
        rootRunId: row.rootRunId,
        agentType: row.agentType,
        model: row.model,
        status: row.status,
        input: row.input,
        output: row.output,
        error: row.error,
        usage: row.usage,
        serviceId: row.serviceId,
        serviceHeartbeat: row.serviceHeartbeat,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        createdAt: row.createdAt,
      }));
    },
    () => getRunResponseFallback(dbBinding, runId),
  );
}

export type RunCreationIdentity = {
  id: string;
  threadId: string;
  spaceId: string;
  requesterAccountId: string | null;
  parentRunId: string | null;
  agentType: string;
  model: string | null;
  input: string;
  confirmationGrantId: string | null;
};

async function getRunCreationIdentityFallback(
  db: SqlDatabaseBinding,
  runId: string,
): Promise<RunCreationIdentity | null> {
  return await db.prepare(`
    SELECT
      id,
      thread_id AS threadId,
      account_id AS spaceId,
      requester_account_id AS requesterAccountId,
      parent_run_id AS parentRunId,
      agent_type AS agentType,
      model,
      input,
      (
        SELECT confirmation_id
        FROM mcp_confirmation_run_grants
        WHERE run_id = runs.id
        LIMIT 1
      ) AS confirmationGrantId
    FROM runs
    WHERE id = ?
    LIMIT 1
  `).bind(runId).first<RunCreationIdentity>();
}

/** Immutable fields that define whether an idempotent Run is the same request. */
export async function getRunCreationIdentity(
  dbBinding: SqlDatabaseBinding,
  runId: string,
): Promise<RunCreationIdentity | null> {
  const db = getDb(dbBinding);
  return withDrizzleInvalidArrayBufferFallback(
    "run creation identity lookup",
    async () => {
      const row = await db.select({
        id: runs.id,
        threadId: runs.threadId,
        spaceId: runs.accountId,
        requesterAccountId: runs.requesterAccountId,
        parentRunId: runs.parentRunId,
        agentType: runs.agentType,
        model: runs.model,
        input: runs.input,
        confirmationGrantId: mcpConfirmationRunGrants.confirmationId,
      }).from(runs)
        .leftJoin(
          mcpConfirmationRunGrants,
          eq(mcpConfirmationRunGrants.runId, runs.id),
        )
        .where(eq(runs.id, runId))
        .get();
      return row ?? null;
    },
    () => getRunCreationIdentityFallback(dbBinding, runId),
  );
}

async function createPendingRunFallback(
  db: SqlDatabaseBinding,
  params: CreatePendingRunParams,
): Promise<void> {
  const runInsert = db.prepare(`
    INSERT INTO runs (
      id,
      thread_id,
      account_id,
      requester_account_id,
      session_id,
      parent_run_id,
      child_thread_id,
      root_thread_id,
      root_run_id,
      agent_type,
      model,
      status,
      current_context_revision,
      input,
      usage,
      created_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, '{}', ?)
  `).bind(
    params.runId,
    params.threadId,
    params.spaceId,
    params.requesterAccountId,
    params.parentRunId,
    params.childThreadId,
    params.rootThreadId,
    params.rootRunId,
    params.agentType,
    params.model,
    params.input,
    params.createdAt,
  );
  const grant = params.authority.grant;
  const grantInsert = db.prepare(`
    INSERT INTO run_grants (
      run_id,
      format_version,
      principal_id,
      workspace_id,
      parent_run_id,
      parent_grant_digest,
      enforcement_mode,
      grant_json,
      digest,
      created_at
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    grant.runId,
    grant.principalId,
    grant.workspaceId,
    grant.parentRunId,
    grant.parentGrantDigest,
    grant.enforcementMode,
    grant.grantJson,
    grant.digest,
    grant.createdAt,
  );
  const context = params.authority.context;
  const contextInsert = db.prepare(`
    INSERT INTO run_context_revisions (
      run_id,
      revision,
      parent_revision,
      activation_event_id,
      activation_event_key,
      format_version,
      principal_id,
      workspace_id,
      thread_id,
      transcript_cut_sequence,
      agent_profile_revision,
      model_revision,
      system_prompt_revision,
      run_grant_digest,
      record_mode,
      context_json,
      digest,
      created_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    context.runId,
    context.revision,
    context.parentRevision,
    context.activationEventId,
    context.activationEventKey,
    context.principalId,
    context.workspaceId,
    context.threadId,
    context.transcriptCutSequence,
    context.agentProfileRevision,
    context.modelRevision,
    context.systemPromptRevision,
    context.runGrantDigest,
    context.recordMode,
    context.contextJson,
    context.digest,
    context.createdAt,
  );

  const confirmationGrantInsert = params.confirmationGrant
    ? db.prepare(`
      INSERT INTO mcp_confirmation_run_grants (
        confirmation_id,
        run_id,
        principal_id,
        workspace_id,
        thread_id,
        run_context_revision,
        run_context_digest,
        run_grant_digest,
        origin_identity_hash,
        consumed_tool_call_id,
        consumed_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, NULL, NULL, ?)
    `).bind(
      params.confirmationGrant.confirmationId,
      params.runId,
      params.confirmationGrant.principalId,
      params.spaceId,
      params.threadId,
      context.digest,
      grant.digest,
      params.confirmationGrant.originIdentityHash,
      params.createdAt,
    )
    : null;

  // D1 batch is the atomic commit boundary. A Run without its base grant and
  // revision (or vice versa) must never become visible.
  await db.batch(
    confirmationGrantInsert
      ? [runInsert, grantInsert, contextInsert, confirmationGrantInsert]
      : [runInsert, grantInsert, contextInsert],
  );
}

export async function createPendingRun(
  dbBinding: SqlDatabaseBinding,
  params: CreatePendingRunParams,
): Promise<void> {
  const confirmationGrantIds = params.authority.grant.confirmationGrantIds;
  if (
    confirmationGrantIds.length !== (params.confirmationGrant ? 1 : 0) ||
    (params.confirmationGrant &&
      (confirmationGrantIds[0] !== params.confirmationGrant.confirmationId ||
        params.confirmationGrant.principalId !==
          params.authority.grant.principalId ||
        params.confirmationGrant.workspaceId !== params.spaceId ||
        params.confirmationGrant.threadId !== params.threadId))
  ) {
    throw new Error(
      "MCP confirmation claim does not match the compiled Run authority",
    );
  }
  const db = getDb(dbBinding);
  return withDrizzleInvalidArrayBufferFallback(
    "run create",
    async () => {
      const grant = params.authority.grant;
      const context = params.authority.context;
      const runInsert = db.insert(runs).values({
        id: params.runId,
        threadId: params.threadId,
        accountId: params.spaceId,
        requesterAccountId: params.requesterAccountId,
        sessionId: null,
        parentRunId: params.parentRunId,
        childThreadId: params.childThreadId,
        rootThreadId: params.rootThreadId,
        rootRunId: params.rootRunId,
        agentType: params.agentType,
        model: params.model,
        status: "pending",
        currentContextRevision: 1,
        input: params.input,
        usage: "{}",
        createdAt: params.createdAt,
      });
      const grantInsert = db.insert(runGrants).values({
        runId: grant.runId,
        formatVersion: 1,
        principalId: grant.principalId,
        workspaceId: grant.workspaceId,
        parentRunId: grant.parentRunId,
        parentGrantDigest: grant.parentGrantDigest,
        enforcementMode: grant.enforcementMode,
        grantJson: grant.grantJson,
        digest: grant.digest,
        createdAt: grant.createdAt,
      });
      const contextInsert = db.insert(runContextRevisions).values({
        runId: context.runId,
        revision: context.revision,
        parentRevision: context.parentRevision,
        activationEventId: context.activationEventId,
        activationEventKey: context.activationEventKey,
        formatVersion: 1,
        principalId: context.principalId,
        workspaceId: context.workspaceId,
        threadId: context.threadId,
        transcriptCutSequence: context.transcriptCutSequence,
        agentProfileRevision: context.agentProfileRevision,
        modelRevision: context.modelRevision,
        systemPromptRevision: context.systemPromptRevision,
        runGrantDigest: context.runGrantDigest,
        recordMode: context.recordMode,
        contextJson: context.contextJson,
        digest: context.digest,
        createdAt: context.createdAt,
      });
      if (params.confirmationGrant) {
        await db.batch([
          runInsert,
          grantInsert,
          contextInsert,
          db.insert(mcpConfirmationRunGrants).values({
            confirmationId: params.confirmationGrant.confirmationId,
            runId: params.runId,
            principalId: params.confirmationGrant.principalId,
            workspaceId: params.spaceId,
            threadId: params.threadId,
            runContextRevision: 1,
            runContextDigest: context.digest,
            runGrantDigest: grant.digest,
            originIdentityHash: params.confirmationGrant.originIdentityHash,
            consumedToolCallId: null,
            consumedAt: null,
            createdAt: params.createdAt,
          }),
        ]);
        return;
      }
      await db.batch([
        runInsert,
        grantInsert,
        contextInsert,
      ]);
    },
    () => createPendingRunFallback(dbBinding, params),
  );
}

async function updateRunStatusFallback(
  db: SqlDatabaseBinding,
  params: UpdateRunStatusParams,
): Promise<void> {
  await db.prepare(`
    UPDATE runs
    SET status = ?, error = ?
    WHERE id = ?
  `).bind(params.status, params.error, params.runId).run();
}

export async function updateRunStatus(
  dbBinding: SqlDatabaseBinding,
  params: UpdateRunStatusParams,
): Promise<void> {
  const db = getDb(dbBinding);
  return withDrizzleInvalidArrayBufferFallback(
    "run status update",
    async () => {
      await db.update(runs)
        .set({
          status: params.status,
          error: params.error,
        })
        .where(eq(runs.id, params.runId));
    },
    () => updateRunStatusFallback(dbBinding, params),
  );
}

export async function checkRunRateLimits(
  dbBinding: SqlDatabaseBinding,
  actorId: string,
  spaceId: string,
  options?: {
    isChildRun?: boolean;
  },
  clock: Clock = systemClock,
): Promise<RunRateLimitResult> {
  const db = getDb(dbBinding);
  const kind: RunRateLimitKind = options?.isChildRun ? "child" : "top_level";
  const rateLimit = kind === "child"
    ? CHILD_RUN_RATE_LIMIT
    : TOP_LEVEL_RUN_RATE_LIMIT;
  const parentCondition = kind === "child"
    ? isNotNull(runs.parentRunId)
    : isNull(runs.parentRunId);
  const nowMs = clock.now();
  const oneMinuteAgo = new Date(nowMs - 60 * 1000).toISOString();
  const oneHourAgo = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const principalId = await resolveActorPrincipalId(dbBinding, actorId) ??
    actorId;
  try {
    const userSpaces = await db.select({
      accountId: accounts.id,
    })
      .from(accounts)
      .where(and(
        eq(accounts.status, "active"),
        or(
          eq(accounts.ownerAccountId, principalId),
          and(
            eq(accounts.type, "user"),
            eq(accounts.id, principalId),
          ),
        ),
      ))
      .all();

    const userSpaceIds = userSpaces.map((workspace) => workspace.accountId);

    if (userSpaceIds.length === 0) {
      return { allowed: true };
    }

    const minuteResult = await db.select({ count: count() }).from(runs)
      .where(and(
        inArray(runs.accountId, userSpaceIds),
        parentCondition,
        gt(runs.createdAt, oneMinuteAgo),
      ))
      .get();
    const minuteCount = minuteResult?.count ?? 0;

    if (minuteCount >= rateLimit.maxRunsPerMinute) {
      return {
        allowed: false,
        reason: kind === "child"
          ? `Child run rate limit exceeded: max ${rateLimit.maxRunsPerMinute} child runs per minute`
          : `Rate limit exceeded: max ${rateLimit.maxRunsPerMinute} runs per minute`,
      };
    }

    const hourResult = await db.select({ count: count() }).from(runs)
      .where(and(
        inArray(runs.accountId, userSpaceIds),
        parentCondition,
        gt(runs.createdAt, oneHourAgo),
      ))
      .get();
    const hourCount = hourResult?.count ?? 0;

    if (hourCount >= rateLimit.maxRunsPerHour) {
      return {
        allowed: false,
        reason: kind === "child"
          ? `Child run rate limit exceeded: max ${rateLimit.maxRunsPerHour} child runs per hour`
          : `Rate limit exceeded: max ${rateLimit.maxRunsPerHour} runs per hour`,
      };
    }

    const concurrentResult = await db.select({ count: count() }).from(runs)
      .where(and(
        eq(runs.accountId, spaceId),
        parentCondition,
        inArray(runs.status, ["queued", "running"]),
      ))
      .get();
    const concurrentCount = concurrentResult?.count ?? 0;

    if (concurrentCount >= rateLimit.maxConcurrentRuns) {
      return {
        allowed: false,
        reason: kind === "child"
          ? `Too many concurrent child runs: max ${rateLimit.maxConcurrentRuns} per workspace`
          : `Too many concurrent runs: max ${rateLimit.maxConcurrentRuns} per workspace`,
      };
    }

    return { allowed: true };
  } catch (error) {
    if (!isInvalidArrayBufferError(error)) {
      throw error;
    }
    return checkRunRateLimitsFallback(
      dbBinding,
      principalId,
      spaceId,
      kind,
      clock,
    );
  }
}
