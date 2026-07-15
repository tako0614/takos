import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { getDb, runNotificationOutbox } from "../../../infra/db/index.ts";
import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlTransactionSessionBinding,
} from "../../../shared/types/bindings.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import {
  createRunTerminalNotification,
  type RunTerminalNotificationStatus,
} from "./run-terminal.ts";
import type { NotificationServiceEnv } from "./service.ts";

export type RunNotificationOutboxStatementFactory =
  | Pick<SqlDatabaseBinding, "prepare">
  | Pick<SqlTransactionSessionBinding, "prepare">;

export interface RunNotificationOutboxInput {
  completionKey: string;
  runStatus: RunTerminalNotificationStatus;
  createdAt: string;
  /** SQL predicate over the fixed `runs r` alias. */
  runPredicateSql: string;
  runPredicateArgs: unknown[];
}

/** Stable identity shared by transaction and dispatcher retries. */
export function runNotificationOutboxId(completionKey: string): string {
  return `run-notification-outbox:${completionKey}`;
}

/**
 * Build a user-notification outbox row inside the terminal Run transaction.
 *
 * The repeated post-CAS predicate prevents a losing lease/status transition
 * from creating a notification. Runs without a requesting user deliberately
 * do not create an outbox row.
 */
export function buildRunNotificationOutboxStatements(
  factory: RunNotificationOutboxStatementFactory,
  input: RunNotificationOutboxInput,
): SqlPreparedStatementBinding[] {
  return [
    factory
      .prepare(
        `INSERT INTO "run_notification_outbox"
           ("id", "run_id", "completion_key", "run_status",
            "delivery_status", "attempts", "created_at", "updated_at")
         SELECT ?, r."id", ?, ?, 'queued', 0, ?, ?
         FROM "runs" r
         WHERE ${input.runPredicateSql}
           AND r."requester_account_id" IS NOT NULL
         ON CONFLICT ("completion_key") DO NOTHING`,
      )
      .bind(
        runNotificationOutboxId(input.completionKey),
        input.completionKey,
        input.runStatus,
        input.createdAt,
        input.createdAt,
        ...input.runPredicateArgs,
      ),
  ];
}

export interface DispatchRunNotificationOutboxOptions {
  /** Restrict an immediate post-commit flush to one terminal transaction. */
  completionKey?: string;
  /** Recover a dispatch claim whose process died before completion. */
  staleBefore?: string;
  limit?: number;
}

type DispatchableRunNotification = {
  id: string;
  runId: string;
  completionKey: string;
  runStatus: string;
  deliveryStatus: string;
};

function isRunTerminalNotificationStatus(
  value: string,
): value is RunTerminalNotificationStatus {
  return value === "completed" || value === "failed";
}

/**
 * Claim durable terminal-notification rows and complete the inbox/push handoff.
 *
 * Notification insertion is idempotent by completion-derived id. A row is
 * marked done only after push is unnecessary, synchronously terminal, or the
 * notification Queue has accepted the event. Definite failures return the
 * exact claim to `queued`; cron recovers crash-left `dispatching` claims.
 */
export async function dispatchRunNotificationOutbox(
  env: NotificationServiceEnv,
  options: DispatchRunNotificationOutboxOptions = {},
): Promise<number> {
  const db = getDb(env.DB);
  const staleDispatch = options.staleBefore
    ? and(
        eq(runNotificationOutbox.deliveryStatus, "dispatching"),
        or(
          isNull(runNotificationOutbox.claimedAt),
          lt(runNotificationOutbox.claimedAt, options.staleBefore),
        ),
      )
    : undefined;
  const statusPredicate = staleDispatch
    ? or(eq(runNotificationOutbox.deliveryStatus, "queued"), staleDispatch)
    : eq(runNotificationOutbox.deliveryStatus, "queued");
  const rows = (await db
    .select({
      id: runNotificationOutbox.id,
      runId: runNotificationOutbox.runId,
      completionKey: runNotificationOutbox.completionKey,
      runStatus: runNotificationOutbox.runStatus,
      deliveryStatus: runNotificationOutbox.deliveryStatus,
    })
    .from(runNotificationOutbox)
    .where(
      and(
        statusPredicate,
        inArray(runNotificationOutbox.runStatus, ["completed", "failed"]),
        ...(options.completionKey
          ? [eq(runNotificationOutbox.completionKey, options.completionKey)]
          : []),
      ),
    )
    .limit(Math.max(1, Math.min(options.limit ?? 50, 100)))
    .all()) as DispatchableRunNotification[];

  let completed = 0;
  for (const row of rows) {
    if (!isRunTerminalNotificationStatus(row.runStatus)) {
      logWarn("Skipping malformed Run notification outbox row", {
        module: "run_notification_outbox",
        outboxId: row.id,
      });
      continue;
    }

    const claimedAt = new Date().toISOString();
    const claimToken = crypto.randomUUID();
    const expectedStatus =
      row.deliveryStatus === "queued"
        ? eq(runNotificationOutbox.deliveryStatus, "queued")
        : options.staleBefore
          ? and(
              eq(runNotificationOutbox.deliveryStatus, "dispatching"),
              or(
                isNull(runNotificationOutbox.claimedAt),
                lt(runNotificationOutbox.claimedAt, options.staleBefore),
              ),
            )
          : null;
    if (!expectedStatus) continue;

    const claim = await db
      .update(runNotificationOutbox)
      .set({
        deliveryStatus: "dispatching",
        claimToken,
        claimedAt,
        attempts: sql`${runNotificationOutbox.attempts} + 1`,
        lastError: null,
        updatedAt: claimedAt,
      })
      .where(and(eq(runNotificationOutbox.id, row.id), expectedStatus));
    if (affectedRowCount(claim) === 0) continue;

    try {
      const result = await createRunTerminalNotification(env, {
        runId: row.runId,
        status: row.runStatus,
        completionKey: row.completionKey,
      });
      if (
        result.push_handoff === "failed" ||
        result.push_handoff === "deferred"
      ) {
        throw new Error(`notification push handoff ${result.push_handoff}`);
      }
      const doneAt = new Date().toISOString();
      const done = await db
        .update(runNotificationOutbox)
        .set({
          deliveryStatus: "done",
          claimToken: null,
          claimedAt: null,
          lastError: null,
          updatedAt: doneAt,
        })
        .where(
          and(
            eq(runNotificationOutbox.id, row.id),
            eq(runNotificationOutbox.deliveryStatus, "dispatching"),
            eq(runNotificationOutbox.claimToken, claimToken),
            eq(runNotificationOutbox.claimedAt, claimedAt),
          ),
        );
      if (affectedRowCount(done) > 0) completed += 1;
    } catch (error) {
      logError("Run notification outbox delivery failed", error, {
        module: "run_notification_outbox",
        outboxId: row.id,
        runId: row.runId,
      });
      try {
        await db
          .update(runNotificationOutbox)
          .set({
            deliveryStatus: "queued",
            claimToken: null,
            claimedAt: null,
            lastError: String(error).slice(0, 2048),
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(runNotificationOutbox.id, row.id),
              eq(runNotificationOutbox.deliveryStatus, "dispatching"),
              eq(runNotificationOutbox.claimToken, claimToken),
              eq(runNotificationOutbox.claimedAt, claimedAt),
            ),
          );
      } catch (revertError) {
        logError("Run notification outbox claim revert failed", revertError, {
          module: "run_notification_outbox",
          outboxId: row.id,
        });
      }
    }
  }
  return completed;
}
