/**
 * Workflow Engine – storage operations (logs and artifacts)
 */

import { generateId } from '../../../shared/utils/index.ts';
import { getDb, workflowJobs, workflowArtifacts } from '../../../infra/db/index.ts';
import { eq } from 'drizzle-orm';
import type { D1Database } from '../../../shared/types/bindings.ts';
import type { WorkflowBucket } from './workflow-engine-types.ts';

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
