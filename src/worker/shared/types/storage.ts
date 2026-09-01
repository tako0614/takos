export type FileOrigin = "user" | "ai" | "system";
export type FileKind =
  | "source"
  | "config"
  | "doc"
  | "asset"
  | "artifact"
  | "temp";
export type FileVisibility = "private" | "workspace" | "public";

export interface SpaceFile {
  id: string;
  space_id: string;
  path: string;
  sha256: string | null;
  mime_type: string | null;
  size: number;
  origin: FileOrigin;
  kind: FileKind;
  visibility?: FileVisibility;
  indexed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type SpaceStorageFileType = "file" | "folder";

export const MAX_STORAGE_ID_CHARACTERS = 128;
export const MAX_STORAGE_NAME_CHARACTERS = 255;
export const MAX_STORAGE_PATH_CHARACTERS = 1024;
export const MAX_STORAGE_MIME_TYPE_CHARACTERS = 255;
export const MAX_STORAGE_TIMESTAMP_CHARACTERS = 64;
export const MAX_STORAGE_FILES_PER_RESPONSE = 5000;
export const MAX_STORAGE_BULK_OPERATION_ITEMS = 200;
export const MAX_STORAGE_ERROR_CHARACTERS = 2000;
export const MAX_STORAGE_CONTENT_RESPONSE_CHARACTERS = 70 * 1024 * 1024;

export interface SpaceStorageFile {
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
