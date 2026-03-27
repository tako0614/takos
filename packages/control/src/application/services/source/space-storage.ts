/**
 * Space Storage Service
 *
 * Provides file and folder storage capabilities for spaces.
 * Uses R2 for object storage and D1 for metadata.
 */

import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { SpaceStorageFileType } from '../../../shared/types';
import { getDb, accountStorageFiles } from '../../../infra/db';
import type { Database } from '../../../infra/db';
import { eq, and, desc, asc, sql } from 'drizzle-orm';
import { validatePathSegment } from '../../../shared/utils/path-validation';
import { toIsoString } from '../../../shared/utils';
import { logWarn } from '../../../shared/utils/logger';

type StorageFileRow = typeof accountStorageFiles.$inferSelect;

const R2_KEY_PREFIX = 'ws-storage';
const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024;
const PRESIGN_EXPIRY_SECONDS = 900;
const MAX_CONTENT_SIZE = 50 * 1024 * 1024; // 50MB - safe for Worker memory
const MAX_PATH_LENGTH = 1024;
const MAX_LIST_ITEMS = 5000;
const MAX_ZIP_ENTRIES = 10000;

export interface CreateFolderInput { name: string; parentPath?: string; }
export interface CreateFileInput { name: string; parentPath?: string; size: number; mimeType?: string; sha256?: string; }
export interface RenameInput { name: string; }
export interface MoveInput { parentPath: string; }

export interface StorageFileResponse {
  id: string; space_id: string; parent_id: string | null; name: string; path: string;
  type: SpaceStorageFileType; size: number; mime_type: string | null; sha256: string | null;
  uploaded_by: string | null; created_at: string; updated_at: string;
}
export interface UploadUrlResponse { file_id: string; upload_url: string; r2_key: string; expires_at: string; }
export interface DownloadUrlResponse { download_url: string; expires_at: string; }
export interface BulkDeleteStorageResult { r2Keys: string[]; deletedCount: number; failedIds: string[]; }

export class StorageError extends Error {
  constructor(message: string, public readonly code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION' | 'STORAGE_ERROR' | 'TOO_LARGE') {
    super(message);
    this.name = 'StorageError';
  }
}

function normalizePath(path: string): string {
  let normalized = path.replace(/\/+/g, '/').replace(/\/+$/, '');
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  return normalized;
}

function validateFullPath(path: string): void {
  if (path.length > MAX_PATH_LENGTH) {
    throw new StorageError(`Path too long (max ${MAX_PATH_LENGTH} characters)`, 'VALIDATION');
  }
  const segments = path.split('/').filter(Boolean);
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      throw new StorageError('Invalid path: path traversal not allowed', 'VALIDATION');
    }
  }
}

function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return '/';
  return normalized.substring(0, lastSlash);
}

function toApiResponse(file: StorageFileRow): StorageFileResponse {
  return {
    id: file.id, space_id: file.accountId, parent_id: file.parentId, name: file.name,
    path: file.path, type: file.type as SpaceStorageFileType, size: file.size,
    mime_type: file.mimeType, sha256: file.sha256, uploaded_by: file.uploadedByAccountId ?? null,
    created_at: toIsoString(file.createdAt), updated_at: toIsoString(file.updatedAt),
  };
}

function buildR2Key(spaceId: string, fileId: string): string { return `${R2_KEY_PREFIX}/${spaceId}/${fileId}`; }
function buildFullPath(parentPath: string, name: string): string { return parentPath === '/' ? `/${name}` : `${parentPath}/${name}`; }
export function escapeSqlLike(value: string): string { return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_'); }

function isUniqueConstraintError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('unique') || msg.includes('constraint');
  }
  return false;
}

async function resolveParentId(db: Database, spaceId: string, normalizedParentPath: string, errorMessage: string): Promise<string | null> {
  if (normalizedParentPath === '/') return null;
  const parent = await db.select({ id: accountStorageFiles.id }).from(accountStorageFiles)
    .where(and(eq(accountStorageFiles.accountId, spaceId), eq(accountStorageFiles.path, normalizedParentPath), eq(accountStorageFiles.type, 'folder'))).get();
  if (!parent) throw new StorageError(errorMessage, 'NOT_FOUND');
  return parent.id;
}

