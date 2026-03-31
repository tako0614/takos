import { getDb } from '../../../infra/db/index.ts';
import { files, chunks, nodes, edges, indexJobs } from '../../../infra/db/schema.ts';
import { eq, and, ne, inArray, desc, count } from 'drizzle-orm';
import { createEmbeddingsService, isEmbeddingsAvailable } from '../../../application/services/execution/embeddings.ts';
import type { IndexJobQueueMessage } from '../../../shared/types/index.ts';
import { INDEX_QUEUE_MESSAGE_VERSION } from '../../../shared/types/index.ts';
import { generateId } from '../../../shared/utils/index.ts';
import { checkSpaceAccess } from '../../../application/services/identity/space-access.ts';
import { logError, logInfo } from '../../../shared/utils/logger.ts';
import { indexFile, runIndexJob } from './jobs.ts';
import type { IndexContext, IndexFileBody, VectorizeIndexBody } from './index-context.ts';
import { scheduleBackground } from './index-context.ts';
import { BadRequestError, NotFoundError, InternalError } from 'takos-common/errors';

export async function handleIndexStatus(c: IndexContext): Promise<Response> {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  if (!spaceId) throw new BadRequestError('Missing spaceId');
  const access = await checkSpaceAccess(c.env.DB, spaceId, user.id);
  if (!access) {
    throw new NotFoundError('Workspace');
  }

  const db = getDb(c.env.DB);
  const { isNotNull } = await import('drizzle-orm');
  const totalFilesResult = await db.select({ count: count() }).from(files).where(
    and(eq(files.accountId, spaceId), ne(files.origin, 'system'))
  ).get();
  const totalFiles = totalFilesResult?.count ?? 0;
  const indexedFilesResult = await db.select({ count: count() }).from(files).where(
    and(eq(files.accountId, spaceId), ne(files.origin, 'system'), isNotNull(files.indexedAt))
  ).get();
  const indexedFiles = indexedFilesResult?.count ?? 0;
  const chunkCountResult = await db.select({ count: count() }).from(chunks).where(eq(chunks.accountId, spaceId)).get();
  const chunkCount = chunkCountResult?.count ?? 0;
  const nodeCountResult = await db.select({ count: count() }).from(nodes).where(eq(nodes.accountId, spaceId)).get();
  const nodeCount = nodeCountResult?.count ?? 0;
  const edgeCountResult = await db.select({ count: count() }).from(edges).where(eq(edges.accountId, spaceId)).get();
  const edgeCount = edgeCountResult?.count ?? 0;
  const latestJob = await db.select().from(indexJobs).where(eq(indexJobs.accountId, spaceId)).orderBy(desc(indexJobs.createdAt)).get() ?? null;

  return c.json({
    totalFiles,
    indexedFiles,
    chunks: chunkCount,
    nodes: nodeCount,
    edges: edgeCount,
    latestJob,
    vectorize_available: isEmbeddingsAvailable(c.env),
  });
}

export async function handleVectorizeIndex(
  c: IndexContext,
  body: VectorizeIndexBody
): Promise<Response> {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  if (!spaceId) throw new BadRequestError('Missing spaceId');
  const access = await checkSpaceAccess(c.env.DB, spaceId, user.id, ['owner', 'admin']);
  if (!access) {
    throw new NotFoundError('Workspace');
  }

  if (!isEmbeddingsAvailable(c.env)) {
    throw new BadRequestError('Vectorize not available');
  }

  const jobId = generateId();
  if (c.env.INDEX_QUEUE) {
    try {
      const message: IndexJobQueueMessage = {
        version: INDEX_QUEUE_MESSAGE_VERSION,
        jobId,
        spaceId,
        type: 'vectorize',
        timestamp: Date.now(),
      };
      await c.env.INDEX_QUEUE.send(message);
      logInfo(`Vectorize job ${jobId} enqueued for workspace ${spaceId}`, { module: 'index_queue' });
    } catch (err) {
      logError('Failed to enqueue vectorize job', err, { module: 'routes/index/index-handlers' });
      throw new InternalError('Failed to queue indexing job');
    }
  } else {
    const embeddingsService = createEmbeddingsService(c.env);
    if (!embeddingsService) {
      throw new InternalError('Failed to create embeddings service');
    }

    scheduleBackground(
      c,
      embeddingsService
        .indexWorkspace(spaceId, c.env.TENANT_SOURCE, {
          forceReindex: body.force_reindex,
        })
        .catch((err) => logError('Vectorize index error', err, { action: 'vectorize_index', spaceId }))
    );
  }

  return c.json(
    {
      message: 'Vectorize indexing started',
      space_id: spaceId,
      job_id: jobId,
    },
    202
  );
}

