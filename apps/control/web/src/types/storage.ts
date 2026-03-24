export interface DirectoryEntry {
  name: string;
  type: 'file' | 'directory';
  path: string;
  size?: number;
  updated_at?: string;
}

export type StorageFileType = 'file' | 'folder';

export interface StorageFile {
  id: string;
  space_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  type: StorageFileType;
  size: number;
  mime_type: string | null;
  sha256: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}
