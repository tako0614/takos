import {
  MAX_STORAGE_CONTENT_RESPONSE_CHARACTERS,
  MAX_STORAGE_ERROR_CHARACTERS,
  MAX_STORAGE_FILES_PER_RESPONSE,
  MAX_STORAGE_ID_CHARACTERS,
  MAX_STORAGE_MIME_TYPE_CHARACTERS,
  MAX_STORAGE_NAME_CHARACTERS,
  MAX_STORAGE_PATH_CHARACTERS,
  MAX_STORAGE_TIMESTAMP_CHARACTERS,
} from "takos-api-contract/shared/types";
import type { StorageFile } from "../types/index.ts";

type StorageFileExpectation = {
  spaceId: string;
  id?: string;
  name?: string;
  parentPath?: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(
  value: unknown,
  field: string,
  maxCharacters: number,
): string {
  if (
    typeof value !== "string" || !value.trim() ||
    value.length > maxCharacters
  ) {
    throw new TypeError(`Invalid ${field}`);
  }
  return value;
}

function nullableBoundedString(
  value: unknown,
  field: string,
  maxCharacters: number,
): string | null {
  return value === null ? null : boundedString(value, field, maxCharacters);
}

function timestamp(value: unknown, field: string): string {
  const text = boundedString(value, field, MAX_STORAGE_TIMESTAMP_CHARACTERS);
  if (!Number.isFinite(Date.parse(text))) throw new TypeError(`Invalid ${field}`);
  return text;
}

function storagePath(value: unknown, field: string): string {
  const path = boundedString(value, field, MAX_STORAGE_PATH_CHARACTERS);
  if (
    !path.startsWith("/") || path.includes("//") ||
    (path.length > 1 && path.endsWith("/")) ||
    path.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new TypeError(`Invalid ${field}`);
  }
  return path;
}

function parentPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : path.slice(0, lastSlash);
}

function storageName(value: unknown): string {
  const name = boundedString(
    value,
    "Storage file name",
    MAX_STORAGE_NAME_CHARACTERS,
  );
  if (
    name !== name.trim() || name === "." || name === ".." ||
    /[\\/%]/.test(name)
  ) {
    throw new TypeError("Invalid Storage file name");
  }
  return name;
}

export function parseStorageFileRecord(
  value: unknown,
  expected: StorageFileExpectation,
): StorageFile {
  const candidate = record(value);
  if (
    !candidate || !["file", "folder"].includes(candidate.type as string) ||
    !Number.isSafeInteger(candidate.size) || (candidate.size as number) < 0
  ) {
    throw new TypeError("Invalid Storage file response");
  }
  const name = storageName(candidate.name);
  const path = storagePath(candidate.path, "Storage file path");
  const file: StorageFile = {
    id: boundedString(
      candidate.id,
      "Storage file id",
      MAX_STORAGE_ID_CHARACTERS,
    ),
    space_id: boundedString(
      candidate.space_id,
      "Storage Workspace id",
      MAX_STORAGE_ID_CHARACTERS,
    ),
    parent_id: nullableBoundedString(
      candidate.parent_id,
      "Storage parent id",
      MAX_STORAGE_ID_CHARACTERS,
    ),
    name,
    path,
    type: candidate.type as StorageFile["type"],
    size: candidate.size as number,
    mime_type: nullableBoundedString(
      candidate.mime_type,
      "Storage MIME type",
      MAX_STORAGE_MIME_TYPE_CHARACTERS,
    ),
    sha256: candidate.sha256 === null
      ? null
      : boundedString(candidate.sha256, "Storage sha256", 64),
    uploaded_by: nullableBoundedString(
      candidate.uploaded_by,
      "Storage uploader id",
      MAX_STORAGE_ID_CHARACTERS,
    ),
    created_at: timestamp(candidate.created_at, "Storage created_at"),
    updated_at: timestamp(candidate.updated_at, "Storage updated_at"),
  };
  if (file.sha256 !== null && !/^[a-f0-9]{64}$/i.test(file.sha256)) {
    throw new TypeError("Invalid Storage sha256");
  }
  if (file.path.split("/").at(-1) !== file.name) {
    throw new TypeError("Storage path does not match its name");
  }
  if (file.type === "folder" && file.size !== 0) {
    throw new TypeError("Invalid Storage folder size");
  }
  if (
    file.space_id !== expected.spaceId ||
    (expected.id !== undefined && file.id !== expected.id) ||
    (expected.name !== undefined && file.name !== expected.name) ||
    (expected.parentPath !== undefined &&
      parentPath(file.path) !== expected.parentPath)
  ) {
    throw new TypeError("Storage response does not match the request");
  }
  return file;
}

