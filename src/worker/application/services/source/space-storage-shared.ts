import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
import type { SpaceStorageFileType } from "../../../shared/types/index.ts";
import { MAX_STORAGE_MIME_TYPE_CHARACTERS } from "../../../shared/types/index.ts";
import type { SelectOf } from "../../../shared/types/drizzle-utils.ts";
import type { accountStorageFiles } from "../../../infra/db/index.ts";
import type { Database, SqlDatabaseLike } from "../../../infra/db/index.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";
import { sourceServiceDeps } from "./deps.ts";
import { type TtlSeconds, ttlSeconds } from "@takos/worker-platform-utils/ttl";

export type StorageFileRow = SelectOf<typeof accountStorageFiles>;
export type StorageUploadState = "pending" | "uploading" | "ready";

export const R2_KEY_PREFIX = "ws-storage";

/**
 * Default per-file upload cap.
 *
 * - Default: 100 MB. Keeps Worker memory and object-store costs bounded.
 * - Override via env `TAKOS_STORAGE_MAX_FILE_SIZE_BYTES` (positive integer
 *   bytes). Operators may raise it for larger media or lower it for stricter
 *   tenant policy. Invalid values fall back to the 100 MB default.
 * - Both client and server enforce this; the client cap (apps/web) is kept in
 *   sync with this constant. The server is the authoritative gate.
 */
const DEFAULT_MAX_FILE_SIZE = 100 * 1024 * 1024;

function resolveMaxFileSize(): number {
  const raw = getEnv("TAKOS_STORAGE_MAX_FILE_SIZE_BYTES")?.trim();
  if (!raw) return DEFAULT_MAX_FILE_SIZE;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_FILE_SIZE;
  return parsed;
}

export const MAX_FILE_SIZE = resolveMaxFileSize();
export const FILE_URL_EXPIRY_SECONDS: TtlSeconds = ttlSeconds(900);
export const MAX_CONTENT_SIZE = 50 * 1024 * 1024; // 50MB - safe for Worker memory
export const MAX_PATH_LENGTH = 1024;
export const MAX_LIST_ITEMS = 5000;
export const MAX_ZIP_ENTRIES = 10000;

const STORAGE_MIME_ESSENCE_PATTERN =
  /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

export function normalizeStorageMimeType(
  value: string | null | undefined,
): string | undefined {
  if (value === null || value === undefined || value.trim() === "") {
    return undefined;
  }
  const normalized = value.trim();
  if (
    normalized.length > MAX_STORAGE_MIME_TYPE_CHARACTERS ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new StorageError("Invalid Storage MIME type", "VALIDATION");
  }
  const essence = normalized.split(";", 1)[0]?.trim() ?? "";
  if (!STORAGE_MIME_ESSENCE_PATTERN.test(essence)) {
    throw new StorageError("Invalid Storage MIME type", "VALIDATION");
  }
  return normalized;
}

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
  /** Temporary authenticated API URL for the upload route. */
  upload_url: string;
  /** ISO timestamp when the upload URL stops being accepted. */
  expires_at: string;
}

export interface BulkDeleteStorageResult {
  r2Keys: string[];
  deletedCount: number;
  deletedIds: string[];
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

export function getStorageDb(d1: SqlDatabaseLike): Database {
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