async function updateDescendantPaths(d1: D1Database, spaceId: string, oldPath: string, newPath: string, now: string): Promise<void> {
  const oldPfx = oldPath + '/';
  const newPfx = newPath + '/';
  await d1.prepare(`UPDATE account_storage_files SET path = ? || SUBSTR(path, ?), updated_at = ? WHERE account_id = ? AND path LIKE ? ESCAPE '\\'`)
    .bind(newPfx, oldPfx.length + 1, now, spaceId, `${escapeSqlLike(oldPfx)}%`).run();
}

async function revertParentUpdate(db: Database, spaceId: string, fileId: string, oldName: string, oldPath: string, oldParentId: string | null, oldTimestamp: string): Promise<void> {
  await db.update(accountStorageFiles)
    .set({ name: oldName, path: oldPath, parentId: oldParentId, updatedAt: oldTimestamp })
    .where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, spaceId)));
}

export interface ListStorageFilesResult { files: StorageFileResponse[]; truncated: boolean; }

export async function listStorageFiles(d1: D1Database, spaceId: string, parentPath: string = '/'): Promise<ListStorageFilesResult> {
  const db = getDb(d1);
  const normalizedPath = normalizePath(parentPath);
  let parentId: string | null = null;
  if (normalizedPath !== '/') {
    const parent = await db.select({ id: accountStorageFiles.id }).from(accountStorageFiles)
      .where(and(eq(accountStorageFiles.accountId, spaceId), eq(accountStorageFiles.path, normalizedPath), eq(accountStorageFiles.type, 'folder'))).get();
    if (!parent) return { files: [], truncated: false };
    parentId = parent.id;
  }
  const cond = parentId
    ? and(eq(accountStorageFiles.accountId, spaceId), eq(accountStorageFiles.parentId, parentId))
    : and(eq(accountStorageFiles.accountId, spaceId), sql`${accountStorageFiles.parentId} IS NULL`);
  // Fetch one extra to detect truncation
  const results = await db.select().from(accountStorageFiles).where(cond).orderBy(desc(accountStorageFiles.type), asc(accountStorageFiles.name)).limit(MAX_LIST_ITEMS + 1).all();
  const truncated = results.length > MAX_LIST_ITEMS;
  const files = (truncated ? results.slice(0, MAX_LIST_ITEMS) : results).map(toApiResponse);
  return { files, truncated };
}

export async function getStorageItem(d1: D1Database, spaceId: string, fileId: string): Promise<StorageFileResponse | null> {
  const db = getDb(d1);
  const file = await db.select().from(accountStorageFiles).where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, spaceId))).get();
  return file ? toApiResponse(file) : null;
}

export async function getStorageItemByPath(d1: D1Database, spaceId: string, path: string): Promise<StorageFileResponse | null> {
  const db = getDb(d1);
  const file = await db.select().from(accountStorageFiles).where(and(eq(accountStorageFiles.accountId, spaceId), eq(accountStorageFiles.path, normalizePath(path)))).get();
  return file ? toApiResponse(file) : null;
}

export async function createFolder(d1: D1Database, spaceId: string, userId: string, input: CreateFolderInput): Promise<StorageFileResponse> {
  const db = getDb(d1);
  const { name, parentPath = '/' } = input;
  if (!validatePathSegment(name)) throw new StorageError('Invalid folder name', 'VALIDATION');
  const normalizedParentPath = normalizePath(parentPath);
  const fullPath = buildFullPath(normalizedParentPath, name);
  validateFullPath(fullPath);
  const parentId = await resolveParentId(db, spaceId, normalizedParentPath, 'Parent folder not found');
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  try {
    await db.insert(accountStorageFiles).values({ id, accountId: spaceId, parentId, name, path: fullPath, type: 'folder', size: 0, uploadedByAccountId: userId, createdAt: timestamp, updatedAt: timestamp });
  } catch (err) {
    if (isUniqueConstraintError(err)) throw new StorageError('A file or folder with this name already exists', 'CONFLICT');
    throw err;
  }
  const created = await getStorageItem(d1, spaceId, id);
  if (!created) throw new Error('Failed to create folder');
  return created;
}