export function parseStorageListResponse(
  value: unknown,
  expected: { spaceId: string; path: string },
): { files: StorageFile[]; path: string; truncated: boolean } {
  const candidate = record(value);
  if (
    !candidate || !Array.isArray(candidate.files) ||
    candidate.files.length > MAX_STORAGE_FILES_PER_RESPONSE ||
    typeof candidate.truncated !== "boolean"
  ) {
    throw new TypeError("Invalid Storage list response");
  }
  const path = storagePath(candidate.path, "Storage list path");
  if (path !== expected.path) {
    throw new TypeError("Storage list response does not match the request");
  }
  const files = candidate.files.map((file) =>
    parseStorageFileRecord(file, {
      spaceId: expected.spaceId,
      parentPath: path,
    })
  );
  if (
    new Set(files.map((file) => file.id)).size !== files.length ||
    new Set(files.map((file) => file.path)).size !== files.length
  ) {
    throw new TypeError("Duplicate Storage file identity");
  }
  return { files, path, truncated: candidate.truncated };
}

export function parseStorageFileMutationResponse(
  value: unknown,
  expected: StorageFileExpectation & { field?: "file" | "folder" },
): StorageFile {
  const candidate = record(value);
  const field = expected.field ?? "file";
  if (!candidate || !record(candidate[field])) {
    throw new TypeError("Invalid Storage mutation response");
  }
  return parseStorageFileRecord(candidate[field], expected);
}

export function parseStorageContentResponse(
  value: unknown,
  expected: { spaceId: string; fileId: string },
): { content: string; encoding: "utf-8" | "base64"; file: StorageFile } {
  const candidate = record(value);
  if (
    !candidate || typeof candidate.content !== "string" ||
    candidate.content.length > MAX_STORAGE_CONTENT_RESPONSE_CHARACTERS ||
    !["utf-8", "base64"].includes(candidate.encoding as string)
  ) {
    throw new TypeError("Invalid Storage content response");
  }
  return {
    content: candidate.content,
    encoding: candidate.encoding as "utf-8" | "base64",
    file: parseStorageFileRecord(candidate.file, {
      spaceId: expected.spaceId,
      id: expected.fileId,
    }),
  };
}

export function parseStorageDeleteResponse(
  value: unknown,
  expectedFileId: string,
): void {
  const candidate = record(value);
  if (
    !candidate || candidate.success !== true ||
    candidate.file_id !== expectedFileId ||
    !Number.isSafeInteger(candidate.deleted_count) ||
    (candidate.deleted_count as number) < 1
  ) {
    throw new TypeError("Invalid Storage delete response");
  }
}

function safeInternalUrl(value: unknown, expectedPath: string): string {
  const text = boundedString(value, "Storage URL", MAX_STORAGE_PATH_CHARACTERS);
  const origin = globalThis.location?.origin ?? "https://takos.invalid";
  let url: URL;
  try {
    url = new URL(text, origin);
  } catch {
    throw new TypeError("Invalid Storage URL");
  }
  if (
    url.origin !== origin || url.username || url.password ||
    url.pathname !== expectedPath || url.search || url.hash
  ) {
    throw new TypeError("Unsafe Storage URL");
  }
  return text;
}

export function parseStorageUploadUrlResponse(
  value: unknown,
  expectedSpaceIdentifier: string,
): { fileId: string; uploadUrl: string; expiresAt: string } {
  const candidate = record(value);
  if (!candidate || "r2_key" in candidate) {
    throw new TypeError("Invalid Storage upload URL response");
  }
  const fileId = boundedString(
    candidate.file_id,
    "Storage upload file id",
    MAX_STORAGE_ID_CHARACTERS,
  );
  const expectedPath = `/api/spaces/${
    encodeURIComponent(expectedSpaceIdentifier)
  }/storage/upload/${encodeURIComponent(fileId)}`;
  const expiresAt = timestamp(
    candidate.expires_at,
    "Storage upload expiry",
  );
  if (Date.parse(expiresAt) <= Date.now()) {
    throw new TypeError("Expired Storage upload URL");
  }
  return {
    fileId,
    uploadUrl: safeInternalUrl(candidate.upload_url, expectedPath),
    expiresAt,
  };
}

