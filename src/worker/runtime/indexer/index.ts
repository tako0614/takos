// Indexer handler module (queue).
// INDEX_QUEUE wiring; indexing implementations live in shared services.
// Imported by the unified takos-worker entrypoint (src/runtime/worker/index.ts).
import type { MessageQueueBatch } from "../../shared/types/bindings.ts";
import type { IndexJobQueueMessage } from "../../shared/types/index.ts";
import {
  INDEX_JOB_QUEUE_TYPES,
  isValidIndexJobQueueMessage,
} from "../../shared/types/index.ts";
import type { IndexerEnv as Env } from "../../shared/types/index.ts";
import { getDb, indexJobs } from "../../infra/db/index.ts";
import { and, eq, isNull } from "drizzle-orm";
import {
  createEnvGuard,
  validateIndexerEnv,
} from "../../shared/utils/validate-env.ts";
import { logError, logInfo, logWarn } from "../../shared/utils/logger.ts";
import { affectedRowCount } from "../../shared/utils/affected-row-count.ts";
import {
  handleInfoUnit,
  handleMemoryBuildPaths,
  handleRepoCodeIndex,
  handleThreadContext,
  handleVectorize,
  type IndexHandlerOutcome,
} from "./handlers.ts";
import {
  INDEX_JOB_CLAIM_STALE_MS,
  indexClaimRetryDelaySeconds,
} from "./index-policy.ts";

export { handleIndexJobDlq } from "./handlers.ts";

/** Injectable handler boundary for deterministic ownership/concurrency tests. */
export const indexerHandlerDeps = {
  handleVectorize,
  handleInfoUnit,
  handleThreadContext,
  handleRepoCodeIndex,
  handleMemoryBuildPaths,
};

const TAG = "[INDEX_QUEUE]";

function readUnknownIndexJobEnvelope(value: unknown): {
  jobId: string;
  spaceId: string;
  type: string;
  targetId: string | null;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.jobId !== "string" ||
    !item.jobId ||
    item.jobId.length > 512 ||
    typeof item.spaceId !== "string" ||
    !item.spaceId ||
    item.spaceId.length > 512 ||
    typeof item.type !== "string" ||
    !item.type ||
    item.type.length > 512 ||
    (INDEX_JOB_QUEUE_TYPES as readonly string[]).includes(item.type) ||
    (item.targetId !== undefined &&
      (typeof item.targetId !== "string" ||
        !item.targetId ||
        item.targetId.length > 512))
  ) {
    return null;
  }
  return {
    jobId: item.jobId,
    spaceId: item.spaceId,
    type: item.type,
    targetId: typeof item.targetId === "string" ? item.targetId : null,
  };
}

// Cached environment validation guard.
const envGuard = createEnvGuard(validateIndexerEnv);