export async function handleRebuildIndex(c: IndexContext): Promise<Response> {
  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  if (!spaceId) throw new BadRequestError('Missing spaceId');
  const access = await checkSpaceAccess(c.env.DB, spaceId, user.id, ['owner', 'admin']);
  if (!access) {
    throw new NotFoundError('Workspace');
  }

  const db = getDb(c.env.DB);
  const runningJob = await db.select().from(indexJobs).where(
    and(eq(indexJobs.accountId, spaceId), inArray(indexJobs.status, ['queued', 'running']))
  ).get();
  if (runningJob) {
    throw new BadRequestError('Index job already in progress');
  }

  const fileCountResult = await db.select({ count: count() }).from(files).where(
    and(eq(files.accountId, spaceId), ne(files.origin, 'system'), inArray(files.kind, ['source', 'config', 'doc']))
  ).get();
  const fileCount = fileCountResult?.count ?? 0;

  const jobId = generateId();
  const timestamp = new Date().toISOString();
  const job = await db.insert(indexJobs).values({
    id: jobId,
    accountId: spaceId,
    type: 'full',
    status: 'queued',
    totalFiles: fileCount,
    processedFiles: 0,
    createdAt: timestamp,
  }).returning().get();

  scheduleBackground(
    c,
    runIndexJob(
      c.env.DB,
      c.env.TENANT_SOURCE,
      jobId,
      createEmbeddingsService(c.env) ?? undefined
    ).catch((err) => logError('Index job error', err, { action: 'index_rebuild', jobId, spaceId }))
  );

  return c.json({ job }, 201);
}

export async function handleIndexFile(
  c: IndexContext,
  body: IndexFileBody | null
): Promise<Response> {
  if (!body) {
    throw new BadRequestError('Invalid JSON body');
  }

  const user = c.get('user');
  const spaceId = c.req.param('spaceId');
  if (!spaceId) throw new BadRequestError('Missing spaceId');
  const access = await checkSpaceAccess(c.env.DB, spaceId, user.id, ['owner', 'admin', 'editor']);
  if (!access) {
    throw new NotFoundError('Workspace');
  }
  if (!body.path) {
    throw new BadRequestError('Path is required');
  }

  const db = getDb(c.env.DB);
  const file = await db.select().from(files).where(
    and(eq(files.accountId, spaceId), eq(files.path, body.path))
  ).get();
  if (!file) {
    throw new NotFoundError('File');
  }

  const jobId = generateId();
  const timestamp = new Date().toISOString();
  const job = await db.insert(indexJobs).values({
    id: jobId,
    accountId: spaceId,
    type: 'file',
    targetId: file.id,
    status: 'queued',
    totalFiles: 1,
    processedFiles: 0,
    createdAt: timestamp,
  }).returning().get();

  scheduleBackground(
    c,
    indexFile(
      c.env.DB,
      c.env.TENANT_SOURCE,
      spaceId,
      file.id,
      jobId,
      createEmbeddingsService(c.env) ?? undefined
    ).catch((err) => logError('Index file error', err, { action: 'index_file', jobId, spaceId, fileId: file.id }))
  );

  return c.json({ job }, 201);
}
