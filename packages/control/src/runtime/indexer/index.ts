// Indexer handler module (queue).
// INDEX_QUEUE wiring; indexing implementations live in shared services.
// Imported by the unified takos-worker entrypoint (src/runtime/worker/index.ts).
import type { MessageBatch } from '../../shared/types/bindings.ts';
import type { IndexJobQueueMessage } from '../../shared/types';
import { isValidIndexJobQueueMessage, INDEX_QUEUE_MESSAGE_VERSION } from '../../shared/types';
import type { D1Database } from '../../shared/types/bindings.ts';
import type { IndexerEnv as Env } from '../../shared/types';
import { getDb, accounts, indexJobs, dlqEntries } from '../../infra/db';
import { eq } from 'drizzle-orm';
import { createEmbeddingsService } from '../../application/services/execution/embeddings';
import { createInfoUnitIndexer } from '../../application/services/source/info-units';
import { indexThreadContext } from '../../application/services/agent';
import { getOrCreateBillingAccount, recordUsage } from '../../application/services/billing/billing';
import { generateId } from '../../shared/utils';
import { validateIndexerEnv, createEnvGuard } from '../../shared/utils/validate-env';
import { logError, logInfo, logWarn } from '../../shared/utils/logger';

const TAG = '[INDEX_QUEUE]';

// Cached environment validation guard.
const envGuard = createEnvGuard(validateIndexerEnv);

async function handleVectorize(env: Env, jobId: string, spaceId: string, targetId?: string): Promise<void> {
  const embeddingsService = createEmbeddingsService(env);
  if (!embeddingsService) {
    logWarn(`${TAG} Embeddings service not available for job ${jobId}`, { module: 'indexer' });
    return;
  }

  const indexResult = await embeddingsService.indexWorkspace(spaceId, env.TENANT_SOURCE, {
    forceReindex: false,
  });

  if (indexResult.chunks > 0) {
    try {
      const workspace = await getDb(env.DB).select({ ownerAccountId: accounts.ownerAccountId })
        .from(accounts).where(eq(accounts.id, spaceId)).get();
      if (workspace) {
        const account = await getOrCreateBillingAccount(env.DB, workspace.ownerAccountId!);
        await recordUsage(env.DB, {
          accountId: account.id,
          spaceId,
          meterType: 'embedding_count',
          units: indexResult.chunks,
          referenceId: jobId,
          referenceType: 'index_job',
        });
      }
    } catch (billingErr) {
      logError(`${TAG} Billing recording failed for job ${jobId}`, billingErr, { module: 'indexer' });
    }
  }
}

async function handleInfoUnit(env: Env, jobId: string, spaceId: string, targetId?: string): Promise<void> {
  const indexer = createInfoUnitIndexer(env);
  if (!indexer) {
    logWarn(`${TAG} Info unit indexer not available for job ${jobId}`, { module: 'indexer' });
    return;
  }
  if (!targetId) {
    logWarn(`${TAG} Missing runId for info_unit job ${jobId}`, { module: 'indexer' });
    return;
  }
  await indexer.indexRun(spaceId, targetId);
}

async function handleThreadContext(env: Env, jobId: string, spaceId: string, targetId?: string): Promise<void> {
  if (!targetId) {
    logWarn(`${TAG} Missing threadId for thread_context job ${jobId}`, { module: 'indexer' });
    return;
  }

  const result = await indexThreadContext({ env, spaceId, threadId: targetId });

  if (result.hasMore && env.INDEX_QUEUE) {
    try {
      const followUpJobId = generateId();
      await env.INDEX_QUEUE.send({
        version: INDEX_QUEUE_MESSAGE_VERSION,
        jobId: followUpJobId,
        spaceId,
        type: 'thread_context',
        targetId,
        timestamp: Date.now(),
      });
      logInfo(`${TAG} Thread context follow-up job ${followUpJobId} enqueued for thread ${targetId}`, { module: 'indexer' });
    } catch (enqueueErr) {
      logWarn(`${TAG} Failed to enqueue follow-up thread_context job for thread ${targetId}`, { module: 'indexer', detail: enqueueErr });
    }
  }
}

