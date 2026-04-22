/** A file entry used for session init and repo file transfer. */
export interface SessionFileEntry {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
  is_binary?: boolean;
}

/** Shared result type for sync operations. */
export interface SyncResult {
  success: boolean;
  committed: boolean;
  commitHash?: string;
  pushed: boolean;
  error?: string;
}

export interface SessionRepoMount {
  repoId: string;
  repoName: string;
  branch?: string;
  mountPath?: string;
}

export interface SessionSnapshot {
  files: Array<{
    path: string;
    content: string;
    size: number;
    is_binary?: boolean;
    encoding?: "utf-8" | "base64";
  }>;
  file_count: number;
  total_size?: number;
}