export async function createFileRecord(d1: D1Database, spaceId: string, userId: string, input: CreateFileInput): Promise<{ file: StorageFileResponse; r2Key: string }> {
  const db = getDb(d1);
  const { name, parentPath = '/', size, mimeType, sha256 } = input;
  if (!validatePathSegment(name)) throw new StorageError('Invalid file name', 'VALIDATION');
  if (size > MAX_FILE_SIZE) throw new StorageError(`File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`, 'TOO_LARGE');
  const normalizedParentPath = normalizePath(parentPath);
  const fullPath = buildFullPath(normalizedParentPath, name);
  validateFullPath(fullPath);
  const parentId = await resolveParentId(db, spaceId, normalizedParentPath, 'Parent folder not found');
  const id = crypto.randomUUID();
  const r2Key = buildR2Key(spaceId, id);
  const timestamp = new Date().toISOString();
  try {
    await db.insert(accountStorageFiles).values({ id, accountId: spaceId, parentId, name, path: fullPath, type: 'file', size, mimeType: mimeType || null, r2Key, sha256: sha256 || null, uploadedByAccountId: userId, createdAt: timestamp, updatedAt: timestamp });
  } catch (err) {
    if (isUniqueConstraintError(err)) throw new StorageError('A file or folder with this name already exists', 'CONFLICT');
    throw err;
  }
  const created = await getStorageItem(d1, spaceId, id);
  if (!created) throw new Error('Failed to create file record');
  return { file: created, r2Key };
}

export async function confirmUpload(d1: D1Database, r2Bucket: R2Bucket, spaceId: string, fileId: string, sha256?: string): Promise<StorageFileResponse | null> {
  const db = getDb(d1);
  const fileRecord = await db.select({ r2Key: accountStorageFiles.r2Key }).from(accountStorageFiles)
    .where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, spaceId), eq(accountStorageFiles.type, 'file'))).get();
  if (!fileRecord?.r2Key) return null;

  const head = await r2Bucket.head(fileRecord.r2Key);
  if (!head) {
    throw new StorageError('File content not uploaded to storage', 'STORAGE_ERROR');
  }

  const timestamp = new Date().toISOString();
  await db.update(accountStorageFiles).set({
    size: head.size,
    updatedAt: timestamp,
    ...(sha256 ? { sha256 } : {}),
  }).where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, spaceId)));
  return getStorageItem(d1, spaceId, fileId);
}

export async function deleteStorageItem(d1: D1Database, spaceId: string, fileId: string): Promise<string[]> {
  const db = getDb(d1);
  const file = await getStorageItem(d1, spaceId, fileId);
  if (!file) throw new StorageError('File or folder not found', 'NOT_FOUND');
  const r2KeysToDelete: string[] = [];
  if (file.type === 'folder') {
    const descendantPattern = `${escapeSqlLike(`${file.path}/`)}%`;
    const descendants = await db.select({ r2Key: accountStorageFiles.r2Key }).from(accountStorageFiles)
      .where(and(eq(accountStorageFiles.accountId, spaceId), sql`${accountStorageFiles.path} LIKE ${descendantPattern} ESCAPE '\\'`, eq(accountStorageFiles.type, 'file'))).all();
    for (const d of descendants) { if (d.r2Key) r2KeysToDelete.push(d.r2Key); }
    await db.delete(accountStorageFiles).where(and(eq(accountStorageFiles.accountId, spaceId), sql`${accountStorageFiles.path} LIKE ${descendantPattern} ESCAPE '\\'`));
  } else {
    const rec = await db.select({ r2Key: accountStorageFiles.r2Key }).from(accountStorageFiles).where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, spaceId))).get();
    if (rec?.r2Key) r2KeysToDelete.push(rec.r2Key);
  }
  await db.delete(accountStorageFiles).where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, spaceId)));
  return r2KeysToDelete;
}

