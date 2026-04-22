import type { Env } from "../../../shared/types/index.ts";
import type { SnapshotTree } from "./models.ts";
import {
  accounts,
  blobs,
  getDb as realGetDb,
  sessionFiles,
  sessions,
  snapshots,
} from "../../../infra/db/index.ts";
import { and, eq, inArray, lt, lte, type sql as _sql } from "drizzle-orm";
import {
  type logError as _logError,
  type logInfo as _logInfo,
  logWarn,
} from "../../../shared/utils/logger.ts";
import type { SnapshotManager } from "./snapshot.ts";

function getDb(db: Parameters<typeof realGetDb>[0]) {
  if (db && typeof (db as { select?: unknown }).select === "function") {
    return db as ReturnType<typeof realGetDb>;
  }
  return realGetDb(db);
}

/** Extract non-empty blob hashes from a snapshot tree. */
function extractTreeHashes(tree: SnapshotTree): string[] {
  return Object.values(tree).map((entry) => entry.hash).filter(Boolean);
}

/** Parse a JSON-encoded parent ID array, returning [] on failure. */
function parseParentIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

/**
 * Clean up old pending/failed snapshots (call periodically or on startup).
 */
export async function cleanupPendingSnapshots(
  manager: SnapshotManager,
  env: Env,
  spaceId: string,
  maxAgeMinutes: number = 30,
): Promise<number> {
  const db = getDb(env.DB);
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

  const oldSnapshots = await db.select({ id: snapshots.id })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.accountId, spaceId),
        inArray(snapshots.status, ["pending", "failed"]),
        lt(snapshots.createdAt, cutoff),
      ),
    )
    .all();

  let cleaned = 0;
  for (const s of oldSnapshots) {
    await manager.failSnapshot(s.id);
    cleaned++;
  }

  return cleaned;
}

/**
 * Get all snapshots reachable from a head snapshot (DAG traversal).
 */
const MAX_DAG_DEPTH = 10_000;
const BATCH_SIZE = 1000;

export async function getReachableSnapshots(
  env: Env,
  spaceId: string,
  headSnapshotId: string,
): Promise<Set<string>> {
  const db = getDb(env.DB);
  const reachable = new Set<string>();
  let toFetch = [headSnapshotId];

  let iterations = 0;

  while (toFetch.length > 0) {
    if (iterations >= MAX_DAG_DEPTH) {
      logWarn(
        `DAG traversal limit reached (${MAX_DAG_DEPTH} snapshots) for workspace ${spaceId}`,
        { module: "services/sync/snapshot" },
      );
      break;
    }

    const idsToFetch = toFetch.filter((id) => !reachable.has(id));
    if (idsToFetch.length === 0) break;

    const batchIds = idsToFetch.slice(0, BATCH_SIZE);
    iterations += batchIds.length;

    const snapshotRows = await db.select({
      id: snapshots.id,
      parentIds: snapshots.parentIds,
    })
      .from(snapshots)
      .where(
        and(
          eq(snapshots.accountId, spaceId),
          inArray(snapshots.id, batchIds),
        ),
      )
      .all();

    const nextToFetch: string[] = [];

    for (const snapshot of snapshotRows) {
      reachable.add(snapshot.id);

      const parentIds = parseParentIds(snapshot.parentIds);

      for (const parentId of parentIds) {
        if (!reachable.has(parentId)) {
          nextToFetch.push(parentId);
        }
      }
    }

    toFetch = nextToFetch;
  }

  return reachable;
}

/**
 * Run garbage collection on orphaned blobs and session data.
 */
export async function runGC(
  manager: SnapshotManager,
  env: Env,
  spaceId: string,
): Promise<
  {
    deletedBlobs: number;
    deletedSnapshots: number;
    deletedSessionFiles: number;
  }
