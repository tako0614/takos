import type {
  MessageQueueBinding,
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlTransactionSessionBinding,
} from "../../../shared/types/bindings.ts";
import { getDb, indexJobs } from "../../../infra/db/index.ts";
import {
  INDEX_QUEUE_MESSAGE_VERSION,
  type IndexJobQueueMessage,
} from "../../../shared/types/index.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

export type IndexOutboxStatementFactory =
  | Pick<SqlDatabaseBinding, "prepare">
  | Pick<SqlTransactionSessionBinding, "prepare">;

export type TerminalIndexJobType = "info_unit" | "thread_context";
export const TERMINAL_INDEX_JOB_TYPES = [
  "info_unit",
  "thread_context",
] as const satisfies readonly TerminalIndexJobType[];

export interface TerminalIndexOutboxInput {
  completionKey: string;
  createdAt: string;
  /** SQL predicate over the fixed `runs r` alias. */
  runPredicateSql: string;
  runPredicateArgs: unknown[];
}

/** Stable identity shared by transaction retries and cron delivery retries. */
export function terminalIndexJobId(
  completionKey: string,
  type: TerminalIndexJobType,
): string {
  return `index-outbox:${completionKey}:${type}`;
}

export function terminalIndexJobIds(completionKey: string): string[] {
  return TERMINAL_INDEX_JOB_TYPES.map((type) =>
    terminalIndexJobId(completionKey, type),
  );
}

/**
 * Build the two durable search-index outbox rows for a terminal Run commit.
 *
 * The caller includes these statements in the same D1 batch/Postgres
 * transaction as the terminal status. `INSERT ... SELECT` repeats the caller's
 * post-CAS predicate, so a lost lease/status race cannot leave orphan jobs.
 */
export function buildTerminalIndexOutboxStatements(
  factory: IndexOutboxStatementFactory,
  input: TerminalIndexOutboxInput,
): SqlPreparedStatementBinding[] {
  const jobs: Array<{
    type: TerminalIndexJobType;
    targetSql: 'r."id"' | 'r."thread_id"';
  }> = [
    { type: "info_unit", targetSql: 'r."id"' },
    { type: "thread_context", targetSql: 'r."thread_id"' },
  ];

  return jobs.map(({ type, targetSql }) =>
    factory
      .prepare(
        `INSERT INTO "index_jobs"
           ("id", "account_id", "type", "target_id", "status", "created_at")
         SELECT ?, r."account_id", ?, ${targetSql}, 'queued', ?
         FROM "runs" r
         WHERE ${input.runPredicateSql}
         ON CONFLICT ("id") DO NOTHING`,
      )
      .bind(
        terminalIndexJobId(input.completionKey, type),
        type,
        input.createdAt,
        ...input.runPredicateArgs,
      ),
  );
}

export interface TerminalIndexOutboxEnv {
  DB: SqlDatabaseBinding;
  INDEX_QUEUE?: MessageQueueBinding<IndexJobQueueMessage>;
}

export interface DispatchTerminalIndexOutboxOptions {
  /** Restrict an immediate post-commit flush to one terminal transaction. */
  completionKey?: string;
  /** Recover `enqueued` rows whose queue send outcome was left ambiguous. */
  staleBefore?: string;
  limit?: number;
}

type DispatchableIndexJob = {
  id: string;
  accountId: string;
  type: string;
  targetId: string | null;
  status: string;
};

function isTerminalIndexJobType(value: string): value is TerminalIndexJobType {
  return (TERMINAL_INDEX_JOB_TYPES as readonly string[]).includes(value);
}

/**
 * CAS queued outbox rows to `enqueued`, send their queue messages, and revert
 * only our exact claim on a definite send failure. A crash after the CAS is
 * recovered by a later call with `staleBefore`.
 */
export async function dispatchTerminalIndexOutbox(
  env: TerminalIndexOutboxEnv,
  options: DispatchTerminalIndexOutboxOptions = {},
): Promise<number> {
  if (!env.INDEX_QUEUE) return 0;
  const db = getDb(env.DB);
  const staleEnqueued = options.staleBefore
    ? and(
        eq(indexJobs.status, "enqueued"),
        or(
          isNull(indexJobs.startedAt),
          lt(indexJobs.startedAt, options.staleBefore),
        ),
      )
    : undefined;
  const statusPredicate = staleEnqueued
    ? or(eq(indexJobs.status, "queued"), staleEnqueued)
    : eq(indexJobs.status, "queued");
  const completionIds = options.completionKey
    ? terminalIndexJobIds(options.completionKey)
    : null;
  const predicate = and(
    inArray(indexJobs.type, [...TERMINAL_INDEX_JOB_TYPES]),
    statusPredicate,
    ...(completionIds ? [inArray(indexJobs.id, completionIds)] : []),
  );
  const jobs = (await db
    .select({
      id: indexJobs.id,
      accountId: indexJobs.accountId,
      type: indexJobs.type,
      targetId: indexJobs.targetId,
      status: indexJobs.status,
    })
    .from(indexJobs)
    .where(predicate)
    .limit(Math.max(1, Math.min(options.limit ?? 50, 100)))
    .all()) as DispatchableIndexJob[];

  let sent = 0;
  for (const job of jobs) {
    if (!job.targetId || !isTerminalIndexJobType(job.type)) {
      logWarn("Skipping malformed terminal index outbox row", {
        module: "index_outbox",
        jobId: job.id,
      });
      continue;
    }
    const claimedAt = new Date().toISOString();
    const deliveryId = crypto.randomUUID();
    const expectedStatus =
      job.status === "queued"
        ? eq(indexJobs.status, "queued")
        : options.staleBefore
          ? and(
              eq(indexJobs.status, "enqueued"),
              or(
                isNull(indexJobs.startedAt),
                lt(indexJobs.startedAt, options.staleBefore),
              ),
            )
          : null;
    if (!expectedStatus) continue;

    const claim = await db
      .update(indexJobs)
      .set({
        status: "enqueued",
        claimToken: deliveryId,
        startedAt: claimedAt,
        error: null,
      })
      .where(and(eq(indexJobs.id, job.id), expectedStatus));
    if (affectedRowCount(claim) === 0) continue;

    try {
      await env.INDEX_QUEUE.send({
        version: INDEX_QUEUE_MESSAGE_VERSION,
        jobId: job.id,
        deliveryId,
        spaceId: job.accountId,
        type: job.type,
        targetId: job.targetId,
        timestamp: Date.now(),
      });
      sent++;
    } catch (error) {
      logError("Terminal index outbox queue send failed", error, {
        module: "index_outbox",
        jobId: job.id,
      });
      try {
        await db
          .update(indexJobs)
          .set({
            status: "queued",
            claimToken: null,
            startedAt: null,
            error: String(error).slice(0, 2048),
          })
          .where(
            and(
              eq(indexJobs.id, job.id),
              eq(indexJobs.status, "enqueued"),
              eq(indexJobs.claimToken, deliveryId),
              eq(indexJobs.startedAt, claimedAt),
            ),
          );
      } catch (revertError) {
        logError("Terminal index outbox claim revert failed", revertError, {
          module: "index_outbox",
          jobId: job.id,
        });
      }
    }
  }
  return sent;
}
