/**
 * Space Storage Service
 *
 * Provides file and folder storage capabilities for spaces.
 * Uses R2 for object storage and D1 for metadata.
 */
import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { SpaceStorageFileType } from '../../../shared/types';
declare const R2_KEY_PREFIX = "ws-storage";
declare const MAX_FILE_SIZE: number;
declare const PRESIGN_EXPIRY_SECONDS = 900;
declare const MAX_CONTENT_SIZE: number;
declare const MAX_PATH_LENGTH = 1024;
declare const MAX_LIST_ITEMS = 5000;
declare const MAX_ZIP_ENTRIES = 10000;
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
export declare class StorageError extends Error {
    readonly code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION' | 'STORAGE_ERROR' | 'TOO_LARGE';
    constructor(message: string, code: 'NOT_FOUND' | 'CONFLICT' | 'VALIDATION' | 'STORAGE_ERROR' | 'TOO_LARGE');
}
export declare function escapeSqlLike(value: string): string;
export interface ListStorageFilesResult {
    files: StorageFileResponse[];
    truncated: boolean;
}
export declare function listStorageFiles(d1: D1Database, spaceId: string, parentPath?: string): Promise<ListStorageFilesResult>;
export declare function getStorageItem(d1: D1Database, spaceId: string, fileId: string): Promise<StorageFileResponse | null>;
export declare function getStorageItemByPath(d1: D1Database, spaceId: string, path: string): Promise<StorageFileResponse | null>;
export declare function createFolder(d1: D1Database, spaceId: string, userId: string, input: CreateFolderInput): Promise<StorageFileResponse>;
export declare function createFileRecord(d1: D1Database, spaceId: string, userId: string, input: CreateFileInput): Promise<{
    file: StorageFileResponse;
    r2Key: string;
}>;
export declare function confirmUpload(d1: D1Database, r2Bucket: R2Bucket, spaceId: string, fileId: string, sha256?: string): Promise<StorageFileResponse | null>;
export declare function deleteStorageItem(d1: D1Database, spaceId: string, fileId: string): Promise<string[]>;
export declare function renameStorageItem(d1: D1Database, spaceId: string, fileId: string, input: RenameInput): Promise<StorageFileResponse>;
export declare function moveStorageItem(d1: D1Database, spaceId: string, fileId: string, input: MoveInput): Promise<StorageFileResponse>;
export declare function bulkDeleteStorageItems(d1: D1Database, spaceId: string, fileIds: string[]): Promise<BulkDeleteStorageResult>;
export declare function deleteR2Objects(r2Bucket: R2Bucket, keys: string[]): Promise<void>;
export declare function detectTextFromContent(buf: ArrayBuffer): boolean;
export declare function readFileContent(d1: D1Database, r2Bucket: R2Bucket, spaceId: string, fileId: string, maxSize?: number): Promise<{
    content: string;
    encoding: 'utf-8' | 'base64';
    file: StorageFileResponse;
}>;
export declare function writeFileContent(d1: D1Database, r2Bucket: R2Bucket, spaceId: string, fileId: string, content: string, userId: string, mimeType?: string): Promise<StorageFileResponse>;
export declare function createFileWithContent(d1: D1Database, r2Bucket: R2Bucket, spaceId: string, userId: string, path: string, content: string, mimeType?: string): Promise<StorageFileResponse>;
export declare function uploadPendingFileContent(d1: D1Database, r2Bucket: R2Bucket, spaceId: string, fileId: string, content: ArrayBuffer, declaredSize: number, mimeType?: string): Promise<StorageFileResponse>;
export declare function cleanupOrphanedUploads(d1: D1Database, r2Bucket: R2Bucket, spaceId: string, maxAgeMs?: number): Promise<number>;
export { MAX_FILE_SIZE, MAX_CONTENT_SIZE, PRESIGN_EXPIRY_SECONDS, R2_KEY_PREFIX, MAX_PATH_LENGTH, MAX_LIST_ITEMS, MAX_ZIP_ENTRIES };
//# sourceMappingURL=space-storage.d.ts.map