async function handleRepoCodeIndex(env: Env, jobId: string, body: IndexJobQueueMessage, targetId?: string): Promise<void> {
  const { repoId } = body;
  if (!repoId || !targetId) {
    logWarn(`${TAG} Missing repoId/targetId for repo_code_index job ${jobId}`, { module: 'indexer' });
    return;
  }

  const embeddingsService = createEmbeddingsService(env);
  if (!embeddingsService || !env.GIT_OBJECTS) {
    logWarn(`${TAG} Embeddings/GIT_OBJECTS not available for repo_code_index job ${jobId}`, { module: 'indexer' });
    return;
  }

  const result = await embeddingsService.indexRepoFiles(repoId, env.GIT_OBJECTS, targetId);
  logInfo(`${TAG} Repo code index job ${jobId}: indexed=${result.indexed}, chunks=${result.chunks}, errors=${result.errors.length}`, { module: 'indexer' });
}

export async function handleIndexJobDlq(
  body: unknown,
  env: { DB: D1Database },
  attempts?: number,
): Promise<void> {
  const dlqEntry = {
    level: 'CRITICAL',
    event: 'INDEX_JOB_DLQ_ENTRY',
    queue: 'takos-index-jobs-dlq',
    timestamp: new Date().toISOString(),
    retryCount: attempts ?? null,
    body: JSON.stringify(body),
  };
  logError(`${TAG} CRITICAL: ${JSON.stringify(dlqEntry)}`, undefined, { module: 'indexer' });

  try {
    const db = getDb(env.DB);
    await db.insert(dlqEntries).values({
      id: crypto.randomUUID(),
      queue: 'takos-index-jobs-dlq',
      messageBody: JSON.stringify(body),
      error: 'Max retries exceeded',
      retryCount: attempts ?? null,
    }).run();
  } catch (persistErr) {
    logError(`${TAG} Failed to persist DLQ entry`, persistErr, { module: 'indexer' });
  }
}

export default {
  async queue(batch: MessageBatch<IndexJobQueueMessage>, env: Env): Promise<void> {
    // Validate environment on first invocation (cached).
    const envError = envGuard(env as unknown as Record<string, unknown>);
    if (envError) {
      for (const message of batch.messages) {
        message.retry();
      }
      return;
    }

    for (const message of batch.messages) {
      if (!isValidIndexJobQueueMessage(message.body)) {
        logError(`${TAG} Invalid message format, skipping`, JSON.stringify(message.body), { module: 'indexer' });
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
        if (existing?.status === 'completed') {
          logInfo(`${TAG} Job ${jobId} already completed, skipping`, { module: 'indexer' });
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
            status: 'running',
            startedAt: new Date().toISOString(),
          }).run();
        } else {
          await db.update(indexJobs)
            .set({ status: 'running', startedAt: new Date().toISOString() })
            .where(eq(indexJobs.id, jobId)).run();
        }

        switch (type) {
          case 'vectorize':
            await handleVectorize(env, jobId, spaceId, targetId);
            break;
          case 'info_unit':
            await handleInfoUnit(env, jobId, spaceId, targetId);
            break;
          case 'thread_context':
            await handleThreadContext(env, jobId, spaceId, targetId);
            break;
          case 'repo_code_index':
            await handleRepoCodeIndex(env, jobId, body, targetId);
            break;
          default:
            logWarn(`${TAG} Unknown job type: ${type}`, { module: 'indexer' });
        }

        // Mark as completed
        await db.update(indexJobs)
          .set({ status: 'completed', completedAt: new Date().toISOString() })
          .where(eq(indexJobs.id, jobId)).run();

        message.ack();
      } catch (error) {
        logError(`${TAG} Job ${jobId} failed`, error, { module: 'indexer' });
        // Leave status as 'running' (or 'queued') — retry will reprocess
        message.retry();
      }
    }
  },
};
