import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Run } from '../../../shared/types/index.ts';
import { getDb, runs, accountMemberships, accounts } from '../../../infra/db/index.ts';
import { eq, and, gt, inArray, count, isNull, isNotNull } from 'drizzle-orm';
import { resolveActorPrincipalId } from '../identity/principals.ts';
import { isInvalidArrayBufferError } from '../../../shared/utils/db-guards.ts';
import {
  asRunRow,
  runRowToApi,
  type D1CountRow,
  type RunHierarchyNode,
  type SpaceModelLookup,
} from './run-serialization.ts';
import { logError, logWarn } from '../../../shared/utils/logger.ts';

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
  input: string;
  createdAt: string;
};

type UpdateRunStatusParams = {
  runId: string;
  status: 'queued' | 'failed';
  error: string | null;
};

export type RunRateLimitResult = {
  allowed: boolean;
  reason?: string;
};

type RunRateLimitKind = 'top_level' | 'child';

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

    logWarn(`Falling back to D1 for ${description} after invalid array buffer error`, { module: 'services/runs/create-thread-run-store' });
    return fallbackOp();
  }
}

function readCount(row: D1CountRow | null | undefined): number {
  const parsed = Number(row?.count ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function checkRunRateLimitsFallback(
  db: D1Database,
  actorId: string,
  spaceId: string,
  kind: RunRateLimitKind,
): Promise<RunRateLimitResult> {
  try {
    const rateLimit = kind === 'child' ? CHILD_RUN_RATE_LIMIT : TOP_LEVEL_RUN_RATE_LIMIT;
    const parentPredicate = kind === 'child' ? 'IS NOT NULL' : 'IS NULL';
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const minuteCount = readCount(await db.prepare(`
      SELECT COUNT(*) AS count
      FROM runs
      WHERE account_id IN (
        SELECT account_id
        FROM account_memberships
        WHERE member_id = ?
      )
      AND parent_run_id ${parentPredicate}
      AND created_at > ?
    `).bind(actorId, oneMinuteAgo).first<D1CountRow>());

    if (minuteCount >= rateLimit.maxRunsPerMinute) {
      return {
        allowed: false,
        reason: kind === 'child'
          ? `Child run rate limit exceeded: max ${rateLimit.maxRunsPerMinute} child runs per minute`
          : `Rate limit exceeded: max ${rateLimit.maxRunsPerMinute} runs per minute`,
      };
    }

    const hourCount = readCount(await db.prepare(`
      SELECT COUNT(*) AS count
      FROM runs
      WHERE account_id IN (
        SELECT account_id
        FROM account_memberships
        WHERE member_id = ?
      )
      AND parent_run_id ${parentPredicate}
      AND created_at > ?
    `).bind(actorId, oneHourAgo).first<D1CountRow>());

    if (hourCount >= rateLimit.maxRunsPerHour) {
      return {
        allowed: false,
        reason: kind === 'child'
          ? `Child run rate limit exceeded: max ${rateLimit.maxRunsPerHour} child runs per hour`
          : `Rate limit exceeded: max ${rateLimit.maxRunsPerHour} runs per hour`,
      };
    }

    const concurrentCount = readCount(await db.prepare(`
      SELECT COUNT(*) AS count
      FROM runs
      WHERE account_id = ?
      AND parent_run_id ${parentPredicate}
      AND status IN ('queued', 'running')
    `).bind(spaceId).first<D1CountRow>());

    if (concurrentCount >= rateLimit.maxConcurrentRuns) {
      return {
        allowed: false,
        reason: kind === 'child'
          ? `Too many concurrent child runs: max ${rateLimit.maxConcurrentRuns} per workspace`
          : `Too many concurrent runs: max ${rateLimit.maxConcurrentRuns} per workspace`,
      };
    }

    return { allowed: true };
  } catch (fallbackError) {
    logError('Failed D1 fallback run rate limit lookup after error', fallbackError, { module: 'services/runs/create-thread-run-store' });
    return { allowed: true };
  }
}

async function getRunHierarchyNodeFallback(
  db: D1Database,
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
  dbBinding: D1Database,
  runId: string,
): Promise<RunHierarchyNode | null> {
  const db = getDb(dbBinding);
  return withDrizzleInvalidArrayBufferFallback(
    'parent run lookup',
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
  db: D1Database,
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
  dbBinding: D1Database,
  spaceId: string,
): Promise<SpaceModelLookup | null> {
  const db = getDb(dbBinding);
  return withDrizzleInvalidArrayBufferFallback(
    'space model lookup',
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
  db: D1Database,
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
      status,
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
  dbBinding: D1Database,
  runId: string,
): Promise<Run | null> {
  const db = getDb(dbBinding);
  return withDrizzleInvalidArrayBufferFallback(
    'run readback lookup',
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

async function createPendingRunFallback(
  db: D1Database,
  params: CreatePendingRunParams,
): Promise<void> {
  await db.prepare(`
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
      status,
      input,
      usage,
      created_at
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'pending', ?, '{}', ?)
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
    params.input,
    params.createdAt,
  ).run();
}

export async function createPendingRun(
  dbBinding: D1Database,
  params: CreatePendingRunParams,
): Promise<void> {
  const db = getDb(dbBinding);
  return withDrizzleInvalidArrayBufferFallback(
    'run create',
    async () => {
      await db.insert(runs).values({
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
        status: 'pending',
        input: params.input,
        usage: '{}',
        createdAt: params.createdAt,
      });
    },
    () => createPendingRunFallback(dbBinding, params),
  );
}

async function updateRunStatusFallback(
  db: D1Database,
  params: UpdateRunStatusParams,
): Promise<void> {
  await db.prepare(`
    UPDATE runs
    SET status = ?, error = ?
    WHERE id = ?
  `).bind(params.status, params.error, params.runId).run();
}

export async function updateRunStatus(
  dbBinding: D1Database,
  params: UpdateRunStatusParams,
): Promise<void> {
  const db = getDb(dbBinding);
  return withDrizzleInvalidArrayBufferFallback(
    'run status update',
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
  dbBinding: D1Database,
  actorId: string,
  spaceId: string,
  options?: {
    isChildRun?: boolean;
  },
): Promise<RunRateLimitResult> {
  const db = getDb(dbBinding);
  const kind: RunRateLimitKind = options?.isChildRun ? 'child' : 'top_level';
  const rateLimit = kind === 'child' ? CHILD_RUN_RATE_LIMIT : TOP_LEVEL_RUN_RATE_LIMIT;
  const parentCondition = kind === 'child' ? isNotNull(runs.parentRunId) : isNull(runs.parentRunId);
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  try {
    let userSpaces = await db.select({ accountId: accountMemberships.accountId })
      .from(accountMemberships)
      .where(eq(accountMemberships.memberId, actorId))
      .all();

    if (userSpaces.length === 0) {
      const principalId = await resolveActorPrincipalId(dbBinding, actorId);
      if (principalId && principalId !== actorId) {
        userSpaces = await db.select({ accountId: accountMemberships.accountId })
          .from(accountMemberships)
          .where(eq(accountMemberships.memberId, principalId))
          .all();
      }
    }

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
        reason: kind === 'child'
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
        reason: kind === 'child'
          ? `Child run rate limit exceeded: max ${rateLimit.maxRunsPerHour} child runs per hour`
          : `Rate limit exceeded: max ${rateLimit.maxRunsPerHour} runs per hour`,
      };
    }

    const concurrentResult = await db.select({ count: count() }).from(runs)
      .where(and(
        eq(runs.accountId, spaceId),
        parentCondition,
        inArray(runs.status, ['queued', 'running']),
      ))
      .get();
    const concurrentCount = concurrentResult?.count ?? 0;

    if (concurrentCount >= rateLimit.maxConcurrentRuns) {
      return {
        allowed: false,
        reason: kind === 'child'
          ? `Too many concurrent child runs: max ${rateLimit.maxConcurrentRuns} per workspace`
          : `Too many concurrent runs: max ${rateLimit.maxConcurrentRuns} per workspace`,
      };
    }

    return { allowed: true };
  } catch (error) {
    if (!isInvalidArrayBufferError(error)) {
      throw error;
    }
    return checkRunRateLimitsFallback(dbBinding, actorId, spaceId, kind);
  }
}
