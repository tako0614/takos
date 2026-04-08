/**
 * Workflow Engine – storage operations (logs and artifacts)
 */

import { generateId } from '../../../shared/utils/index.ts';
import { getDb, workflowJobs, workflowArtifacts } from '../../../infra/db/index.ts';
import { eq, lt } from 'drizzle-orm';
import type { D1Database } from '../../../shared/types/bindings.ts';
import type { WorkflowBucket } from './workflow-engine-types.ts';
import { logError, logInfo } from '../../../shared/utils/logger.ts';

// ---------------------------------------------------------------------------
// storeJobLogs
// ---------------------------------------------------------------------------

export async function storeJobLogs(
  db: D1Database,
  bucket: WorkflowBucket,
  jobId: string,
  logs: string,
): Promise<string> {
  const drizzle = getDb(db);
  const r2Key = `workflow-logs/${jobId}.txt`;

  await bucket.put(r2Key, logs, {
    httpMetadata: {
      contentType: 'text/plain',
    },
  });

  await drizzle.update(workflowJobs)
    .set({ logsR2Key: r2Key })
    .where(eq(workflowJobs.id, jobId))
    .run();

  return r2Key;
}

// ---------------------------------------------------------------------------
// createArtifact
// ---------------------------------------------------------------------------

export async function createArtifact(
  db: D1Database,
  bucket: WorkflowBucket,
  options: {
    runId: string;
    name: string;
    data: ArrayBuffer | Uint8Array | string;
    mimeType?: string;
    expiresInDays?: number;
  },
): Promise<{ id: string; r2Key: string }> {
  const drizzle = getDb(db);
  const { runId, name, data, mimeType, expiresInDays = 30 } = options;

  const artifactId = generateId();
  const r2Key = `workflow-artifacts/${runId}/${artifactId}/${name}`;
  const timestamp = new Date().toISOString();
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  await bucket.put(r2Key, data, {
    httpMetadata: {
      contentType: mimeType || 'application/octet-stream',
    },
  });

  const size = typeof data === 'string' ? new TextEncoder().encode(data).length : data.byteLength;

  await drizzle.insert(workflowArtifacts)
    .values({
      id: artifactId,
      runId,
      name,
      r2Key,
      sizeBytes: size,
      mimeType: mimeType ?? null,
      expiresAt,
      createdAt: timestamp,
    })
    .run();

  return { id: artifactId, r2Key };
}

// ---------------------------------------------------------------------------
// runWorkflowArtifactGcBatch
// ---------------------------------------------------------------------------

/**
 * Delete expired workflow artifacts (R2 + DB row).
 *
 * Workflow artifacts default to 30-day retention via `createArtifact()`'s
 * `expiresInDays`. The `idx_workflow_artifacts_expires_at` index exists on
 * the table specifically so this scan is cheap. Without this GC, expired
 * rows accumulate in D1 and orphan R2 objects pile up indefinitely (the
 * `resolveWorkflowArtifactFileForJob` reader skips expired rows but never
 * deletes them).
 *
 * Designed to run from the hourly cron with a small batch limit so a backlog
 * doesn't blow the cron execution window.
 */
export async function runWorkflowArtifactGcBatch(
  db: D1Database,
  bucket: WorkflowBucket | undefined,
  options: { maxDeletes?: number } = {},
): Promise<{
  scanned: number;
  deletedRows: number;
  deletedR2Objects: number;
  errors: number;
}> {
  const drizzle = getDb(db);
  const maxDeletes = options.maxDeletes ?? 100;
  const cutoff = new Date().toISOString();

  const expired = await drizzle
    .select({ id: workflowArtifacts.id, r2Key: workflowArtifacts.r2Key })
    .from(workflowArtifacts)
    .where(
      // expires_at IS NOT NULL AND expires_at < now()
      // (drizzle doesn't have a single helper for this)
      lt(workflowArtifacts.expiresAt, cutoff),
    )
    .limit(maxDeletes)
    .all();

  let deletedRows = 0;
  let deletedR2Objects = 0;
  let errors = 0;

  for (const row of expired) {
    if (bucket && row.r2Key) {
      try {
        await bucket.delete(row.r2Key);
        deletedR2Objects++;
      } catch (err) {
        errors++;
        logError('Failed to delete expired workflow artifact from R2', err, {
          module: 'workflow-storage',
          detail: { id: row.id, r2Key: row.r2Key },
        });
        // Continue to delete the DB row anyway — leaving the row would just
        // make us retry the same R2 delete every cron tick.
      }
    }
    try {
      await drizzle.delete(workflowArtifacts).where(eq(workflowArtifacts.id, row.id)).run();
      deletedRows++;
    } catch (err) {
      errors++;
      logError('Failed to delete expired workflow artifact row', err, {
        module: 'workflow-storage',
        detail: { id: row.id },
      });
    }
  }

  if (deletedRows > 0 || deletedR2Objects > 0) {
    logInfo('workflow artifact GC batch completed', {
      module: 'workflow-storage',
      detail: { scanned: expired.length, deletedRows, deletedR2Objects, errors },
    });
  }

  return { scanned: expired.length, deletedRows, deletedR2Objects, errors };
}
