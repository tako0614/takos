// Indexer handler module (queue).
// INDEX_QUEUE wiring; indexing implementations live in shared services.
// Imported by the unified takos-worker entrypoint (src/runtime/worker/index.ts).
import type { MessageBatch } from "../../shared/types/bindings.ts";
import type { IndexJobQueueMessage } from "../../shared/types/index.ts";
import { isValidIndexJobQueueMessage } from "../../shared/types/index.ts";
import type { IndexerEnv as Env } from "../../shared/types/index.ts";
import { getDb, indexJobs } from "../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import {
  createEnvGuard,
  validateIndexerEnv,
} from "../../shared/utils/validate-env.ts";
import { logError, logInfo, logWarn } from "../../shared/utils/logger.ts";
import {
  handleInfoUnit,
  handleMemoryBuildPaths,
  handleRepoCodeIndex,
  handleThreadContext,
  handleVectorize,
} from "./handlers.ts";

export { handleIndexJobDlq } from "./handlers.ts";

const TAG = "[INDEX_QUEUE]";

// Cached environment validation guard.
const envGuard = createEnvGuard(validateIndexerEnv);

export default {
  async queue(
    batch: MessageBatch<IndexJobQueueMessage>,
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
        message.ack();
        continue;
      }
      const body = message.body;
      const { jobId, spaceId, type, targetId } = body;

      try {
        // Idempotency check: skip if already completed
        const db = getDb(env.DB);
        const existing = await db.select({ status: indexJobs.status })
          .from(indexJobs).where(eq(indexJobs.id, jobId)).get();
        if (existing?.status === "completed") {
          logInfo(`${TAG} Job ${jobId} already completed, skipping`, {
            module: "indexer",
          });
          message.ack();
          continue;
        }

        // Upsert job record as 'running'
        if (!existing) {
          await db.insert(indexJobs).values({
            id: jobId,
            accountId: spaceId,
            type,
            targetId: targetId ?? null,
            status: "running",
            startedAt: new Date().toISOString(),
          }).run();
        } else {
          await db.update(indexJobs)
            .set({ status: "running", startedAt: new Date().toISOString() })
            .where(eq(indexJobs.id, jobId)).run();
        }

        switch (type) {
          case "vectorize":
            await handleVectorize(env, jobId, spaceId, targetId);
            break;
          case "info_unit":
            await handleInfoUnit(env, jobId, spaceId, targetId);
            break;
          case "thread_context":
            await handleThreadContext(env, jobId, spaceId, targetId);
            break;
          case "repo_code_index":
            await handleRepoCodeIndex(env, jobId, body, targetId);
            break;
          case "memory_build_paths":
            await handleMemoryBuildPaths(env, jobId, spaceId, targetId);
            break;
          default:
            logWarn(`${TAG} Unknown job type: ${type}`, { module: "indexer" });
        }

        // Mark as completed
        await db.update(indexJobs)
          .set({ status: "completed", completedAt: new Date().toISOString() })
          .where(eq(indexJobs.id, jobId)).run();

        message.ack();
      } catch (error) {
        logError(`${TAG} Job ${jobId} failed`, error, { module: "indexer" });
        // Leave status as 'running' (or 'queued') — retry will reprocess
        message.retry();
      }
    }
  },
};