export default {
  async queue(
    batch: MessageQueueBatch<IndexJobQueueMessage>,
    env: Env,
  ): Promise<void> {
    // Validate environment on first invocation (cached).
    const envError = envGuard(env);
    if (envError) {
      for (const message of batch.messages) {
        message.retry();
      }
      return;
    }

    for (const message of batch.messages) {
      if (!isValidIndexJobQueueMessage(message.body)) {
        logError(
          `${TAG} Invalid message format, skipping`,
          JSON.stringify(message.body),
          { module: "indexer" },
        );
        const unknownJob = readUnknownIndexJobEnvelope(message.body);
        if (!unknownJob) {
          message.ack();
          continue;
        }
        try {
          const now = new Date().toISOString();
          await getDb(env.DB)
            .insert(indexJobs)
            .values({
              id: unknownJob.jobId,
              accountId: unknownJob.spaceId,
              type: unknownJob.type,
              targetId: unknownJob.targetId,
              status: "failed",
              error: `unknown_index_job_type:${unknownJob.type}`,
              completedAt: now,
            })
            .onConflictDoNothing({ target: indexJobs.id })
            .run();
          message.ack();
        } catch (error) {
          logError(`${TAG} Failed to persist invalid job outcome`, error, {
            module: "indexer",
          });
          message.retry();
        }
        continue;
      }
      const body = message.body;
      const { jobId, spaceId, type, targetId } = body;
      // One-release fallback for old in-flight bodies minted before
      // deliveryId became portable across Cloudflare/SQS/PubSub/local queues.
      const deliveryId = body.deliveryId ?? message.id;
      let claimed = false;

      try {
        const db = getDb(env.DB);
        // Queue-only producers may not have an outbox row yet. Create the
        // neutral state first; concurrent duplicates converge on the same PK.
        await db
          .insert(indexJobs)
          .values({
            id: jobId,
            accountId: spaceId,
            type,
            targetId: targetId ?? null,
            status: "enqueued",
          })
          .onConflictDoNothing({ target: indexJobs.id })
          .run();

        const existing = await db
          .select({
            accountId: indexJobs.accountId,
            type: indexJobs.type,
            targetId: indexJobs.targetId,
            status: indexJobs.status,
            claimToken: indexJobs.claimToken,
            startedAt: indexJobs.startedAt,
          })
          .from(indexJobs)
          .where(eq(indexJobs.id, jobId))
          .get();
        if (!existing) {
          throw new Error(`index_job_missing_after_upsert:${jobId}`);
        }
        if (
          existing.accountId !== spaceId ||
          existing.type !== type ||
          existing.targetId !== (targetId ?? null)
        ) {
          logError(`${TAG} Job ${jobId} identity mismatch`, undefined, {
            module: "indexer",
          });
          message.ack();
          continue;
        }
        if (existing.status === "completed" || existing.status === "failed") {
          logInfo(`${TAG} Job ${jobId} is already terminal, skipping`, {
            module: "indexer",
          });
          message.ack();
          continue;
        }
        if (
          existing.status !== "queued" &&
          existing.status !== "enqueued" &&
          existing.status !== "running"
        ) {
          logWarn(`${TAG} Job ${jobId} has an unsupported state`, {
            module: "indexer",
            status: existing.status,
          });
          message.ack();
          continue;
        }

        if (
          existing.status === "running" &&
          existing.claimToken !== deliveryId
        ) {
          // A different Queue message already owns this job. Ack the
          // duplicate; the owner message keeps its stable id across retries.
          message.ack();
          continue;
        }
        if (existing.status === "running") {
          const startedAtMs = existing.startedAt
            ? Date.parse(existing.startedAt)
            : Number.NaN;
          const runningIsStale =
            !Number.isFinite(startedAtMs) ||
            startedAtMs < Date.now() - INDEX_JOB_CLAIM_STALE_MS;
          if (!runningIsStale) {
            // A concurrent copy of the same logical Queue delivery must not
            // re-enter the handler. Normal handler errors release to enqueued;
            // only an abandoned running claim ages into crash recovery.
            message.retry({
              delaySeconds: indexClaimRetryDelaySeconds(existing.startedAt!),
            });
            continue;
          }
        }
        if (
          existing.status === "enqueued" &&
          existing.claimToken !== null &&
          existing.claimToken !== deliveryId
        ) {
          // The durable outbox has superseded this queued copy with a newer
          // delivery. Ack the stale body before it can overwrite that claim.
          message.ack();
          continue;
        }

        const claimedAt = new Date().toISOString();
        const exactPriorState =
          existing.status === "running"
            ? and(
                eq(indexJobs.status, "running"),
                eq(indexJobs.claimToken, deliveryId),
                existing.startedAt
                  ? eq(indexJobs.startedAt, existing.startedAt)
                  : isNull(indexJobs.startedAt),
              )
            : and(
                eq(indexJobs.status, existing.status),
                ...(existing.status === "enqueued" && existing.claimToken
                  ? [eq(indexJobs.claimToken, deliveryId)]
                  : []),
              );
        const claim = await db
          .update(indexJobs)
          .set({
            status: "running",
            startedAt: claimedAt,
            completedAt: null,
            error: null,
            claimToken: deliveryId,
          })
          .where(
            and(
              eq(indexJobs.id, jobId),
              eq(indexJobs.accountId, spaceId),
              eq(indexJobs.type, type),
              targetId === undefined
                ? isNull(indexJobs.targetId)
                : eq(indexJobs.targetId, targetId),
              exactPriorState,
            ),
          )
          .run();
        if (affectedRowCount(claim) === 0) {
          // Another delivery won the status/claim-token CAS.
          message.ack();
          continue;
        }
        claimed = true;

        let outcome: IndexHandlerOutcome;
        switch (type) {
          case "vectorize":
            outcome = await indexerHandlerDeps.handleVectorize(
              env,
              jobId,
              spaceId,
              targetId,
            );
            break;
          case "info_unit":
            outcome = await indexerHandlerDeps.handleInfoUnit(
              env,
              jobId,
              spaceId,
              targetId,
            );
            break;
          case "thread_context":
            outcome = await indexerHandlerDeps.handleThreadContext(
              env,
              jobId,
              spaceId,
              targetId,
            );
            break;
          case "repo_code_index":
            outcome = await indexerHandlerDeps.handleRepoCodeIndex(
              env,
              jobId,
              body,
              targetId,
            );
            break;
          case "memory_build_paths":
            outcome = await indexerHandlerDeps.handleMemoryBuildPaths(
              env,
              jobId,
              spaceId,
              targetId,
            );
            break;
          default:
            outcome = {
              processed: false as const,
              reason: `unknown_index_job_type:${String(type)}`,
              retryable: false,
            };
        }

        if (!outcome.processed) {
          if (outcome.retryable) {
            await db
              .update(indexJobs)
              .set({
                status: "enqueued",
                claimToken: null,
                startedAt: null,
                completedAt: null,
                error: outcome.reason,
              })
              .where(
                and(
                  eq(indexJobs.id, jobId),
                  eq(indexJobs.status, "running"),
                  eq(indexJobs.claimToken, deliveryId),
                ),
              )
              .run();
            message.retry();
            continue;
          }

          const failed = await db
            .update(indexJobs)
            .set({
              status: "failed",
              claimToken: null,
              error: outcome.reason,
              completedAt: new Date().toISOString(),
            })
            .where(
              and(
                eq(indexJobs.id, jobId),
                eq(indexJobs.status, "running"),
                eq(indexJobs.claimToken, deliveryId),
              ),
            )
            .run();
          if (affectedRowCount(failed) === 0) {
            message.retry();
          } else {
            message.ack();
          }
          continue;
        }

        // Mark as completed
        const completed = await db
          .update(indexJobs)
          .set({
            status: "completed",
            claimToken: null,
            error: null,
            completedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(indexJobs.id, jobId),
              eq(indexJobs.status, "running"),
              eq(indexJobs.claimToken, deliveryId),
            ),
          )
          .run();

        if (affectedRowCount(completed) === 0) {
          logWarn(`${TAG} Job ${jobId} lost its completion claim`, {
            module: "indexer",
          });
          message.retry();
        } else {
          message.ack();
        }
      } catch (error) {
        logError(`${TAG} Job ${jobId} failed`, error, { module: "indexer" });
        if (claimed) {
          try {
            const db = getDb(env.DB);
            await db
              .update(indexJobs)
              .set({
                status: "enqueued",
                claimToken: null,
                startedAt: null,
                completedAt: null,
                error: String(error).slice(0, 2048),
              })
              .where(
                and(
                  eq(indexJobs.id, jobId),
                  eq(indexJobs.status, "running"),
                  eq(indexJobs.claimToken, deliveryId),
                ),
              )
              .run();
          } catch (resetError) {
            logError(`${TAG} Job ${jobId} claim reset failed`, resetError, {
              module: "indexer",
            });
          }
        }
        message.retry();
      }
    }
  },
};
