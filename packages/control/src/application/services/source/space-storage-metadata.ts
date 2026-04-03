import type { D1Database } from "../../../shared/types/bindings.ts";
import type { SpaceStorageFileType } from "../../../shared/types/index.ts";
import { accountStorageFiles } from "../../../infra/db/index.ts";
import type { Database } from "../../../infra/db/index.ts";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  getStorageDb,
  MAX_LIST_ITEMS,
  StorageError,
  type StorageFileResponse,
  type StorageFileRow,
  toApiResponse,
} from "./space-storage-shared.ts";
import {
  normalizePath,
  prepareStorageChildPath,
  validateFullPath,
} from "./space-storage-paths.ts";

function isUniqueConstraintError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes("unique") || msg.includes("constraint");
  }
  return false;
}

export async function withStorageConflict<T>(
  operation: () => Promise<T>,
  message: string = "A file or folder with this name already exists",
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      throw new StorageError(message, "CONFLICT");
    }
    throw err;
  }
}

async function resolveParentId(
  db: Database,
  spaceId: string,
  normalizedParentPath: string,
  errorMessage: string,
): Promise<string | null> {
  if (normalizedParentPath === "/") return null;
  const parent = await db.select({ id: accountStorageFiles.id }).from(
    accountStorageFiles,
  )
    .where(
      and(
        eq(accountStorageFiles.accountId, spaceId),
        eq(accountStorageFiles.path, normalizedParentPath),
        eq(accountStorageFiles.type, "folder"),
      ),
    ).get();
  if (!parent) throw new StorageError(errorMessage, "NOT_FOUND");
  return parent.id;
}

export async function resolveStorageParentContext(
  db: Database,
  spaceId: string,
  parentPath: string,
  errorMessage: string,
): Promise<{ normalizedParentPath: string; parentId: string | null }> {
  const normalizedParentPath = normalizePath(parentPath);
  validateFullPath(normalizedParentPath);
  const parentId = await resolveParentId(
    db,
    spaceId,
    normalizedParentPath,
    errorMessage,
  );
  return { normalizedParentPath, parentId };
}

export async function resolveStorageCreateContext(
  db: Database,
  spaceId: string,
  input: { name: string; parentPath?: string },
  errors: {
    invalidNameMessage: string;
    missingParentMessage: string;
  },
): Promise<{ name: string; parentId: string | null; path: string }> {
  const { parentPath, fullPath } = prepareStorageChildPath(
    input.name,
    input.parentPath,
    errors.invalidNameMessage,
  );
  const { parentId } = await resolveStorageParentContext(
    db,
    spaceId,
    parentPath,
    errors.missingParentMessage,
  );
  return { name: input.name, parentId, path: fullPath };
}

export async function findStorageRowById(
  db: Database,
  spaceId: string,
  fileId: string,
  options?: { type?: SpaceStorageFileType },
): Promise<StorageFileRow | null> {
  return await db.select().from(accountStorageFiles).where(
    and(
      eq(accountStorageFiles.id, fileId),
      eq(accountStorageFiles.accountId, spaceId),
      ...(options?.type ? [eq(accountStorageFiles.type, options.type)] : []),
    ),
  ).get() ?? null;
}

export async function findStorageRowByPath(
  db: Database,
  spaceId: string,
  filePath: string,
  options?: { type?: SpaceStorageFileType },
): Promise<StorageFileRow | null> {
  return await db.select().from(accountStorageFiles).where(
    and(
      eq(accountStorageFiles.accountId, spaceId),
      eq(accountStorageFiles.path, normalizePath(filePath)),
      ...(options?.type ? [eq(accountStorageFiles.type, options.type)] : []),
    ),
  ).get() ?? null;
}

export async function requireStorageRowById(
  db: Database,
  spaceId: string,
  fileId: string,
  options?: {
    type?: SpaceStorageFileType;
    notFoundMessage?: string;
    missingContentMessage?: string;
  },
): Promise<StorageFileRow> {
  const row = await findStorageRowById(db, spaceId, fileId, options);
  if (!row) {
    throw new StorageError(
      options?.notFoundMessage ?? "File or folder not found",
      "NOT_FOUND",
    );
  }
  if (options?.type === "file" && !row.r2Key) {
    throw new StorageError(
      options.missingContentMessage ?? "File has no storage key",
      "STORAGE_ERROR",
    );
  }
  return row;
}

