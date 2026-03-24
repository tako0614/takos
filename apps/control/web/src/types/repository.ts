export interface Repository {
  id: string;
  space_id: string;
  name: string;
  description: string | null;
  visibility: 'public' | 'private';
  default_branch: string;
  stars: number;
  forks: number;
  is_starred?: boolean;
  forked_from_id?: string | null;
  forked_from?: {
    id: string;
    name: string;
    space_id: string;
    owner_username?: string;
    owner_name?: string;
  } | null;
  owner_username?: string;
  owner_name?: string;
  watchers_count?: number;
  language?: string;
  homepage?: string;
  topics?: string[];
  created_at: string;
  updated_at: string;
}

export interface SyncStatus {
  can_sync: boolean;
  can_fast_forward: boolean;
  commits_behind: number;
  commits_ahead: number;
  upstream?: {
    id: string;
    name: string;
    space_id: string;
  };
  error?: string;
}

export interface SyncResult {
  synced: boolean;
  commits_behind: number;
  commits_ahead: number;
  new_commits: number;
  conflict: boolean;
  message?: string;
}

export interface Branch {
  name: string;
  commit_sha: string;
  is_default: boolean;
  is_protected: boolean;
}

export interface RepoFile {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  sha: string;
  last_commit?: {
    sha: string;
    message: string;
    author: string;
    date: string;
  };
}

export interface FileContent {
  path: string;
  name: string;
  size: number;
  content: string;
  encoding: 'utf-8' | 'base64';
  mime_type?: string;
  sha: string;
  last_commit?: {
    sha: string;
    message: string;
    author: string;
    date: string;
  };
}

export interface Commit {
  sha: string;
  message: string;
  author: {
    name: string;
    email: string;
    avatar_url?: string;
  };
  date: string;
  parents: string[];
  stats?: {
    additions: number;
    deletions: number;
    files_changed: number;
  };
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: 'open' | 'merged' | 'closed';
  author: {
    id: string;
    name: string;
    avatar_url?: string;
  };
  source_branch: string;
  target_branch: string;
  commits_count: number;
  comments_count: number;
  reviews_count: number;
  is_mergeable: boolean;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  closed_at: string | null;
}

export interface PRReview {
  id: string;
  author: {
    id: string;
    name: string;
    avatar_url?: string;
  };
  reviewer_type: 'user' | 'ai';
  status: 'approved' | 'changes_requested' | 'commented';
  body: string | null;
  analysis?: string | null;
  created_at: string;
}

export interface PRComment {
  id: string;
  author: {
    id: string;
    name: string;
    avatar_url?: string;
  };
  body: string;
  author_type: 'user' | 'ai';
  path: string | null;
  line: number | null;
  created_at: string;
  updated_at?: string;
}

export interface FileDiff {
  path: string;
  old_path?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'context' | 'addition' | 'deletion';
  content: string;
  old_line?: number;
  new_line?: number;
}
