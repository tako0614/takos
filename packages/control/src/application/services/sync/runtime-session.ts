/**
 * Runtime Session Manager
 *
 * Manages Git store-based runtime sessions for development containers.
 * Sessions use the Git store (D1 + R2) for file management.
 *
 * Flow:
 * 1. Session Start: Fetch files from the Git store and send to runtime
 * 2. During Session: All file ops go through runtime /session/file/*
 * 3. Session End: Get snapshot from runtime and commit to the Git store
 */

import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { Env } from '../../../shared/types';
import { getDb, sessions, repositories } from '../../../infra/db';
import { and, eq } from 'drizzle-orm';
import * as gitStore from '../git-smart';
import { isProbablyBinaryContent } from '../../../shared/utils/content-type';
import { callRuntimeRequest } from '../execution/runtime';
import { logError, logWarn } from '../../../shared/utils/logger';

/** A file entry used for session init and repo file transfer. */
interface SessionFileEntry {
  path: string;
  content: string;
  encoding?: 'utf-8' | 'base64';
  is_binary?: boolean;
}

/** Shared result type for sync operations. */
interface SyncResult {
  success: boolean;
  committed: boolean;
  commitHash?: string;
  pushed: boolean;
  error?: string;
}

export interface SessionInitResult {
  success: boolean;
  file_count: number;
  session_dir: string;
  git_mode?: boolean;
  branch?: string;
  work_dir?: string;
}

export interface SessionRepoMount {
  repoId: string;
  repoName: string;
  branch?: string;
  mountPath?: string;
}

export interface GitCloneResult {
  success: boolean;
  targetDir: string;
  branch: string;
  message?: string;
  error?: string;
}

export interface GitCommitResult {
  success: boolean;
  committed: boolean;
  commitHash?: string;
  message?: string;
  error?: string;
}

export interface GitPushResult {
  success: boolean;
  branch: string;
  message?: string;
  error?: string;
}

export interface SessionSnapshot {
  files: Array<{
    path: string;
    content: string;
    size: number;
    is_binary?: boolean;
    encoding?: 'utf-8' | 'base64';
  }>;
  file_count: number;
  total_size?: number;
}

/** Extract an error message from a failed HTTP response. */
async function extractResponseError(response: Response, fallbackMessage: string): Promise<string> {
  try {
    const body = await response.json() as Record<string, unknown>;
    if (typeof body?.error === 'string') return body.error;
    return JSON.stringify(body);
  } catch {
    return `HTTP ${response.status} ${response.statusText}: ${fallbackMessage}`;
  }
}