export async function requireStorageFileRowById(
  db: Database,
  spaceId: string,
  fileId: string,
  options?: {
    notFoundMessage?: string;
    missingContentMessage?: string;
  },
): Promise<StorageFileRow & { r2Key: string }> {
  const row = await requireStorageRowById(db, spaceId, fileId, {
    type: "file",
    ...options,
  });
  if (!row.r2Key) {
    throw new StorageError(
      options?.missingContentMessage ?? "File has no storage key",
      "STORAGE_ERROR",
    );
  }
  return row as StorageFileRow & { r2Key: string };
}

export interface ListStorageFilesResult {
  files: StorageFileResponse[];
  truncated: boolean;
}

export async function listStorageFiles(
  d1: D1Database,
  spaceId: string,
  parentPath: string = "/",
): Promise<ListStorageFilesResult> {
  const db = getStorageDb(d1);
  const normalizedPath = normalizePath(parentPath);
  let parentId: string | null = null;
  if (normalizedPath !== "/") {
    const parent = await findStorageRowByPath(db, spaceId, normalizedPath, {
      type: "folder",
    });
    if (!parent) return { files: [], truncated: false };
    parentId = parent.id;
  }
  const cond = parentId
    ? and(
      eq(accountStorageFiles.accountId, spaceId),
      eq(accountStorageFiles.parentId, parentId),
    )
    : and(
      eq(accountStorageFiles.accountId, spaceId),
      sql`${accountStorageFiles.parentId} IS NULL`,
    );
  const results = await db.select().from(accountStorageFiles).where(cond)
    .orderBy(desc(accountStorageFiles.type), asc(accountStorageFiles.name))
    .limit(MAX_LIST_ITEMS + 1).all();
  const truncated = results.length > MAX_LIST_ITEMS;
  return {
    files: (truncated ? results.slice(0, MAX_LIST_ITEMS) : results).map(
      toApiResponse,
    ),
    truncated,
  };
}

export async function getStorageItem(
  d1: D1Database,
  spaceId: string,
  fileId: string,
): Promise<StorageFileResponse | null> {
  const db = getStorageDb(d1);
  const file = await findStorageRowById(db, spaceId, fileId);
  return file ? toApiResponse(file) : null;
}

export async function getStorageItemByPath(
  d1: D1Database,
  spaceId: string,
  path: string,
): Promise<StorageFileResponse | null> {
  const db = getStorageDb(d1);
  const file = await findStorageRowByPath(db, spaceId, path);
  return file ? toApiResponse(file) : null;
}

export async function loadStorageItemResponse(
  d1: D1Database,
  spaceId: string,
  fileId: string,
): Promise<StorageFileResponse> {
  const item = await getStorageItem(d1, spaceId, fileId);
  if (!item) throw new Error("Failed to load storage item");
  return item;
}

export async function requireStorageItemResponse(
  d1: D1Database,
  spaceId: string,
  fileId: string,
  notFoundMessage: string = "File or folder not found",
): Promise<StorageFileResponse> {
  const item = await getStorageItem(d1, spaceId, fileId);
  if (!item) throw new StorageError(notFoundMessage, "NOT_FOUND");
  return item;
}

export async function updateStoredFileMetadata(
  d1: D1Database,
  spaceId: string,
  fileId: string,
  updates: {
    size?: number;
    sha256?: string;
    mimeType?: string;
  },
): Promise<StorageFileResponse> {
  const db = getStorageDb(d1);
  await db.update(accountStorageFiles).set({
    ...(typeof updates.size === "number" ? { size: updates.size } : {}),
    ...(updates.sha256 ? { sha256: updates.sha256 } : {}),
    ...(updates.mimeType ? { mimeType: updates.mimeType } : {}),
    updatedAt: new Date().toISOString(),
  }).where(
    and(
      eq(accountStorageFiles.id, fileId),
      eq(accountStorageFiles.accountId, spaceId),
    ),
  );
  return await loadStorageItemResponse(d1, spaceId, fileId);
}

export async function findStorageFileR2KeyById(
  db: Database,
  spaceId: string,
  fileId: string,
): Promise<string | null> {
  const file = await findStorageRowById(db, spaceId, fileId, { type: "file" });
  return file?.r2Key ?? null;
}
