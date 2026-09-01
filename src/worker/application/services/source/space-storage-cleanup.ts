import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../../shared/types/bindings.ts";
import { accountStorageFiles } from "../../../infra/db/index.ts";
import type { Database } from "../../../infra/db/index.ts";
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
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
  r2Bucket: ObjectStoreBinding,
  keys: string[],
): Promise<void> {
  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    batches.push(keys.slice(i, i + 1000));
  }
  for (const batch of batches) await r2Bucket.delete(batch);
}

const MAX_PENDING_UPLOAD_GC_BATCH_SIZE = 200;

export interface PendingStorageUploadGcSummary {
  scanned: number;
  recovered: number;
  deleted: number;
  hasMore: boolean;
}

export async function runPendingStorageUploadGcBatch(
  d1: SqlDatabaseBinding,
  r2Bucket: ObjectStoreBinding,
  options: { maxAgeMs?: number; maxRecords?: number } = {},
): Promise<PendingStorageUploadGcSummary> {
  const maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1000;
  const maxRecords = options.maxRecords ?? 100;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new Error("Pending upload GC maxAgeMs must be non-negative");
  }
  if (
    !Number.isInteger(maxRecords) || maxRecords <= 0 ||
    maxRecords > MAX_PENDING_UPLOAD_GC_BATCH_SIZE
  ) {
    throw new Error(
      `Pending upload GC maxRecords must be between 1 and ${MAX_PENDING_UPLOAD_GC_BATCH_SIZE}`,
    );
  }

  const db = getStorageDb(d1);
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const candidates = await db.select({
    id: accountStorageFiles.id,
    accountId: accountStorageFiles.accountId,
    r2Key: accountStorageFiles.r2Key,
    uploadState: accountStorageFiles.uploadState,
    updatedAt: accountStorageFiles.updatedAt,
  }).from(accountStorageFiles).where(and(
    eq(accountStorageFiles.type, "file"),
    inArray(accountStorageFiles.uploadState, ["pending", "uploading"]),
    or(
      and(
        eq(accountStorageFiles.uploadState, "pending"),
        lt(accountStorageFiles.uploadExpiresAt, cutoff),
      ),
      and(
        eq(accountStorageFiles.uploadState, "uploading"),
        lt(accountStorageFiles.updatedAt, cutoff),
      ),
    ),
  )).orderBy(
    asc(accountStorageFiles.uploadExpiresAt),
    asc(accountStorageFiles.updatedAt),
    asc(accountStorageFiles.id),
  ).limit(maxRecords + 1).all();

  const batch = candidates.slice(0, maxRecords);
  let recovered = 0;
  let deleted = 0;
  for (const candidate of batch) {
    const guard = and(
      eq(accountStorageFiles.id, candidate.id),
      eq(accountStorageFiles.accountId, candidate.accountId),
      eq(accountStorageFiles.uploadState, candidate.uploadState),
      eq(accountStorageFiles.updatedAt, candidate.updatedAt),
    );
    const object = candidate.r2Key
      ? await r2Bucket.head(candidate.r2Key)
      : null;
    if (object) {
      const restored = await db.update(accountStorageFiles).set({
        size: object.size,
        uploadState: "ready",
        uploadExpiresAt: null,
        updatedAt: new Date().toISOString(),
      }).where(guard).returning({ id: accountStorageFiles.id }).get();
      if (restored) recovered += 1;
      continue;
    }

    const removed = await db.delete(accountStorageFiles).where(guard)
      .returning({ id: accountStorageFiles.id }).get();
    if (removed) deleted += 1;
  }

  return {
    scanned: batch.length,
    recovered,
    deleted,
    hasMore: candidates.length > maxRecords,
  };
}