export function buildStorageDownloadUrl(
  spaceIdentifier: string,
  fileId: string,
): string {
  const safeSpaceIdentifier = boundedString(
    spaceIdentifier,
    "Storage Workspace identifier",
    MAX_STORAGE_ID_CHARACTERS,
  );
  const safeFileId = boundedString(
    fileId,
    "Storage download file id",
    MAX_STORAGE_ID_CHARACTERS,
  );
  return `/api/spaces/${
    encodeURIComponent(safeSpaceIdentifier)
  }/storage/download/${encodeURIComponent(safeFileId)}`;
}

type BulkError = { file_id: string; error: string };

function parseBulkErrors(value: unknown): BulkError[] {
  if (!Array.isArray(value)) throw new TypeError("Invalid Storage bulk errors");
  return value.map((entry) => {
    const candidate = record(entry);
    if (!candidate) throw new TypeError("Invalid Storage bulk error");
    return {
      file_id: boundedString(
        candidate.file_id,
        "Storage bulk error file id",
        MAX_STORAGE_ID_CHARACTERS,
      ),
      error: boundedString(
        candidate.error,
        "Storage bulk error message",
        MAX_STORAGE_ERROR_CHARACTERS,
      ),
    };
  });
}

export function parseStorageBulkDeleteResponse(
  value: unknown,
  expectedFileIds: readonly string[],
): { complete: boolean } {
  const candidate = record(value);
  if (
    !candidate || candidate.success !== true ||
    !Array.isArray(candidate.deleted_ids) ||
    !Array.isArray(candidate.failed_ids) ||
    !Number.isSafeInteger(candidate.deleted_count) ||
    (candidate.deleted_count as number) < 0 ||
    !Number.isSafeInteger(candidate.error_count) ||
    (candidate.error_count as number) !== candidate.failed_ids.length
  ) {
    throw new TypeError("Invalid Storage bulk delete response");
  }
  const expected = new Set(expectedFileIds);
  const deleted = candidate.deleted_ids.map((id) =>
    boundedString(id, "Storage deleted file id", MAX_STORAGE_ID_CHARACTERS)
  );
  const failed = candidate.failed_ids.map((id) =>
    boundedString(id, "Storage failed file id", MAX_STORAGE_ID_CHARACTERS)
  );
  if (
    expected.size !== expectedFileIds.length ||
    new Set(deleted).size !== deleted.length ||
    new Set(failed).size !== failed.length ||
    candidate.deleted_count !== deleted.length ||
    deleted.length + failed.length !== expected.size ||
    [...deleted, ...failed].some((id) => !expected.has(id)) ||
    new Set([...deleted, ...failed]).size !== expected.size
  ) {
    throw new TypeError("Storage bulk delete response does not match request");
  }
  return { complete: failed.length === 0 };
}

export function parseStorageBulkMutationResponse(
  value: unknown,
  expected: {
    spaceId: string;
    fileIds: readonly string[];
    field: "moved" | "renamed";
    parentPath?: string;
    names?: ReadonlyMap<string, string>;
  },
): { complete: boolean } {
  const candidate = record(value);
  if (
    !candidate || !Array.isArray(candidate[expected.field]) ||
    !Number.isSafeInteger(candidate.success_count) ||
    !Number.isSafeInteger(candidate.error_count)
  ) {
    throw new TypeError("Invalid Storage bulk mutation response");
  }
  const expectedIds = new Set(expected.fileIds);
  if (expectedIds.size !== expected.fileIds.length) {
    throw new TypeError("Duplicate Storage bulk request identity");
  }
  const files = (candidate[expected.field] as unknown[]).map((file) => {
    const id = record(file)?.id;
    return parseStorageFileRecord(file, {
      spaceId: expected.spaceId,
      id: typeof id === "string" ? id : undefined,
      name: typeof id === "string" ? expected.names?.get(id) : undefined,
      parentPath: expected.parentPath,
    });
  });
  const errors = parseBulkErrors(candidate.errors);
  const resultIds = [...files.map((file) => file.id), ...errors.map((e) => e.file_id)];
  if (
    candidate.success_count !== files.length ||
    candidate.error_count !== errors.length ||
    new Set(resultIds).size !== resultIds.length ||
    resultIds.length !== expectedIds.size ||
    resultIds.some((id) => !expectedIds.has(id))
  ) {
    throw new TypeError("Storage bulk response does not match the request");
  }
  return { complete: errors.length === 0 };
}
