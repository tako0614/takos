// Indexer handler implementations.
// Called by the queue dispatcher in index.ts.
import type { IndexJobQueueMessage } from "../../shared/types/index.ts";
import {
  INDEX_QUEUE_MESSAGE_VERSION,
  indexJobDeliveryId,
  isValidIndexJobQueueMessage,
} from "../../shared/types/index.ts";
import type {
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlTransactionSessionBinding,
} from "../../shared/types/bindings.ts";
import type { IndexerEnv as Env } from "../../shared/types/index.ts";
import { accounts, getDb } from "../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import { createEmbeddingsService } from "../../application/services/execution/embeddings.ts";
import { createInfoUnitIndexer } from "../../application/services/source/info-units.ts";
import { indexThreadContext } from "../../application/services/agent/index.ts";
import { buildMemoryPaths } from "../../application/services/memory-graph/path-builder.ts";
import { recordAppUsage } from "../../application/services/app-usage/usage-recorder.ts";
import { generateId } from "../../shared/utils/index.ts";
import { logError, logInfo, logWarn } from "../../shared/utils/logger.ts";
import {
  INDEX_JOB_CLAIM_STALE_MS,
  indexClaimRetryDelaySeconds,
} from "./index-policy.ts";

const TAG = "[INDEX_QUEUE]";

export type IndexHandlerOutcome =
  | { processed: true }
  | { processed: false; reason: string; retryable: boolean };

const PROCESSED: IndexHandlerOutcome = { processed: true };

export async function handleVectorize(
  env: Env,
  jobId: string,
  spaceId: string,
  _targetId?: string,
): Promise<IndexHandlerOutcome> {
  const embeddingsService = createEmbeddingsService(env);
  if (!embeddingsService) {
    logWarn(`${TAG} Embeddings service not available for job ${jobId}`, {
      module: "indexer",
    });
    return {
      processed: false,
      reason: "embeddings_service_unavailable",
      retryable: false,
    };
  }

  const indexResult = await embeddingsService.indexWorkspace(
    spaceId,
    env.TENANT_SOURCE,
    {
      forceReindex: false,
    },
  );

  if (indexResult.chunks > 0) {
    try {
      const workspace = await getDb(env.DB)
        .select({
          ownerAccountId: accounts.ownerAccountId,
        })
        .from(accounts)
        .where(eq(accounts.id, spaceId))
        .get();
      if (workspace) {
        await recordAppUsage(env.DB, {
          ownerAccountId: workspace.ownerAccountId || spaceId,
          spaceId,
          meterType: "embedding_count",
          units: indexResult.chunks,
          referenceId: jobId,
          referenceType: "index_job",
        });
      }
    } catch (usageErr) {
      logError(`${TAG} Usage recording failed for job ${jobId}`, usageErr, {
        module: "indexer",
      });
    }
  }
  return PROCESSED;
}

export async function handleInfoUnit(
  env: Env,
  jobId: string,
  spaceId: string,
  targetId?: string,
): Promise<IndexHandlerOutcome> {
  const indexer = createInfoUnitIndexer(env);
  if (!indexer) {
    logWarn(`${TAG} Info unit indexer not available for job ${jobId}`, {
      module: "indexer",
    });
    return {
      processed: false,
      reason: "info_unit_indexer_unavailable",
      retryable: false,
    };
  }
  if (!targetId) {
    logWarn(`${TAG} Missing runId for info_unit job ${jobId}`, {
      module: "indexer",
    });
    return {
      processed: false,
      reason: "missing_info_unit_run_id",
      retryable: false,
    };
  }
  await indexer.indexRun(spaceId, targetId);
  return PROCESSED;
}

export async function handleThreadContext(
  env: Env,
  jobId: string,
  spaceId: string,
  targetId?: string,
): Promise<IndexHandlerOutcome> {
  if (!targetId) {
    logWarn(`${TAG} Missing threadId for thread_context job ${jobId}`, {
      module: "indexer",
    });
    return {
      processed: false,
      reason: "missing_thread_context_thread_id",
      retryable: false,
    };
  }

  const result = await indexThreadContext({ env, spaceId, threadId: targetId });

  if (result.hasMore && !env.INDEX_QUEUE) {
    return {
      processed: false,
      reason: "thread_context_queue_unavailable",
      retryable: false,
    };
  }
  if (result.hasMore && env.INDEX_QUEUE) {
    try {
      const followUpJobId = generateId();
      await env.INDEX_QUEUE.send({
        version: INDEX_QUEUE_MESSAGE_VERSION,
        jobId: followUpJobId,
        deliveryId: indexJobDeliveryId(followUpJobId),
        spaceId,
        type: "thread_context",
        targetId,
        timestamp: Date.now(),
      });
      logInfo(
        `${TAG} Thread context follow-up job ${followUpJobId} enqueued for thread ${targetId}`,
        { module: "indexer" },
      );
    } catch (enqueueErr) {
      logWarn(
        `${TAG} Failed to enqueue follow-up thread_context job for thread ${targetId}`,
        { module: "indexer", detail: enqueueErr },
      );
      return {
        processed: false,
        reason: "thread_context_followup_enqueue_failed",
        retryable: true,
      };
    }
  }
  return PROCESSED;
}

