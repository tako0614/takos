import type { D1Database } from "../../../shared/types/bindings.ts";
import type { SpaceStorageFileType } from "../../../shared/types/index.ts";
import type { SelectOf } from "../../../shared/types/drizzle-utils.ts";
import type { accountStorageFiles } from "../../../infra/db/index.ts";
import type { Database } from "../../../infra/db/index.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";
import { sourceServiceDeps } from "./deps.ts";

export type StorageFileRow = SelectOf<typeof accountStorageFiles>;

export const R2_KEY_PREFIX = "ws-storage";
export const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;
export const PRESIGN_EXPIRY_SECONDS = 900;
export const MAX_CONTENT_SIZE = 50 * 1024 * 1024; // 50MB - safe for Worker memory
export const MAX_PATH_LENGTH = 1024;
export const MAX_LIST_ITEMS = 5000;
export const MAX_ZIP_ENTRIES = 10000;

export interface CreateFolderInput {
  name: string;
  parentPath?: string;
}

export interface CreateFileInput {
  name: string;
  parentPath?: string;
  size: number;
  mimeType?: string;
  sha256?: string;
}

export interface RenameInput {
  name: string;
}

export interface MoveInput {
  parentPath: string;
}

export interface StorageFileResponse {
  id: string;
  space_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  type: SpaceStorageFileType;
  size: number;
  mime_type: string | null;
  sha256: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadUrlResponse {
  file_id: string;
  upload_url: string;
  r2_key: string;
  expires_at: string;
}

export interface DownloadUrlResponse {
  download_url: string;
  expires_at: string;
}

export interface BulkDeleteStorageResult {
  r2Keys: string[];
  deletedCount: number;
  failedIds: string[];
}

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "VALIDATION"
      | "STORAGE_ERROR"
      | "TOO_LARGE",
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export function getStorageDb(d1: D1Database): Database {
  return sourceServiceDeps.getDb(d1);
}

export function toApiResponse(file: StorageFileRow): StorageFileResponse {
  return {
    id: file.id,
    space_id: file.accountId,
    parent_id: file.parentId,
    name: file.name,
    path: file.path,
    type: file.type as SpaceStorageFileType,
    size: file.size,
    mime_type: file.mimeType,
    sha256: file.sha256,
    uploaded_by: file.uploadedByAccountId ?? null,
    created_at: textDate(file.createdAt),
    updated_at: textDate(file.updatedAt),
  };
}

export function buildR2Key(spaceId: string, fileId: string): string {
  return `${R2_KEY_PREFIX}/${spaceId}/${fileId}`;
}
