import type { Env } from '../../../shared/types';
import { getDb, sessions, blobs, snapshots } from '../../../infra/db';
import { and, eq, inArray, lte, lt, asc } from 'drizzle-orm';
import { SnapshotManager } from '../sync/snapshot';

export interface SnapshotGcWorkspaceResult {
  spaceId: string;
  deletedBlobs: number;
  deletedSnapshots: number;
  deletedSessionFiles: number;
  error?: string;
}

export interface SnapshotGcBatchSummary {
  candidates: {
    sessions: number;
    blobs: number;
    oldSnapshots: number;
  };
  processed: number;
  deletedBlobs: number;
  deletedSnapshots: number;
  deletedSessionFiles: number;
  errors: number;
  spaces: SnapshotGcWorkspaceResult[];
}

function addWorkspaceIds(
  into: Set<string>,
  rows: Array<{ accountId: string }>,
  maxWorkspaces: number
): void {
  for (const row of rows) {
    if (into.size >= maxWorkspaces) break;
    if (row.accountId) into.add(row.accountId);
  }
}

export async function runSnapshotGcBatch(
  env: Env,
  options?: {
    maxWorkspaces?: number;
    candidateScanLimit?: number;
    staleSnapshotAgeMinutes?: number;
  }
): Promise<SnapshotGcBatchSummary> {
  if (!env.TENANT_SOURCE) {
    return {
      candidates: { sessions: 0, blobs: 0, oldSnapshots: 0 },
      processed: 0,
      deletedBlobs: 0,
      deletedSnapshots: 0,
      deletedSessionFiles: 0,
      errors: 0,
      spaces: [],
    };
  }

  const db = getDb(env.DB);
  const maxWorkspaces = Math.max(1, Math.min(options?.maxWorkspaces ?? 5, 25));
  const candidateScanLimit = Math.max(10, Math.min(options?.candidateScanLimit ?? 200, 1000));
  const staleSnapshotAgeMinutes = Math.max(1, Math.min(options?.staleSnapshotAgeMinutes ?? 30, 24 * 60));
  const snapshotCutoff = new Date(Date.now() - staleSnapshotAgeMinutes * 60 * 1000).toISOString();

  const spaceIds = new Set<string>();

  // Workspaces with sessions ready for cleanup (merged/discarded/dead).
  const sessionRows = await db.select({ accountId: sessions.accountId })
    .from(sessions)
    .where(inArray(sessions.status, ['merged', 'discarded', 'dead']))
    .orderBy(asc(sessions.updatedAt))
    .limit(candidateScanLimit)
    .all();
  addWorkspaceIds(spaceIds, sessionRows, maxWorkspaces);

  let blobRows: Array<{ accountId: string }> = [];
  // Workspaces with orphaned blobs (refcount <= 0).
  if (spaceIds.size < maxWorkspaces) {
    blobRows = await db.select({ accountId: blobs.accountId })
      .from(blobs)
      .where(lte(blobs.refcount, 0))
      .orderBy(asc(blobs.createdAt))
      .limit(candidateScanLimit)
      .all();
    addWorkspaceIds(spaceIds, blobRows, maxWorkspaces);
  }

  let oldSnapshotRows: Array<{ accountId: string }> = [];
  // Workspaces with old pending/failed snapshots.
  if (spaceIds.size < maxWorkspaces) {
    oldSnapshotRows = await db.select({ accountId: snapshots.accountId })
      .from(snapshots)
      .where(
        and(
          inArray(snapshots.status, ['pending', 'failed']),
          lt(snapshots.createdAt, snapshotCutoff),
        )
      )
      .orderBy(asc(snapshots.createdAt))
      .limit(candidateScanLimit)
      .all();
    addWorkspaceIds(spaceIds, oldSnapshotRows, maxWorkspaces);
  }

  const summary: SnapshotGcBatchSummary = {
    candidates: {
      sessions: sessionRows.length,
      blobs: blobRows.length,
      oldSnapshots: oldSnapshotRows.length,
    },
    processed: 0,
    deletedBlobs: 0,
    deletedSnapshots: 0,
    deletedSessionFiles: 0,
    errors: 0,
    spaces: [],
  };

  for (const spaceId of spaceIds) {
    const result: SnapshotGcWorkspaceResult = {
      spaceId,
      deletedBlobs: 0,
      deletedSnapshots: 0,
      deletedSessionFiles: 0,
    };

    try {
      const manager = new SnapshotManager(env, spaceId);
      const out = await manager.runGC();
      result.deletedBlobs = out.deletedBlobs;
      result.deletedSnapshots = out.deletedSnapshots;
      result.deletedSessionFiles = out.deletedSessionFiles;

      summary.deletedBlobs += out.deletedBlobs;
      summary.deletedSnapshots += out.deletedSnapshots;
      summary.deletedSessionFiles += out.deletedSessionFiles;
      summary.processed += 1;
    } catch (err) {
      summary.errors += 1;
      result.error = err instanceof Error ? err.message : String(err);
    }

    summary.spaces.push(result);
  }

  return summary;
}