function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < data.length; i += chunkSize) {
    binary += String.fromCharCode(...data.slice(i, i + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer;
}

export type RuntimeSessionManagerEnv = Pick<Env, 'DB' | 'RUNTIME_HOST' | 'GIT_OBJECTS' | 'TENANT_SOURCE'>;

export class RuntimeSessionManager {
  private repoId?: string;
  private branch?: string;
  private repoName?: string;
  private repositories: SessionRepoMount[] = [];
  private primaryRepoId?: string;

  constructor(
    private env: RuntimeSessionManagerEnv,
    private db: D1Database,
    private storage: R2Bucket | undefined,
    private spaceId: string,
    private sessionId: string
  ) {}

  /** Set repository info for Git-based sessions. */
  setRepositoryInfo(repoId: string, branch?: string, repoName?: string): void {
    this.repoId = repoId;
    this.branch = branch;
    this.repoName = repoName;
    this.repositories = [{
      repoId,
      repoName: repoName || '',
      branch,
      mountPath: '',
    }];
    this.primaryRepoId = repoId;
  }

  /** Set multiple repositories for a session (multi-repo mounts). */
  setRepositories(repos: SessionRepoMount[], primaryRepoId?: string): void {
    this.repositories = repos;
    this.primaryRepoId = primaryRepoId || repos[0]?.repoId;
    if (this.primaryRepoId) {
      const primary = repos.find((repo) => repo.repoId === this.primaryRepoId);
      if (primary) {
        this.repoId = primary.repoId;
        this.branch = primary.branch;
        this.repoName = primary.repoName;
      }
    }
  }

  /** Check if this session is using Git mode. */
  isGitMode(): boolean {
    return !!this.repoId;
  }

  private callRuntime(
    endpoint: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: Record<string, unknown>;
      timeoutMs?: number;
    } = {}
  ): Promise<Response> {
    const { method = 'POST', body, timeoutMs = 60000 } = options;
    return callRuntimeRequest(this.env, endpoint, { method, body, timeoutMs });
  }

  /**
   * Initialize runtime session with Git repository.
   * Uses DB-based lock via 'initializing' status to prevent race conditions.
   *
   * @param options.skipDbLock - Skip DB-based lock for ephemeral sessions (e.g., build sessions).
   */
  async initSession(options?: { skipDbLock?: boolean }): Promise<SessionInitResult> {
    const skipDbLock = options?.skipDbLock ?? false;
    const drizzle = getDb(this.db);

    if (!skipDbLock) {
      const session = await drizzle.select({ status: sessions.status })
        .from(sessions)
        .where(
          and(
            eq(sessions.id, this.sessionId),
            eq(sessions.accountId, this.spaceId),
          )
        )
        .get();

      if (!session) {
        throw new Error('Session not found');
      }

      if (session.status !== 'initializing') {
        if (session.status === 'running') {
          throw new Error('Session is already initialized');
        }
        throw new Error(`Cannot initialize session in '${session.status}' state`);
      }
    }

    try {
      if (!this.repoId && this.repositories.length === 0) {
        throw new Error('repo_id is required. All sessions now use Git-based file management.');
      }

      const repos = this.repositories.length > 0
        ? this.repositories
        : [{
            repoId: this.repoId!,
            repoName: this.repoName || '',
            branch: this.branch,
            mountPath: '',
          }];

      const result = await this._doInitSessionFromRepos(repos);

      if (!skipDbLock) {
        const updateResult = await drizzle.update(sessions)
          .set({
            status: 'running',
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(sessions.id, this.sessionId),
              eq(sessions.accountId, this.spaceId),
              eq(sessions.status, 'initializing'),
            )
          )
          .run();

        if ((updateResult.meta.changes ?? 0) === 0) {
          throw new Error('Session status was modified by another process');
        }
      }

      return result;
    } catch (error) {
      if (!skipDbLock) {
        await drizzle.update(sessions)
          .set({
            status: 'failed',
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(sessions.id, this.sessionId),
              eq(sessions.accountId, this.spaceId),
              eq(sessions.status, 'initializing'),
            )
          )
          .run();
      }

      throw error;
    }
  }

  /** Initialize session by fetching files from the Git store for multiple repositories. */
  private async _doInitSessionFromRepos(repos: SessionRepoMount[]): Promise<SessionInitResult> {
    const bucket = this.storage || this.env.GIT_OBJECTS || this.env.TENANT_SOURCE;
    if (!bucket) {
      throw new Error('R2 storage bucket not configured (need GIT_OBJECTS or TENANT_SOURCE)');
    }

    const files: SessionFileEntry[] = [];
    let primaryBranch: string | undefined;

    for (const repo of repos) {
      const repoFiles = await this.buildRepoFiles(bucket, repo);
      files.push(...repoFiles);
      if (!primaryBranch && repo.repoId === this.primaryRepoId) {
        primaryBranch = repo.branch;
      }
    }

    const initResponse = await this.callRuntime('/session/init', {
      body: {
        session_id: this.sessionId,
        space_id: this.spaceId,
        files,
      },
      timeoutMs: 60000,
    });

    if (!initResponse.ok) {
      const errorDetail = await extractResponseError(initResponse, 'init failed');
      throw new Error(`Failed to init runtime session: ${errorDetail}`);
    }

    const result = await initResponse.json() as {
      success: boolean;
      session_id: string;
      work_dir: string;
      files_written: number;
    };

    return {
      success: true,
      file_count: result.files_written,
      session_dir: result.work_dir,
      work_dir: result.work_dir,
      git_mode: true,
      branch: primaryBranch,
    };
  }

  private async buildRepoFiles(
    bucket: R2Bucket,
    repo: SessionRepoMount
  ): Promise<SessionFileEntry[]> {
    const drizzle = getDb(this.db);

    const repoInfo = await drizzle.select({
      id: repositories.id,
      name: repositories.name,
      defaultBranch: repositories.defaultBranch,
    })
      .from(repositories)
      .where(eq(repositories.id, repo.repoId))
      .get();

    if (!repoInfo) {
      throw new Error(`Repository not found: ${repo.repoId}`);
    }

    const branchToUse = repo.branch || repoInfo.defaultBranch;
    const mountPath = (repo.mountPath || '').replace(/\/+$/, '');

    const files: SessionFileEntry[] = [];

    const commitSha = await gitStore.resolveRef(this.db, repo.repoId, branchToUse);
    if (!commitSha) return files;

    const commit = await gitStore.getCommitData(bucket, commitSha);
    if (!commit) return files;

    const treeFiles = await gitStore.flattenTree(bucket, commit.tree);

    for (const file of treeFiles) {
      try {
        const blob = await gitStore.getBlob(bucket, file.sha);
        if (!blob) continue;
        const isBinary = isProbablyBinaryContent(blob);
        const encoded = isBinary
          ? toBase64(blob)
          : new TextDecoder().decode(blob);
        const filePath = mountPath ? `${mountPath}/${file.path}` : file.path;
        files.push({
          path: filePath,
          content: encoded,
          encoding: isBinary ? 'base64' : 'utf-8',
          is_binary: isBinary,
        });
      } catch (err) {
        logWarn(`Failed to fetch file ${file.path}: ${err}`, { module: 'services/sync/runtime-session' });
      }
    }

    return files;
  }

  /** Clone a repository to the session's work directory. */
  async cloneRepository(
    repoName: string,
    branch: string,
    targetDir: string
  ): Promise<GitCloneResult> {
    const response = await this.callRuntime('/repos/clone', {
      body: {
        spaceId: this.spaceId,
        repoName,
        branch,
        targetDir,
      },
    });

    const result = await response.json() as GitCloneResult;

    if (!response.ok) {
      return {
        success: false,
        targetDir,
        branch,
        error: result.error || 'Failed to clone repository',
      };
    }

    return result;
  }

  /** Commit changes in the session's git repository. */
  async commitChanges(
    workDir: string,
    message: string,
    author?: { name: string; email: string }
  ): Promise<GitCommitResult> {
    const response = await this.callRuntime('/repos/commit', {
      body: {
        workDir,
        message,
        author,
      },
    });

    const result = await response.json() as GitCommitResult;

    if (!response.ok) {
      return {
        success: false,
        committed: false,
        error: result.error || 'Failed to commit changes',
      };
    }

    return result;
  }

  /** Push changes to the remote repository. */
  async pushChanges(workDir: string, branch?: string): Promise<GitPushResult> {
    const response = await this.callRuntime('/repos/push', {
      body: {
        workDir,
        branch,
      },
    });

    const result = await response.json() as GitPushResult;

    if (!response.ok) {
      return {
        success: false,
        branch: branch || 'unknown',
        error: result.error || 'Failed to push changes',
      };
    }

    return result;
  }

  /** Get the session's work directory path from runtime. */
  async getWorkDir(): Promise<string | null> {
    const response = await this.callRuntime('/session/file/list', {
      body: {
        session_id: this.sessionId,
        space_id: this.spaceId,
      },
    });

    if (!response.ok) {
      return null;
    }

    return `/tmp/takos-session-${this.sessionId}`;
  }

  /** Get a session snapshot from runtime. */
  async getSnapshot(options?: { path?: string; includeBinary?: boolean }): Promise<SessionSnapshot> {
    const response = await this.callRuntime('/session/snapshot', {
      body: {
        session_id: this.sessionId,
        space_id: this.spaceId,
        ...(options?.path ? { path: options.path } : {}),
        ...(options?.includeBinary ? { include_binary: true } : {}),
      },
      timeoutMs: 60000,
    });

    if (!response.ok) {
      const errorDetail = await extractResponseError(response, 'snapshot failed');
      throw new Error(errorDetail);
    }

    return await response.json() as SessionSnapshot;
  }

  /** Commit a snapshot to the Git store for a specific repository. */
  async syncSnapshotToRepo(
    snapshot: SessionSnapshot,
    options: {
      repoId: string;
      repoName?: string;
      branch?: string;
      pathPrefix?: string;
      message: string;
      author?: { name: string; email: string };
    }
  ): Promise<SyncResult> {
    const bucket = this.storage || this.env.GIT_OBJECTS || this.env.TENANT_SOURCE;
    if (!bucket) {
      return {
        success: false,
        committed: false,
        pushed: false,
        error: 'R2 storage bucket not configured (need GIT_OBJECTS or TENANT_SOURCE)',
      };
    }

    if (!options.repoId) {
      return {
        success: false,
        committed: false,
        pushed: false,
        error: 'Repository ID not set',
      };
    }

    const prefix = options.pathPrefix ? options.pathPrefix.replace(/^\/+|\/+$/g, '') : '';
    const prefixWithSlash = prefix ? `${prefix}/` : '';

    const filteredFiles = snapshot.files
      .filter((file) => {
        if (file.path === '.takos-session') return false;
        if (!prefix) return true;
        return file.path === prefix || file.path.startsWith(prefixWithSlash);
      })
      .map((file) => {
        const relativePath = prefix ? file.path.replace(prefixWithSlash, '') : file.path;
        return { ...file, path: relativePath };
      })
      .filter((file) => Boolean(file.path));

    if (filteredFiles.length === 0) {
      return {
        success: true,
        committed: false,
        pushed: false,
      };
    }

    const branchName = options.branch || 'main';
    const currentCommitSha = await gitStore.resolveRef(this.db, options.repoId, branchName);

    const fileEntries: Array<{ path: string; sha: string; mode?: string }> = [];

    for (const file of filteredFiles) {
      const contentBytes = file.encoding === 'base64'
        ? fromBase64(file.content)
        : new TextEncoder().encode(file.content);

      const blobSha = await gitStore.putBlob(bucket, contentBytes);

      fileEntries.push({
        path: file.path,
        sha: blobSha,
      });
    }

    const treeOid = await gitStore.buildTreeFromPaths(bucket, fileEntries);

    if (currentCommitSha) {
      const currentCommit = await gitStore.getCommitData(bucket, currentCommitSha);
      if (currentCommit && currentCommit.tree === treeOid) {
        return {
          success: true,
          committed: false,
          pushed: false,
        };
      }
    }

    const authorInfo = options.author || { name: 'Takos Agent', email: 'agent@takos.io' };
    const unixTimestamp = Math.floor(Date.now() / 1000);

    const commit = await gitStore.createCommit(this.db, bucket, options.repoId, {
      tree: treeOid,
      parents: currentCommitSha ? [currentCommitSha] : [],
      author: {
        name: authorInfo.name,
        email: authorInfo.email,
        timestamp: unixTimestamp,
        tzOffset: '+0000',
      },
      committer: {
        name: authorInfo.name,
        email: authorInfo.email,
        timestamp: unixTimestamp,
        tzOffset: '+0000',
      },
      message: options.message,
    });

    const commitOid = commit.sha;

    const updateResult = await gitStore.updateBranch(
      this.db,
      options.repoId,
      branchName,
      currentCommitSha,
      commitOid
    );

    if (!updateResult.success) {
      return {
        success: false,
        committed: true,
        commitHash: commitOid,
        pushed: false,
        error: 'Failed to update branch ref (concurrent modification)',
      };
    }

    return {
      success: true,
      committed: true,
      commitHash: commitOid,
      pushed: true,
    };
  }

  /** Sync session changes back to the Git store. */
  async syncToGit(
    message: string = 'Session changes',
    author?: { name: string; email: string }
  ): Promise<SyncResult> {
    if (!this.repoId) {
      return {
        success: false,
        committed: false,
        pushed: false,
        error: 'Repository ID not set',
      };
    }

    const snapshot = await this.getSnapshot({ includeBinary: true });
    return await this.syncSnapshotToRepo(snapshot, {
      repoId: this.repoId,
      repoName: this.repoName,
      branch: this.branch,
      pathPrefix: '',
      message,
      author,
    });
  }

  /** Destroy runtime session (called when session is discarded or after merge). */
  async destroySession(): Promise<void> {
    try {
      await this.callRuntime('/session/destroy', {
        body: {
          session_id: this.sessionId,
          space_id: this.spaceId,
        },
      });
    } catch (err) {
      logError('Failed to destroy runtime session', err, { module: 'services/sync/runtime-session' });
    }
  }
}

/** Create a RuntimeSessionManager. */
export function createRuntimeSessionManager(
  env: RuntimeSessionManagerEnv,
  db: D1Database,
  storage: R2Bucket | undefined,
  spaceId: string,
  sessionId: string
): RuntimeSessionManager {
  return new RuntimeSessionManager(env, db, storage, spaceId, sessionId);
}
