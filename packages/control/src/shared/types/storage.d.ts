export type FileOrigin = 'user' | 'ai' | 'system';
export type FileKind = 'source' | 'config' | 'doc' | 'asset' | 'artifact' | 'temp';
export type FileVisibility = 'private' | 'workspace' | 'public';
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
export type SpaceStorageFileType = 'file' | 'folder';
export interface SpaceStorageFile {
    id: string;
    space_id: string;
    parent_id: string | null;
    name: string;
    path: string;
    type: SpaceStorageFileType;
    size: number;
    mime_type: string | null;
    r2_key: string | null;
    sha256: string | null;
    uploaded_by: string | null;
    created_at: string;
    updated_at: string;
}
//# sourceMappingURL=storage.d.ts.map