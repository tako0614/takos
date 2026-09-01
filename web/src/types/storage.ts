// Re-export types from backend shared models to avoid duplication.
import type {
  SpaceStorageFile,
  SpaceStorageFileType,
} from "takos-api-contract/shared/types";

/** Frontend-only: directory listing entry used by the storage browser. */
export interface DirectoryEntry {
  name: string;
  type: "file" | "directory";
  path: string;
  size?: number;
  updated_at?: string;
}

export type StorageFileType = SpaceStorageFileType;

/** Public Storage file projection; object-store keys never cross this type. */
export type StorageFile = SpaceStorageFile;
