import type { D1Database, R2Bucket } from "../../../shared/types/bindings.ts";
import { accountStorageFiles } from "../../../infra/db/index.ts";
import {
  buildR2Key,
  getStorageDb,
  MAX_CONTENT_SIZE,
  MAX_FILE_SIZE,
  StorageError,
  type StorageFileResponse,
  toApiResponse,
} from "./space-storage-shared.ts";
import { resolveStorageFileCreationPath } from "./space-storage-paths.ts";
import {
  findStorageRowById,
  loadStorageItemResponse,
  requireStorageFileRowById,
  resolveStorageParentContext,
  updateStoredFileMetadata,
  withStorageConflict,
} from "./space-storage-metadata.ts";

function encodeTextContent(content: string): Uint8Array {
  const encoded = new TextEncoder().encode(content);
  if (encoded.length > MAX_CONTENT_SIZE) {
    throw new StorageError(
      `Content too large (${encoded.length} bytes, max ${MAX_CONTENT_SIZE})`,
      "TOO_LARGE",
    );
  }
  return encoded;
}

export function detectTextFromContent(buf: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, 8192));
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return false;
  }
  return true;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 8192;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    chunks.push(String.fromCharCode(...slice));
  }
  return btoa(chunks.join(""));
}

export async function confirmUpload(
  d1: D1Database,
  r2Bucket: R2Bucket,
  spaceId: string,
  fileId: string,
  sha256?: string,
): Promise<StorageFileResponse | null> {
  const db = getStorageDb(d1);
  const fileRecord = await findStorageRowById(db, spaceId, fileId, {
    type: "file",
  });
  if (!fileRecord?.r2Key) return null;

  const head = await r2Bucket.head(fileRecord.r2Key);
  if (!head) {
    throw new StorageError(
      "File content not uploaded to storage",
      "STORAGE_ERROR",
    );
  }

  return await updateStoredFileMetadata(d1, spaceId, fileId, {
    size: head.size,
    ...(sha256 ? { sha256 } : {}),
  });
}

export async function readFileContent(
  d1: D1Database,
  r2Bucket: R2Bucket,
  spaceId: string,
  fileId: string,
  maxSize: number = MAX_CONTENT_SIZE,
): Promise<
  { content: string; encoding: "utf-8" | "base64"; file: StorageFileResponse }
> {
  const db = getStorageDb(d1);
  const fileRecord = await requireStorageFileRowById(db, spaceId, fileId, {
    notFoundMessage: "File not found",
    missingContentMessage: "File has no storage content",
  });
  if (fileRecord.size > maxSize) {
    throw new StorageError(
      `File too large (${fileRecord.size} bytes, max ${maxSize})`,
      "TOO_LARGE",
    );
  }
  const obj = await r2Bucket.get(fileRecord.r2Key);
  if (!obj) {
    throw new StorageError("File content not found in storage", "NOT_FOUND");
  }
  const file = toApiResponse(fileRecord);
  const buf = await obj.arrayBuffer();
  if (detectTextFromContent(buf)) {
    return {
      content: new TextDecoder().decode(buf),
      encoding: "utf-8",
      file,
    };
  }
  return { content: arrayBufferToBase64(buf), encoding: "base64", file };
}

export async function writeFileContent(
  d1: D1Database,
  r2Bucket: R2Bucket,
  spaceId: string,
  fileId: string,
  content: string,
  _userId: string,
  mimeType?: string,
): Promise<StorageFileResponse> {
  const db = getStorageDb(d1);
  const fileRecord = await requireStorageFileRowById(db, spaceId, fileId, {
    notFoundMessage: "File not found",
    missingContentMessage: "File has no storage key",
  });
  const encoded = encodeTextContent(content);
  const resolvedMimeType = mimeType || fileRecord.mimeType || "text/plain";
  await r2Bucket.put(fileRecord.r2Key, encoded, {
    httpMetadata: { contentType: resolvedMimeType },
  });
  return await updateStoredFileMetadata(d1, spaceId, fileId, {
    size: encoded.length,
    ...(mimeType ? { mimeType } : {}),
  });
}

export async function createFileWithContent(
  d1: D1Database,
  r2Bucket: R2Bucket,
  spaceId: string,
  userId: string,
  path: string,
  content: string,
  mimeType?: string,
): Promise<StorageFileResponse> {
  const db = getStorageDb(d1);
  const { name, normalizedPath, parentPath } = resolveStorageFileCreationPath(
    path,
  );
  const { parentId } = await resolveStorageParentContext(
    db,
    spaceId,
    parentPath,
    "Parent folder not found",
  );
  const encoded = encodeTextContent(content);
  const id = crypto.randomUUID();
  const r2Key = buildR2Key(spaceId, id);
  const timestamp = new Date().toISOString();
  const resolvedMimeType = mimeType || "application/octet-stream";
  await r2Bucket.put(r2Key, encoded, {
    httpMetadata: { contentType: resolvedMimeType },
  });
  try {
    await withStorageConflict(async () => {
      await db.insert(accountStorageFiles).values({
        id,
        accountId: spaceId,
        parentId,
        name,
        path: normalizedPath,
        type: "file",
        size: encoded.length,
        mimeType: resolvedMimeType,
        r2Key,
        uploadedByAccountId: userId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
  } catch (err) {
    await r2Bucket.delete(r2Key);
    throw err;
  }
  return await loadStorageItemResponse(d1, spaceId, id);
}

export async function uploadPendingFileContent(
  d1: D1Database,
  r2Bucket: R2Bucket,
  spaceId: string,
  fileId: string,
  content: ArrayBuffer,
  declaredSize: number,
  mimeType?: string,
): Promise<StorageFileResponse> {
  const db = getStorageDb(d1);
  const fileRecord = await requireStorageFileRowById(db, spaceId, fileId, {
    notFoundMessage: "File not found",
    missingContentMessage: "File has no storage key",
  });
  if (content.byteLength <= 0) {
    throw new StorageError("Uploaded content is empty", "VALIDATION");
  }
  if (content.byteLength > MAX_FILE_SIZE) {
    throw new StorageError(
      `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      "TOO_LARGE",
    );
  }
  if (declaredSize > 0 && content.byteLength !== declaredSize) {
    throw new StorageError(
      `Upload size mismatch: declared ${declaredSize} bytes but received ${content.byteLength} bytes`,
      "VALIDATION",
    );
  }

  const resolvedMimeType = mimeType || fileRecord.mimeType ||
    "application/octet-stream";
  await r2Bucket.put(fileRecord.r2Key, content, {
    httpMetadata: { contentType: resolvedMimeType },
  });
  return await updateStoredFileMetadata(d1, spaceId, fileId, {
    size: content.byteLength,
    mimeType: resolvedMimeType,
  });
}