export async function renameStorageItem(d1: D1Database, spaceId: string, fileId: string, input: RenameInput): Promise<StorageFileResponse> {
  const db = getDb(d1);
  const { name } = input;
  if (!validatePathSegment(name)) throw new StorageError('Invalid name', 'VALIDATION');
  const file = await getStorageItem(d1, spaceId, fileId);
  if (!file) throw new StorageError('File or folder not found', 'NOT_FOUND');
  const parentPath = getParentPath(file.path);
  const newPath = buildFullPath(parentPath, name);
  validateFullPath(newPath);
  const timestamp = new Date().toISOString();
  try {
    await db.update(accountStorageFiles).set({ name, path: newPath, updatedAt: timestamp }).where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, spaceId)));
  } catch (err) {
    if (isUniqueConstraintError(err)) throw new StorageError('A file or folder with this name already exists', 'CONFLICT');
    throw err;
  }
  if (file.type === 'folder') {
    try {
      await updateDescendantPaths(d1, spaceId, file.path, newPath, timestamp);
    } catch (err) {
      // Rollback parent update to keep consistency; preserve original error
      try { await revertParentUpdate(db, spaceId, fileId, file.name, file.path, file.parent_id, file.updated_at); } catch (err) { logWarn('Rename rollback of parent update failed (non-critical)', { module: 'space-storage', error: err instanceof Error ? err.message : String(err) }); }
      throw err;
    }
  }
  const updated = await getStorageItem(d1, spaceId, fileId);
  if (!updated) throw new Error('Failed to rename');
  return updated;
}

export async function moveStorageItem(d1: D1Database, spaceId: string, fileId: string, input: MoveInput): Promise<StorageFileResponse> {
  const db = getDb(d1);
  const file = await getStorageItem(d1, spaceId, fileId);
  if (!file) throw new StorageError('File or folder not found', 'NOT_FOUND');
  const normalizedParentPath = normalizePath(input.parentPath);
  validateFullPath(normalizedParentPath);
  const newPath = buildFullPath(normalizedParentPath, file.name);
  validateFullPath(newPath);
  if (file.type === 'folder' && (normalizedParentPath === file.path || normalizedParentPath.startsWith(file.path + '/'))) throw new StorageError('Cannot move a folder into itself', 'VALIDATION');
  const newParentId = await resolveParentId(db, spaceId, normalizedParentPath, 'Destination folder not found');
  const timestamp = new Date().toISOString();
  const oldPath = file.path;
  try {
    await db.update(accountStorageFiles).set({ parentId: newParentId, path: newPath, updatedAt: timestamp }).where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, spaceId)));
  } catch (err) {
    if (isUniqueConstraintError(err)) throw new StorageError('A file or folder with this name already exists', 'CONFLICT');
    throw err;
  }
  if (file.type === 'folder') {
    try {
      await updateDescendantPaths(d1, spaceId, oldPath, newPath, timestamp);
    } catch (err) {
      // Rollback parent update to keep consistency; preserve original error
      try { await revertParentUpdate(db, spaceId, fileId, file.name, file.path, file.parent_id, file.updated_at); } catch (err) { logWarn('Move rollback of parent update failed (non-critical)', { module: 'space-storage', error: err instanceof Error ? err.message : String(err) }); }
      throw err;
    }
  }
  const updated = await getStorageItem(d1, spaceId, fileId);
  if (!updated) throw new Error('Failed to move');
  return updated;
}

export async function bulkDeleteStorageItems(d1: D1Database, spaceId: string, fileIds: string[]): Promise<BulkDeleteStorageResult> {
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

export async function deleteR2Objects(r2Bucket: R2Bucket, keys: string[]): Promise<void> {
  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += 1000) batches.push(keys.slice(i, i + 1000));
  for (const batch of batches) await r2Bucket.delete(batch);
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
  return btoa(chunks.join(''));
}

