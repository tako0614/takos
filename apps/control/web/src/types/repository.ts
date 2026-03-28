// Re-export common type aliases from backend shared models.
// The frontend repository types differ significantly from the raw DB models
// because they represent enriched API responses with joined data, so they
// are defined locally and reference the backend types for shared primitives.
import type {
  RepositoryVisibility,
  PullRequestStatus,
  ReviewStatus,
  PullRequestCommentAuthorType,
  Repository as BackendRepository,
} from '@takos/control-shared/types';

/**
 * Frontend Repository: extends the backend core with UI-specific enriched
 * fields (e.g. fork info, owner display names, starred status).
 */
export interface Repository
  extends Pick<
    BackendRepository,
    'id' | 'space_id' | 'name' | 'description' | 'default_branch' | 'stars' | 'forks' | 'created_at' | 'updated_at'
  > {
  visibility: RepositoryVisibility;
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

/**
 * Frontend PullRequest: an enriched API response shape with joined author
 * info. Shares `status` with the backend PullRequestStatus type.
 */
export interface PullRequest {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: PullRequestStatus;
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

/**
 * Frontend PRReview: enriched review with joined author info.
 * Reuses ReviewStatus from backend.
 */
export interface PRReview {
  id: string;
  author: {
    id: string;
    name: string;
    avatar_url?: string;
  };
  reviewer_type: 'user' | 'ai';
  status: ReviewStatus;
  body: string | null;
  analysis?: string | null;
  created_at: string;
}

/**
 * Frontend PRComment: enriched comment with joined author info.
 * Reuses PullRequestCommentAuthorType from backend.
 */
export interface PRComment {
  id: string;
  author: {
    id: string;
    name: string;
    avatar_url?: string;
  };
  body: string;
  author_type: PullRequestCommentAuthorType;
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
