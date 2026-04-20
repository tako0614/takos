/**
 * Space Storage Service
 *
 * Provides file and folder storage capabilities for spaces.
 * Uses R2 for object storage and D1 for metadata.
 */

import type { D1Database } from "../../../shared/types/bindings.ts";
import { accountStorageFiles } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import {
  cleanupOrphanedUploads,
  deleteR2Objects,
  deleteStorageRowsByDescendantPath,
  listDescendantFileR2Keys,
} from "./space-storage-cleanup.ts";
import {
  confirmUpload,
  createFileWithContent,
  detectTextFromContent,
  readFileContent,
  uploadPendingFileContent,
  writeFileContent,
} from "./space-storage-content.ts";
import {
  findStorageFileR2KeyById,
  getStorageItem,
  getStorageItemByPath,
  listStorageFiles,
  type ListStorageFilesResult,
  loadStorageItemResponse,
  requireStorageItemResponse,
  resolveStorageCreateContext,
  resolveStorageParentContext,
  withStorageConflict,
} from "./space-storage-metadata.ts";
import {
  buildFullPath,
  ensureValidStorageName,
  escapeSqlLike,
  getParentPath,
  validateFullPath,
} from "./space-storage-paths.ts";
import { applyStoragePathMutation } from "./space-storage-tree.ts";
import {
  buildR2Key,
  type BulkDeleteStorageResult,
  type CreateFileInput,
  type CreateFolderInput,
  type DownloadUrlResponse,
  FILE_URL_EXPIRY_SECONDS,
  getStorageDb,
  MAX_CONTENT_SIZE,
  MAX_FILE_SIZE,
  MAX_LIST_ITEMS,
  MAX_PATH_LENGTH,
  MAX_ZIP_ENTRIES,
  type MoveInput,
  R2_KEY_PREFIX,
  type RenameInput,
  StorageError,
  type StorageFileResponse,
  type UploadUrlResponse,
} from "./space-storage-shared.ts";

