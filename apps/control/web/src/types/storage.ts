// Re-export types from backend shared models to avoid duplication.
import type { SpaceStorageFile, SpaceStorageFileType } from '@takos/control/shared/types';

/** Frontend-only: directory listing entry used by the storage browser. */
export interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size?: number;
  updated_at?: string;
}

export type StorageFileType = SpaceStorageFileType;

/**
 * Frontend StorageFile: omits the internal `r2_key` field from the backend
 * SpaceStorageFile since it's not exposed via the API.
 */
export type StorageFile = Omit<SpaceStorageFile, 'r2_key'>;
