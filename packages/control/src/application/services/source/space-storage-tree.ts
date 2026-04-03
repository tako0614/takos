import type { D1Database } from "../../../shared/types/bindings.ts";
import { accountStorageFiles } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import {
  getStorageDb,
  type StorageFileResponse,
} from "./space-storage-shared.ts";
import { escapeSqlLike } from "./space-storage-paths.ts";
import {
  loadStorageItemResponse,
  withStorageConflict,
} from "./space-storage-metadata.ts";
import {
  logPathMutationRollbackFailure,
  revertParentUpdate,
} from "./space-storage-cleanup.ts";

async function updateDescendantPaths(
  d1: D1Database,
  spaceId: string,
  oldPath: string,
  newPath: string,
  now: string,
): Promise<void> {
  const oldPrefix = `${oldPath}/`;
  const newPrefix = `${newPath}/`;
  await d1.prepare(
    `UPDATE account_storage_files SET path = ? || SUBSTR(path, ?), updated_at = ? WHERE account_id = ? AND path LIKE ? ESCAPE '\\'`,
  )
    .bind(
      newPrefix,
      oldPrefix.length + 1,
      now,
      spaceId,
      `${escapeSqlLike(oldPrefix)}%`,
    )
    .run();
}

export async function applyStoragePathMutation(
  d1: D1Database,
  spaceId: string,
  file: StorageFileResponse,
  input: {
    name: string;
    path: string;
    parentId: string | null;
    rollbackLabel: "Rename" | "Move";
  },
): Promise<StorageFileResponse> {
  const db = getStorageDb(d1);
  const timestamp = new Date().toISOString();
  await withStorageConflict(async () => {
    await db.update(accountStorageFiles).set({
      name: input.name,
      parentId: input.parentId,
      path: input.path,
      updatedAt: timestamp,
    }).where(
      and(
        eq(accountStorageFiles.id, file.id),
        eq(accountStorageFiles.accountId, spaceId),
      ),
    );
  });

  if (file.type === "folder") {
    try {
      await updateDescendantPaths(
        d1,
        spaceId,
        file.path,
        input.path,
        timestamp,
      );
    } catch (err) {
      try {
        await revertParentUpdate(
          db,
          spaceId,
          file.id,
          file.name,
          file.path,
          file.parent_id,
          file.updated_at,
        );
      } catch (rollbackError) {
        logPathMutationRollbackFailure(input.rollbackLabel, rollbackError);
      }
      throw err;
    }
  }

  return await loadStorageItemResponse(d1, spaceId, file.id);
}