> {
  const db = getDb(env.DB);
  let deletedBlobs = 0;
  let deletedSnapshots = 0;
  let deletedSessionFiles = 0;

  // 1. Clean up session_files for merged/discarded/dead sessions
  const sessionsToClean = await db.select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.accountId, spaceId),
        inArray(sessions.status, ["merged", "discarded", "dead"]),
      ),
    )
    .all();

  if (sessionsToClean.length > 0) {
    const sessionIds = sessionsToClean.map((s) => s.id);
    const deleteResult = await db.delete(sessionFiles)
      .where(inArray(sessionFiles.sessionId, sessionIds))
      .run();
    deletedSessionFiles = deleteResult.meta.changes ?? 0;
  }

  // 2. Get hashes from running sessions (must protect these blobs)
  const runningSessions = await db.select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.accountId, spaceId),
        eq(sessions.status, "running"),
      ),
    )
    .all();

  const runningSessionIds = runningSessions.map((s) => s.id);
  const runningSessionFileRows = runningSessionIds.length > 0
    ? await db.selectDistinct({ hash: sessionFiles.hash })
      .from(sessionFiles)
      .where(inArray(sessionFiles.sessionId, runningSessionIds))
      .all()
    : [];

  const protectedHashes = new Set(runningSessionFileRows.map((f) => f.hash));

  // 3. Delete blobs with refcount <= 0 that are NOT used by running sessions
  const orphanedBlobs = await db.select({ hash: blobs.hash })
    .from(blobs)
    .where(
      and(
        eq(blobs.accountId, spaceId),
        lte(blobs.refcount, 0),
      ),
    )
    .all();

  const hashesToDelete: string[] = [];
  for (const blob of orphanedBlobs) {
    if (protectedHashes.has(blob.hash)) {
      continue;
    }
    hashesToDelete.push(blob.hash);
  }

  if (hashesToDelete.length > 0) {
    await manager.deleteBlobs(hashesToDelete);
    deletedBlobs = hashesToDelete.length;
  }

  if (hashesToDelete.length > 0) {
    await db.delete(blobs)
      .where(
        and(
          eq(blobs.accountId, spaceId),
          lte(blobs.refcount, 0),
          inArray(blobs.hash, hashesToDelete),
        ),
      )
      .run();
  }

  // 4. Build reachable snapshot set from all heads
  const workspace = await db.select({ headSnapshotId: accounts.headSnapshotId })
    .from(accounts)
    .where(eq(accounts.id, spaceId))
    .get();

  const activeSessions = await db.select({
    headSnapshotId: sessions.headSnapshotId,
    baseSnapshotId: sessions.baseSnapshotId,
  })
    .from(sessions)
    .where(
      and(
        eq(sessions.accountId, spaceId),
        inArray(sessions.status, ["running", "stopped"]),
      ),
    )
    .all();

  const headIds: string[] = [];
  if (workspace?.headSnapshotId) {
    headIds.push(workspace.headSnapshotId);
  }
  for (const session of activeSessions) {
    if (session.headSnapshotId) {
      headIds.push(session.headSnapshotId);
    }
    if (session.baseSnapshotId) {
      headIds.push(session.baseSnapshotId);
    }
  }

  const reachable = new Set<string>();
  for (const headId of headIds) {
    const reached = await getReachableSnapshots(env, spaceId, headId);
    reached.forEach((id) => reachable.add(id));
  }

  // 5. Delete merged/discarded sessions
  await db.delete(sessions)
    .where(
      and(
        eq(sessions.accountId, spaceId),
        inArray(sessions.status, ["merged", "discarded", "dead"]),
      ),
    )
    .run();

  // 6. Delete unreachable snapshots
  const allSnapshots = await db.select({
    id: snapshots.id,
    treeKey: snapshots.treeKey,
  })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.accountId, spaceId),
        eq(snapshots.status, "complete"),
      ),
    )
    .all();

  for (const s of allSnapshots) {
    if (!reachable.has(s.id)) {
      try {
        const tree = await manager.getTree(s.id);
        await manager.decreaseBlobRefcount(extractTreeHashes(tree));
      } catch {
        // Tree may already be deleted
      }

      await manager.deleteTree(s.treeKey);
      await db.delete(snapshots)
        .where(eq(snapshots.id, s.id))
        .run();

      deletedSnapshots++;
    }
  }

  // 7. Cleanup pending/failed snapshots older than 30 minutes
  await cleanupPendingSnapshots(manager, env, spaceId, 30);

  return { deletedBlobs, deletedSnapshots, deletedSessionFiles };
}