export async function createFolder(
  d1: D1Database,
  spaceId: string,
  userId: string,
  input: CreateFolderInput,
): Promise<StorageFileResponse> {
  const db = getStorageDb(d1);
  const { name, parentId, path } = await resolveStorageCreateContext(
    db,
    spaceId,
    input,
    {
      invalidNameMessage: "Invalid folder name",
      missingParentMessage: "Parent folder not found",
    },
  );
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  await withStorageConflict(async () => {
    await db.insert(accountStorageFiles).values({
      id,
      accountId: spaceId,
      parentId,
      name,
      path,
      type: "folder",
      size: 0,
      uploadedByAccountId: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
  return await loadStorageItemResponse(d1, spaceId, id);
}

export async function createFileRecord(
  d1: D1Database,
  spaceId: string,
  userId: string,
  input: CreateFileInput,
): Promise<{ file: StorageFileResponse; r2Key: string }> {
  const db = getStorageDb(d1);
  const { size, mimeType, sha256 } = input;
  if (size > MAX_FILE_SIZE) {
    throw new StorageError(
      `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      "TOO_LARGE",
    );
  }
  const { name, parentId, path } = await resolveStorageCreateContext(
    db,
    spaceId,
    input,
    {
      invalidNameMessage: "Invalid file name",
      missingParentMessage: "Parent folder not found",
    },
  );
  const id = crypto.randomUUID();
  const r2Key = buildR2Key(spaceId, id);
  const timestamp = new Date().toISOString();
  await withStorageConflict(async () => {
    await db.insert(accountStorageFiles).values({
      id,
      accountId: spaceId,
      parentId,
      name,
      path,
      type: "file",
      size,
      mimeType: mimeType || null,
      r2Key,
      sha256: sha256 || null,
      uploadedByAccountId: userId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
  return { file: await loadStorageItemResponse(d1, spaceId, id), r2Key };
}

export async function deleteStorageItem(
  d1: D1Database,
  spaceId: string,
  fileId: string,
): Promise<string[]> {
  const db = getStorageDb(d1);
  const file = await requireStorageItemResponse(d1, spaceId, fileId);
  const r2KeysToDelete: string[] = [];
  if (file.type === "folder") {
    r2KeysToDelete.push(
      ...(await listDescendantFileR2Keys(db, spaceId, file.path)),
    );
    await deleteStorageRowsByDescendantPath(db, spaceId, file.path);
  } else {
    const r2Key = await findStorageFileR2KeyById(db, spaceId, fileId);
    if (r2Key) r2KeysToDelete.push(r2Key);
  }
  await db.delete(accountStorageFiles).where(
    and(
      eq(accountStorageFiles.id, fileId),
      eq(accountStorageFiles.accountId, spaceId),
    ),
  );
  return r2KeysToDelete;
}

export async function renameStorageItem(
  d1: D1Database,
  spaceId: string,
  fileId: string,
  input: RenameInput,
): Promise<StorageFileResponse> {
  const { name } = input;
  ensureValidStorageName(name, "Invalid name");
  const file = await requireStorageItemResponse(d1, spaceId, fileId);
  const parentPath = getParentPath(file.path);
  const newPath = buildFullPath(parentPath, name);
  validateFullPath(newPath);
  return await applyStoragePathMutation(d1, spaceId, file, {
    name,
    path: newPath,
    parentId: file.parent_id,
    rollbackLabel: "Rename",
  });
}

export async function moveStorageItem(
  d1: D1Database,
  spaceId: string,
  fileId: string,
  input: MoveInput,
): Promise<StorageFileResponse> {
  const db = getStorageDb(d1);
  const file = await requireStorageItemResponse(d1, spaceId, fileId);
  const { normalizedParentPath, parentId: newParentId } =
    await resolveStorageParentContext(
      db,
      spaceId,
      input.parentPath,
      "Destination folder not found",
    );
  const newPath = buildFullPath(normalizedParentPath, file.name);
  validateFullPath(newPath);
  if (
    file.type === "folder" &&
    (normalizedParentPath === file.path ||
      normalizedParentPath.startsWith(`${file.path}/`))
  ) {
    throw new StorageError("Cannot move a folder into itself", "VALIDATION");
  }
  return await applyStoragePathMutation(d1, spaceId, file, {
    name: file.name,
    path: newPath,
    parentId: newParentId,
    rollbackLabel: "Move",
  });
}

export async function moveAndRenameStorageItem(
  d1: D1Database,
  spaceId: string,
  fileId: string,
  input: { parentPath: string; name: string },
): Promise<StorageFileResponse> {
  const db = getStorageDb(d1);
  const file = await requireStorageItemResponse(d1, spaceId, fileId);
  const name = ensureValidStorageName(input.name, "Invalid name");
  const { normalizedParentPath, parentId } = await resolveStorageParentContext(
    db,
    spaceId,
    input.parentPath,
    "Destination folder not found",
  );
  const path = buildFullPath(normalizedParentPath, name);
  validateFullPath(path);
  if (
    file.type === "folder" &&
    (normalizedParentPath === file.path ||
      normalizedParentPath.startsWith(`${file.path}/`))
  ) {
    throw new StorageError("Cannot move a folder into itself", "VALIDATION");
  }
  return await applyStoragePathMutation(d1, spaceId, file, {
    name,
    path,
    parentId,
    rollbackLabel: "Move",
  });
}

export async function bulkDeleteStorageItems(
  d1: D1Database,
  spaceId: string,
  fileIds: string[],
): Promise<BulkDeleteStorageResult> {
  const allR2Keys: string[] = [];
  const failedIds: string[] = [];
  let deletedCount = 0;
  for (const fileId of fileIds) {
    try {
      const keys = await deleteStorageItem(d1, spaceId, fileId);
      allR2Keys.push(...keys);
      deletedCount += 1;
    } catch {
      failedIds.push(fileId);
    }
  }
  return { r2Keys: allR2Keys, deletedCount, failedIds };
}

export {
  cleanupOrphanedUploads,
  confirmUpload,
  createFileWithContent,
  deleteR2Objects,
  detectTextFromContent,
  escapeSqlLike,
  getStorageItem,
  getStorageItemByPath,
  listStorageFiles,
  readFileContent,
  uploadPendingFileContent,
  writeFileContent,
};

export {
  FILE_URL_EXPIRY_SECONDS,
  MAX_CONTENT_SIZE,
  MAX_FILE_SIZE,
  MAX_LIST_ITEMS,
  MAX_PATH_LENGTH,
  MAX_ZIP_ENTRIES,
  R2_KEY_PREFIX,
  StorageError,
};

export type {
  BulkDeleteStorageResult,
  CreateFileInput,
  CreateFolderInput,
  DownloadUrlResponse,
  ListStorageFilesResult,
  MoveInput,
  RenameInput,
  StorageFileResponse,
  UploadUrlResponse,
};
