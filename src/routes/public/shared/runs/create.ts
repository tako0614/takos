import { generateId } from "@takos/worker-platform-utils/id";
import {
  type DurableNamespaceBinding,
  type MessageQueueBinding,
  type Run,
  RUN_QUEUE_MESSAGE_VERSION,
  type RunQueueMessage,
  type SqlDatabaseBinding,
} from "takos-api-contract/shared/types";
import { asRunRow, runRowToApi } from "takos-api-contract/shared/types/runs";
import { readThreadAccess } from "../threads/read-model.ts";

export type CreateRunEnv = {
  DB: SqlDatabaseBinding;
  RUN_QUEUE?: MessageQueueBinding<RunQueueMessage>;
  RUN_NOTIFIER?: DurableNamespaceBinding;
};

export type CreateRunInput = {
  agent_type?: string;
  input?: Record<string, unknown>;
  parent_run_id?: string;
  model?: string;
};

export type CreateRunResult = {
  run: Run;
};

export class RunQueueUnavailableError extends Error {
  constructor() {
    super("run queue is not configured");
  }
}

export class RunCreateFailedError extends Error {}

export class RunCreateInputError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class RunRateLimitError extends Error {
  constructor(message: string) {
    super(message);
  }
}

type RunHierarchyNode = {
  id: string;
  threadId: string;
  accountId: string;
  parentRunId: string | null;
  rootThreadId: string | null;
  rootRunId: string | null;
};

type RateLimit = {
  maxRunsPerMinute: number;
  maxRunsPerHour: number;
  maxConcurrentRuns: number;
};

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_RUN_NESTING_DEPTH = 5;
const DEFAULT_MODEL_ID = "gpt-5.5";
const SUPPORTED_MODEL_IDS = new Set([
  "gpt-5.5",
]);
const TOP_LEVEL_RUN_RATE_LIMIT: RateLimit = {
  maxRunsPerMinute: 30,
  maxRunsPerHour: 500,
  maxConcurrentRuns: 20,
};
const CHILD_RUN_RATE_LIMIT: RateLimit = {
  maxRunsPerMinute: 20,
  maxRunsPerHour: 250,
  maxConcurrentRuns: 12,
};

export async function createThreadRun(
  env: CreateRunEnv,
  threadId: string,
  actorAccountId: string,
  input: CreateRunInput,
): Promise<CreateRunResult | null> {
  if (!env.RUN_QUEUE) throw new RunQueueUnavailableError();

  const access = await readThreadAccess(env.DB, threadId, actorAccountId, [
    "owner",
    "admin",
    "editor",
  ]);
  if (!access) return null;

  const isChildRun = Boolean(input.parent_run_id);
  const rateLimitCheck = await checkRunRateLimits(
    env.DB,
    actorAccountId,
    access.thread.space_id,
    isChildRun,
  );
  if (!rateLimitCheck.allowed) {
    throw new RunRateLimitError(rateLimitCheck.reason ?? "Rate limit exceeded");
  }

  let parentRun: RunHierarchyNode | null = null;
  if (input.parent_run_id) {
    if (!isValidOpaqueId(input.parent_run_id)) {
      throw new RunCreateInputError("Invalid parent_run_id");
    }
    const parentValidationError = await validateParentRunId(
      env.DB,
      access.thread.space_id,
      input.parent_run_id,
    );
    if (parentValidationError) {
      throw new RunCreateInputError(parentValidationError);
    }
    parentRun = await getRunHierarchyNode(env.DB, input.parent_run_id);
    if (!parentRun) {
      throw new RunCreateInputError("Invalid parent_run_id: run not found");
    }
  }

  const runId = generateId();
  const validatedModel = await resolveRunModel(
    env.DB,
    access.thread.space_id,
    input.model,
  );
  const createdAt = new Date().toISOString();
  const rootThreadId = parentRun?.rootThreadId ?? parentRun?.threadId ??
    threadId;
  const rootRunId = parentRun?.rootRunId ?? parentRun?.id ?? runId;
  const childThreadId = parentRun && parentRun.threadId !== threadId
    ? threadId
    : null;

  await createPendingRun(env.DB, {
    runId,
    threadId,
    spaceId: access.thread.space_id,
    requesterAccountId: actorAccountId,
    parentRunId: input.parent_run_id ?? null,
    childThreadId,
    rootThreadId,
    rootRunId,
    agentType: input.agent_type || "default",
    input: JSON.stringify(input.input || {}),
    createdAt,
  });

  try {
    await updateRunStatus(env.DB, runId, "queued", null);
    await env.RUN_QUEUE.send({
      version: RUN_QUEUE_MESSAGE_VERSION,
      runId,
      timestamp: Date.now(),
      model: validatedModel,
    });
  } catch {
    await updateRunStatus(
      env.DB,
      runId,
      "failed",
      "Failed to enqueue run for execution",
    );
    await persistAndEmitRunFailed(env, runId);
    throw new RunCreateFailedError("Failed to queue run");
  }

  const run = await readRunResponse(env.DB, runId);
  if (!run) throw new RunCreateFailedError("Failed to create run");
  return { run };
}

