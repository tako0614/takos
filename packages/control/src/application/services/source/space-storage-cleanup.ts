import type { D1Database, R2Bucket } from "../../../shared/types/bindings.ts";
import { accountStorageFiles } from "../../../infra/db/index.ts";
import type { Database } from "../../../infra/db/index.ts";
import { and, eq, sql } from "drizzle-orm";
import { sourceServiceDeps } from "./deps.ts";
import { getStorageDb } from "./space-storage-shared.ts";
import { buildDescendantPathPattern } from "./space-storage-paths.ts";

export async function revertParentUpdate(
  db: Database,
  spaceId: string,
  fileId: string,
  oldName: string,
  oldPath: string,
  oldParentId: string | null,
  oldTimestamp: string,
): Promise<void> {
  await db.update(accountStorageFiles)
    .set({
      name: oldName,
      path: oldPath,
      parentId: oldParentId,
      updatedAt: oldTimestamp,
    })
    .where(
      and(
        eq(accountStorageFiles.id, fileId),
        eq(accountStorageFiles.accountId, spaceId),
      ),
    );
}

export function logPathMutationRollbackFailure(
  label: "Rename" | "Move",
  error: unknown,
): void {
  sourceServiceDeps.logWarn(
    `${label} rollback of parent update failed (non-critical)`,
    {
      module: "space-storage",
      error: error instanceof Error ? error.message : String(error),
    },
  );
}

export async function listDescendantFileR2Keys(
  db: Database,
  spaceId: string,
  folderPath: string,
): Promise<string[]> {
  const descendants = await db.select({ r2Key: accountStorageFiles.r2Key })
    .from(accountStorageFiles)
    .where(
      and(
        eq(accountStorageFiles.accountId, spaceId),
        sql`${accountStorageFiles.path} LIKE ${
          buildDescendantPathPattern(folderPath)
        } ESCAPE '\\'`,
        eq(accountStorageFiles.type, "file"),
      ),
    ).all();
  return descendants
    .map((file) => file.r2Key)
    .filter((key): key is string => !!key);
}

export async function deleteStorageRowsByDescendantPath(
  db: Database,
  spaceId: string,
  folderPath: string,
): Promise<void> {
  await db.delete(accountStorageFiles).where(
    and(
      eq(accountStorageFiles.accountId, spaceId),
      sql`${accountStorageFiles.path} LIKE ${
        buildDescendantPathPattern(folderPath)
      } ESCAPE '\\'`,
    ),
  );
}

export async function deleteR2Objects(
  r2Bucket: R2Bucket,
  keys: string[],
): Promise<void> {
  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    batches.push(keys.slice(i, i + 1000));
  }
  for (const batch of batches) await r2Bucket.delete(batch);
}

const CLEANUP_BATCH_SIZE = 500;

export async function cleanupOrphanedUploads(
  d1: D1Database,
  r2Bucket: R2Bucket,
  spaceId: string,
  maxAgeMs: number = 24 * 60 * 60 * 1000,
): Promise<number> {
  const db = getStorageDb(d1);
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  let totalCleaned = 0;

  while (true) {
    const orphans = await db.select({
      id: accountStorageFiles.id,
      r2Key: accountStorageFiles.r2Key,
    })
      .from(accountStorageFiles)
      .where(and(
        eq(accountStorageFiles.accountId, spaceId),
        eq(accountStorageFiles.type, "file"),
        eq(accountStorageFiles.size, 0),
        sql`${accountStorageFiles.createdAt} < ${cutoff}`,
        sql`${accountStorageFiles.createdAt} = ${accountStorageFiles.updatedAt}`,
      )).limit(CLEANUP_BATCH_SIZE).all();

    if (orphans.length === 0) break;

    for (const orphan of orphans) {
      await db.delete(accountStorageFiles).where(
        and(
          eq(accountStorageFiles.id, orphan.id),
          eq(accountStorageFiles.accountId, spaceId),
        ),
      );
    }

    const r2Keys = orphans
      .map((orphan: { r2Key: string | null }) => orphan.r2Key)
      .filter((key: string | null): key is string => !!key);
    if (r2Keys.length > 0) {
      try {
        await deleteR2Objects(r2Bucket, r2Keys);
      } catch (err) {
        sourceServiceDeps.logWarn("R2 orphan cleanup failed (non-critical)", {
          module: "space-storage",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    totalCleaned += orphans.length;
    if (orphans.length < CLEANUP_BATCH_SIZE) break;
  }

  return totalCleaned;
}