export async function readFileContent(d1: D1Database, r2Bucket: R2Bucket, spaceId: string, fileId: string, maxSize: number = MAX_CONTENT_SIZE): Promise<{ content: string; encoding: 'utf-8' | 'base64'; file: StorageFileResponse }> {
  const db = getDb(d1);
  const fileRecord = await db.select().from(accountStorageFiles).where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, spaceId), eq(accountStorageFiles.type, 'file'))).get();
  if (!fileRecord) throw new StorageError('File not found', 'NOT_FOUND');
  if (!fileRecord.r2Key) throw new StorageError('File has no storage content', 'STORAGE_ERROR');
  if (fileRecord.size > maxSize) throw new StorageError(`File too large (${fileRecord.size} bytes, max ${maxSize})`, 'TOO_LARGE');
  const obj = await r2Bucket.get(fileRecord.r2Key);
  if (!obj) throw new StorageError('File content not found in storage', 'NOT_FOUND');
  const file = toApiResponse(fileRecord);
  const buf = await obj.arrayBuffer();
  if (detectTextFromContent(buf)) {
    const content = new TextDecoder().decode(buf);
    return { content, encoding: 'utf-8', file };
  }
  return { content: arrayBufferToBase64(buf), encoding: 'base64', file };
}

export async function writeFileContent(d1: D1Database, r2Bucket: R2Bucket, spaceId: string, fileId: string, content: string, userId: string, mimeType?: string): Promise<StorageFileResponse> {
  const db = getDb(d1);
  const fileRecord = await db.select().from(accountStorageFiles).where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, spaceId), eq(accountStorageFiles.type, 'file'))).get();
  if (!fileRecord) throw new StorageError('File not found', 'NOT_FOUND');
  if (!fileRecord.r2Key) throw new StorageError('File has no storage key', 'STORAGE_ERROR');
  const encoded = new TextEncoder().encode(content);
  if (encoded.length > MAX_CONTENT_SIZE) throw new StorageError(`Content too large (${encoded.length} bytes, max ${MAX_CONTENT_SIZE})`, 'TOO_LARGE');
  const resolvedMimeType = mimeType || fileRecord.mimeType || 'text/plain';
  await r2Bucket.put(fileRecord.r2Key, encoded, { httpMetadata: { contentType: resolvedMimeType } });
  const timestamp = new Date().toISOString();
  await db.update(accountStorageFiles).set({ size: encoded.length, updatedAt: timestamp, ...(mimeType ? { mimeType } : {}) }).where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, spaceId)));
  const updated = await getStorageItem(d1, spaceId, fileId);
  if (!updated) throw new Error('Failed to update file');
  return updated;
}