async function checkRunRateLimits(
  db: SqlDatabaseBinding,
  actorAccountId: string,
  spaceId: string,
  isChildRun: boolean,
): Promise<{ allowed: boolean; reason?: string }> {
  const rateLimit = isChildRun
    ? CHILD_RUN_RATE_LIMIT
    : TOP_LEVEL_RUN_RATE_LIMIT;
  const parentPredicate = isChildRun ? "IS NOT NULL" : "IS NULL";
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const minuteCount = await countRuns(
    db,
    `
      account_id IN (
        SELECT account_id
        FROM account_memberships
        WHERE member_id = ?
      )
      AND parent_run_id ${parentPredicate}
      AND created_at > ?
    `,
    [actorAccountId, oneMinuteAgo],
  );
  if (minuteCount >= rateLimit.maxRunsPerMinute) {
    return {
      allowed: false,
      reason: isChildRun
        ? `Child run rate limit exceeded: max ${rateLimit.maxRunsPerMinute} child runs per minute`
        : `Rate limit exceeded: max ${rateLimit.maxRunsPerMinute} runs per minute`,
    };
  }

  const hourCount = await countRuns(
    db,
    `
      account_id IN (
        SELECT account_id
        FROM account_memberships
        WHERE member_id = ?
      )
      AND parent_run_id ${parentPredicate}
      AND created_at > ?
    `,
    [actorAccountId, oneHourAgo],
  );
  if (hourCount >= rateLimit.maxRunsPerHour) {
    return {
      allowed: false,
      reason: isChildRun
        ? `Child run rate limit exceeded: max ${rateLimit.maxRunsPerHour} child runs per hour`
        : `Rate limit exceeded: max ${rateLimit.maxRunsPerHour} runs per hour`,
    };
  }

  const concurrentCount = await countRuns(
    db,
    `
      account_id = ?
      AND parent_run_id ${parentPredicate}
      AND status IN ('queued', 'running')
    `,
    [spaceId],
  );
  if (concurrentCount >= rateLimit.maxConcurrentRuns) {
    return {
      allowed: false,
      reason: isChildRun
        ? `Too many concurrent child runs: max ${rateLimit.maxConcurrentRuns} per workspace`
        : `Too many concurrent runs: max ${rateLimit.maxConcurrentRuns} per workspace`,
    };
  }

  return { allowed: true };
}

async function countRuns(
  db: SqlDatabaseBinding,
  whereSql: string,
  bindings: unknown[],
): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM runs
    WHERE ${whereSql}
  `).bind(...bindings).first<Record<string, unknown>>();
  const count = row?.count;
  if (typeof count === "number") return count;
  if (typeof count === "string") {
    const parsed = Number(count);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function validateParentRunId(
  db: SqlDatabaseBinding,
  spaceId: string,
  parentRunId: string,
): Promise<string | null> {
  const parent = await getRunHierarchyNode(db, parentRunId);
  if (!parent) return "Invalid parent_run_id: run not found";
  if (parent.accountId !== spaceId) {
    return "Invalid parent_run_id: parent run must be in the same workspace";
  }

  const seen = new Set<string>([parent.id]);
  let parentDepth = 1;
  let cursor = parent;
  while (cursor.parentRunId) {
    parentDepth++;
    if (parentDepth > MAX_RUN_NESTING_DEPTH) break;
    if (!isValidOpaqueId(cursor.parentRunId)) {
      return "Invalid parent_run_id: run hierarchy is broken";
    }
    if (seen.has(cursor.parentRunId)) {
      return "Invalid parent_run_id: run hierarchy cycle detected";
    }
    seen.add(cursor.parentRunId);

    const next = await getRunHierarchyNode(db, cursor.parentRunId);
    if (!next) return "Invalid parent_run_id: run hierarchy is broken";
    if (next.accountId !== spaceId) {
      return "Invalid parent_run_id: run hierarchy crosses workspaces";
    }
    cursor = next;
  }

  return parentDepth + 1 > MAX_RUN_NESTING_DEPTH
    ? `Run nesting depth exceeded (max: ${MAX_RUN_NESTING_DEPTH})`
    : null;
}

async function getRunHierarchyNode(
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
  `).bind(runId).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: stringField(row, "id"),
    threadId: stringField(row, "threadId"),
    accountId: stringField(row, "accountId"),
    parentRunId: nullableStringField(row, "parentRunId"),
    rootThreadId: nullableStringField(row, "rootThreadId"),
    rootRunId: nullableStringField(row, "rootRunId"),
  };
}