export async function handleRepoCodeIndex(
  env: Env,
  jobId: string,
  body: IndexJobQueueMessage,
  targetId?: string,
): Promise<IndexHandlerOutcome> {
  const { repoId } = body;
  if (!repoId || !targetId) {
    logWarn(`${TAG} Missing repoId/targetId for repo_code_index job ${jobId}`, {
      module: "indexer",
    });
    return {
      processed: false,
      reason: "missing_repo_code_index_target",
      retryable: false,
    };
  }

  const embeddingsService = createEmbeddingsService(env);
  if (!embeddingsService || !env.GIT_OBJECTS) {
    logWarn(
      `${TAG} Embeddings/GIT_OBJECTS not available for repo_code_index job ${jobId}`,
      { module: "indexer" },
    );
    return {
      processed: false,
      reason: "repo_code_indexer_unavailable",
      retryable: false,
    };
  }

  const result = await embeddingsService.indexRepoFiles(
    repoId,
    env.GIT_OBJECTS,
    targetId,
  );
  logInfo(
    `${TAG} Repo code index job ${jobId}: indexed=${result.indexed}, chunks=${result.chunks}, errors=${result.errors.length}`,
    { module: "indexer" },
  );
  return PROCESSED;
}

/**
 * Memory graph path build job (`memory_build_paths`).
 *
 * Compatibility consumer for already-queued jobs from the retired implicit
 * memory-graph writer. Current agents use explicit `remember` / `recall` and do
 * not enqueue this job; legacy schema/data remain readable until migration.
 */
export async function handleMemoryBuildPaths(
  env: Env,
  jobId: string,
  spaceId: string,
  targetId?: string,
): Promise<IndexHandlerOutcome> {
  const result = await buildMemoryPaths(env.DB, {
    accountId: spaceId,
    sourceRunId: targetId,
  });

  logInfo(
    `${TAG} memory_build_paths job ${jobId} materialized ${result.insertedPathCount} paths`,
    {
      module: "indexer",
      detail: { spaceId, targetId, ...result },
    },
  );
  return PROCESSED;
}

export async function handleIndexJobDlq(
  body: unknown,
  env: { DB: SqlDatabaseBinding },
  attempts?: number,
  queueName = "takos-index-jobs-dlq",
  transportMessageId?: string,
): Promise<{ action: "ack" } | { action: "retry"; delaySeconds: number }> {
  const now = new Date().toISOString();
  const messageBody = JSON.stringify(body);
  const terminalError = `Max retries exceeded${
    attempts === undefined ? "" : ` after ${attempts} attempts`
  }`;
  const staleBefore = new Date(
    Date.now() - INDEX_JOB_CLAIM_STALE_MS,
  ).toISOString();
  const validBody = isValidIndexJobQueueMessage(body) ? body : null;
  const logicalDeliveryId = validBody?.deliveryId ?? transportMessageId ?? null;
  if (validBody) {
    const existing = await env.DB
      .prepare(
        `SELECT "status", "claim_token" AS "claimToken", "started_at" AS "startedAt"
         FROM "index_jobs"
         WHERE "id" = ? AND "account_id" = ? AND "type" = ?`,
      )
      .bind(validBody.jobId, validBody.spaceId, validBody.type)
      .first<{
        status: string;
        claimToken: string | null;
        startedAt: string | null;
      }>();
    if (existing?.status === "running") {
      if (logicalDeliveryId && existing.claimToken === logicalDeliveryId) {
        const startedAtMs = existing.startedAt
          ? Date.parse(existing.startedAt)
          : Number.NaN;
        const fresh =
          Number.isFinite(startedAtMs) &&
          startedAtMs >= Date.now() - INDEX_JOB_CLAIM_STALE_MS;
        if (fresh) {
          // The primary delivery can reach its DLQ while the original handler
          // still owns a long-running claim. Keep the DLQ message alive until
          // that exact claim is either completed or old enough to recover.
          return {
            action: "retry",
            delaySeconds: indexClaimRetryDelaySeconds(existing.startedAt!),
          };
        }
      }
    }
  }

  const dlqEntry = {
    level: "CRITICAL",
    event: "INDEX_JOB_DLQ_ENTRY",
    queue: queueName,
    timestamp: now,
    retryCount: attempts ?? null,
    body: messageBody,
  };
  logError(`${TAG} CRITICAL: ${JSON.stringify(dlqEntry)}`, undefined, {
    module: "indexer",
  });

  try {
    const buildStatements = (
      factory:
        | Pick<SqlDatabaseBinding, "prepare">
        | Pick<SqlTransactionSessionBinding, "prepare">,
    ): SqlPreparedStatementBinding[] => {
      const statements = [
        factory
          .prepare(
            `INSERT INTO "dlq_entries"
               ("id", "queue", "message_body", "error", "retry_count", "created_at")
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            queueName,
            messageBody,
            terminalError,
            attempts ?? null,
            now,
          ),
      ];
      if (validBody) {
        const runningFence = logicalDeliveryId
          ? ` OR ("status" = 'running' AND "claim_token" = ?
                   AND ("started_at" IS NULL OR "started_at" < ?))`
          : "";
        statements.push(
          factory
            .prepare(
              `UPDATE "index_jobs"
               SET "status" = 'failed', "claim_token" = NULL,
                   "error" = ?, "completed_at" = ?
               WHERE "id" = ?
                 AND "account_id" = ?
                 AND "type" = ?
                 AND ("status" IN ('queued', 'enqueued')${runningFence})`,
            )
            .bind(
              terminalError,
              now,
              validBody.jobId,
              validBody.spaceId,
              validBody.type,
              ...(logicalDeliveryId
                ? [logicalDeliveryId, staleBefore]
                : []),
            ),
        );
      }
      return statements;
    };

    if (env.DB.withTransaction) {
      await env.DB.withTransaction(async (tx) => {
        await tx.batch(buildStatements(tx));
      });
    } else {
      // D1 batch is transactional, so the append-only DLQ ledger and the
      // terminal index-job status cannot split across a partial failure.
      await env.DB.batch(buildStatements(env.DB));
    }
  } catch (persistErr) {
    logError(`${TAG} Failed to persist index DLQ transition`, persistErr, {
      module: "indexer",
    });
    throw persistErr;
  }
  return { action: "ack" };
}