export async function createFileWithContent(d1: D1Database, r2Bucket: R2Bucket, spaceId: string, userId: string, path: string, content: string, mimeType?: string): Promise<StorageFileResponse> {
  const db = getDb(d1);
  const normalizedPath = normalizePath(path);
  validateFullPath(normalizedPath);
  const parts = normalizedPath.split('/').filter(Boolean);
  if (parts.length === 0) throw new StorageError('Invalid file path', 'VALIDATION');
  const fileName = parts[parts.length - 1];
  if (!validatePathSegment(fileName)) throw new StorageError('Invalid file name', 'VALIDATION');
  const parentPath = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : '/';
  const parentId = await resolveParentId(db, spaceId, parentPath, 'Parent folder not found');
  const encoded = new TextEncoder().encode(content);
  if (encoded.length > MAX_CONTENT_SIZE) throw new StorageError(`Content too large (${encoded.length} bytes, max ${MAX_CONTENT_SIZE})`, 'TOO_LARGE');
  const id = crypto.randomUUID();
  const r2Key = buildR2Key(spaceId, id);
  const timestamp = new Date().toISOString();
  const resolvedMimeType = mimeType || 'application/octet-stream';
  await r2Bucket.put(r2Key, encoded, { httpMetadata: { contentType: resolvedMimeType } });
  try {
    await db.insert(accountStorageFiles).values({ id, accountId: spaceId, parentId, name: fileName, path: normalizedPath, type: 'file', size: encoded.length, mimeType: resolvedMimeType, r2Key, uploadedByAccountId: userId, createdAt: timestamp, updatedAt: timestamp });
  } catch (err) {
    await r2Bucket.delete(r2Key);
    if (isUniqueConstraintError(err)) throw new StorageError('A file or folder with this name already exists', 'CONFLICT');
    throw err;
  }
  const created = await getStorageItem(d1, spaceId, id);
  if (!created) throw new Error('Failed to create file');
  return created;
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
  const db = getDb(d1);
  const fileRecord = await db.select().from(accountStorageFiles)
    .where(and(
      eq(accountStorageFiles.id, fileId),
      eq(accountStorageFiles.accountId, spaceId),
      eq(accountStorageFiles.type, 'file'),
    ))
    .get();

  if (!fileRecord) throw new StorageError('File not found', 'NOT_FOUND');
  if (!fileRecord.r2Key) throw new StorageError('File has no storage key', 'STORAGE_ERROR');
  if (content.byteLength <= 0) throw new StorageError('Uploaded content is empty', 'VALIDATION');
  if (content.byteLength > MAX_FILE_SIZE) {
    throw new StorageError(`File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`, 'TOO_LARGE');
  }
  // Verify actual upload size matches declared size (always check when declaredSize is set)
  if (declaredSize > 0 && content.byteLength !== declaredSize) {
    throw new StorageError(`Upload size mismatch: declared ${declaredSize} bytes but received ${content.byteLength} bytes`, 'VALIDATION');
  }

  const resolvedMimeType = mimeType || fileRecord.mimeType || 'application/octet-stream';
  await r2Bucket.put(fileRecord.r2Key, content, {
    httpMetadata: { contentType: resolvedMimeType },
  });

  const timestamp = new Date().toISOString();
  await db.update(accountStorageFiles)
    .set({
      size: content.byteLength,
      mimeType: resolvedMimeType,
      updatedAt: timestamp,
    })
    .where(and(eq(accountStorageFiles.id, fileId), eq(accountStorageFiles.accountId, spaceId)));

  const updated = await getStorageItem(d1, spaceId, fileId);
  if (!updated) throw new Error('Failed to update file');
  return updated;
}

const CLEANUP_BATCH_SIZE = 500;

export async function cleanupOrphanedUploads(d1: D1Database, r2Bucket: R2Bucket, spaceId: string, maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
  const db = getDb(d1);
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  let totalCleaned = 0;

  // Process in batches to avoid unbounded memory usage
  while (true) {
    const orphans = await db.select({ id: accountStorageFiles.id, r2Key: accountStorageFiles.r2Key })
      .from(accountStorageFiles)
      .where(and(
        eq(accountStorageFiles.accountId, spaceId),
        eq(accountStorageFiles.type, 'file'),
        eq(accountStorageFiles.size, 0),
        sql`${accountStorageFiles.createdAt} < ${cutoff}`,
        sql`${accountStorageFiles.createdAt} = ${accountStorageFiles.updatedAt}`,
      )).limit(CLEANUP_BATCH_SIZE).all();

    if (orphans.length === 0) break;

    // Delete DB records first (source of truth), then clean up R2 (best-effort)
    for (const orphan of orphans) {
      await db.delete(accountStorageFiles).where(and(eq(accountStorageFiles.id, orphan.id), eq(accountStorageFiles.accountId, spaceId)));
    }

    const r2Keys = orphans.map(o => o.r2Key).filter((k): k is string => !!k);
    if (r2Keys.length > 0) {
      try { await deleteR2Objects(r2Bucket, r2Keys); } catch (err) { logWarn('R2 orphan cleanup failed (non-critical)', { module: 'space-storage', error: err instanceof Error ? err.message : String(err) }); }
    }

    totalCleaned += orphans.length;
    if (orphans.length < CLEANUP_BATCH_SIZE) break;
  }

  return totalCleaned;
}

export { MAX_FILE_SIZE, MAX_CONTENT_SIZE, PRESIGN_EXPIRY_SECONDS, R2_KEY_PREFIX, MAX_PATH_LENGTH, MAX_LIST_ITEMS, MAX_ZIP_ENTRIES };