async function resolveRunModel(
  db: SqlDatabaseBinding,
  spaceId: string,
  requestedModel: string | undefined,
): Promise<string> {
  const row = await db.prepare(`
    SELECT ai_model AS aiModel
    FROM accounts
    WHERE id = ?
    LIMIT 1
  `).bind(spaceId).first<Record<string, unknown>>();
  const spaceModel = typeof row?.aiModel === "string" ? row.aiModel : undefined;
  return normalizeModelId(requestedModel || spaceModel) ?? DEFAULT_MODEL_ID;
}

function normalizeModelId(model: string | undefined): string | null {
  const normalized = model?.toLowerCase().trim();
  return normalized && SUPPORTED_MODEL_IDS.has(normalized) ? normalized : null;
}

async function createPendingRun(
  db: SqlDatabaseBinding,
  params: {
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
  },
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
    ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'pending', ?, '{}', ?)
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

async function updateRunStatus(
  db: SqlDatabaseBinding,
  runId: string,
  status: "queued" | "failed",
  error: string | null,
): Promise<void> {
  await db.prepare(`
    UPDATE runs
    SET status = ?, error = ?
    WHERE id = ?
  `).bind(status, error, runId).run();
}

async function readRunResponse(
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

async function persistAndEmitRunFailed(
  env: CreateRunEnv,
  runId: string,
): Promise<void> {
  const payload = {
    status: "failed",
    run: { id: runId, session_id: null },
    error: "Failed to enqueue run for execution",
  };
  const eventId = await persistRunEvent(env.DB, runId, "run.failed", payload);
  await emitRunEvent(env.RUN_NOTIFIER, runId, "run.failed", payload, eventId);
}

async function persistRunEvent(
  db: SqlDatabaseBinding,
  runId: string,
  type: string,
  data: unknown,
): Promise<number> {
  const row = await db.prepare(`
    INSERT INTO run_events (
      run_id,
      type,
      data,
      created_at
    )
    VALUES (?, ?, ?, ?)
    RETURNING id
  `).bind(
    runId,
    type,
    JSON.stringify(data),
    new Date().toISOString(),
  ).first<Record<string, unknown>>();
  return typeof row?.id === "number" ? row.id : 0;
}

async function emitRunEvent(
  namespace: DurableNamespaceBinding | undefined,
  runId: string,
  type: string,
  data: unknown,
  eventId: number,
): Promise<void> {
  if (!namespace) return;
  try {
    const id = namespace.idFromName(runId);
    const stub = namespace.get(id);
    await stub.fetch(
      new Request("https://internal.do/emit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Takos-Internal-Marker": "1",
        },
        body: JSON.stringify({
          runId,
          type,
          data,
          ...(eventId ? { event_id: eventId } : {}),
        }),
      }),
    );
  } catch {
    // The run event row is durable; notifier delivery is best effort.
  }
}

function isValidOpaqueId(value: string): boolean {
  const normalized = value.trim();
  return Boolean(normalized) && OPAQUE_ID_PATTERN.test(normalized);
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new TypeError(`Run row field ${key} must be a string`);
}

function nullableStringField(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === "string") return value;
  throw new TypeError(`Run row field ${key} must be a string or null`);
}
