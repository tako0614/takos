// Indexer handler implementations.
// Called by the queue dispatcher in index.ts.
import type { IndexJobQueueMessage } from '../../shared/types/index.ts';
import { INDEX_QUEUE_MESSAGE_VERSION } from '../../shared/types/index.ts';
import type { D1Database } from '../../shared/types/bindings.ts';
import type { IndexerEnv as Env } from '../../shared/types/index.ts';
import { getDb, accounts, type indexJobs as _indexJobs, dlqEntries } from '../../infra/db/index.ts';
import { eq } from 'drizzle-orm';
import { createEmbeddingsService } from '../../application/services/execution/embeddings.ts';
import { createInfoUnitIndexer } from '../../application/services/source/info-units.ts';
import { indexThreadContext } from '../../application/services/agent/index.ts';
import { getOrCreateBillingAccount, recordUsage } from '../../application/services/billing/billing.ts';
import { generateId } from '../../shared/utils/index.ts';
import { logError, logInfo, logWarn } from '../../shared/utils/logger.ts';

const TAG = '[INDEX_QUEUE]';

export async function handleVectorize(
  env: Env,
  jobId: string,
  spaceId: string,
  _targetId?: string,
): Promise<void> {
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

export async function handleInfoUnit(env: Env, jobId: string, spaceId: string, targetId?: string): Promise<void> {
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

export async function handleThreadContext(env: Env, jobId: string, spaceId: string, targetId?: string): Promise<void> {
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

export async function handleRepoCodeIndex(env: Env, jobId: string, body: IndexJobQueueMessage, targetId?: string): Promise<void> {
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
