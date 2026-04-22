import type { Env } from "../../../shared/types/index.ts";
import { blobs, getDb, sessions, snapshots } from "../../../infra/db/index.ts";
import { and, asc, type eq as _eq, inArray, lt, lte } from "drizzle-orm";
import { SnapshotManager } from "../sync/snapshot.ts";

export interface SnapshotGcSpaceResult {
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
  spaces: SnapshotGcSpaceResult[];
}

function addSpaceIds(
  into: Set<string>,
  rows: Array<{ accountId: string }>,
  maxSpaces: number,
): void {
  for (const row of rows) {
    if (into.size >= maxSpaces) break;
    if (row.accountId) into.add(row.accountId);
  }
}

export async function runSnapshotGcBatch(
  env: Env,
  options?: {
    maxSpaces?: number;
    candidateScanLimit?: number;
    staleSnapshotAgeMinutes?: number;
  },
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
  const maxSpaces = Math.max(1, Math.min(options?.maxSpaces ?? 5, 25));
  const candidateScanLimit = Math.max(
    10,
    Math.min(options?.candidateScanLimit ?? 200, 1000),
  );
  const staleSnapshotAgeMinutes = Math.max(
    1,
    Math.min(options?.staleSnapshotAgeMinutes ?? 30, 24 * 60),
  );
  const snapshotCutoff = new Date(
    Date.now() - staleSnapshotAgeMinutes * 60 * 1000,
  ).toISOString();

  const spaceIds = new Set<string>();

  // Workspaces with sessions ready for cleanup (merged/discarded/dead).
  const sessionRows = await db.select({ accountId: sessions.accountId })
    .from(sessions)
    .where(inArray(sessions.status, ["merged", "discarded", "dead"]))
    .orderBy(asc(sessions.updatedAt))
    .limit(candidateScanLimit)
    .all();
  addSpaceIds(spaceIds, sessionRows, maxSpaces);

  let blobRows: Array<{ accountId: string }> = [];
  // Workspaces with orphaned blobs (refcount <= 0).
  if (spaceIds.size < maxSpaces) {
    blobRows = await db.select({ accountId: blobs.accountId })
      .from(blobs)
      .where(lte(blobs.refcount, 0))
      .orderBy(asc(blobs.createdAt))
      .limit(candidateScanLimit)
      .all();
    addSpaceIds(spaceIds, blobRows, maxSpaces);
  }

  let oldSnapshotRows: Array<{ accountId: string }> = [];
  // Workspaces with old pending/failed snapshots.
  if (spaceIds.size < maxSpaces) {
    oldSnapshotRows = await db.select({ accountId: snapshots.accountId })
      .from(snapshots)
      .where(
        and(
          inArray(snapshots.status, ["pending", "failed"]),
          lt(snapshots.createdAt, snapshotCutoff),
        ),
      )
      .orderBy(asc(snapshots.createdAt))
      .limit(candidateScanLimit)
      .all();
    addSpaceIds(spaceIds, oldSnapshotRows, maxSpaces);
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
    const result: SnapshotGcSpaceResult = {
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
