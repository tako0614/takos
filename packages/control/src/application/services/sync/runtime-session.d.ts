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
import type { SyncResult, SessionSnapshot } from './git-sync-types';
export type { SyncResult, SessionSnapshot, SessionFileEntry } from './git-sync-types';
export type { SessionRepoMount } from './git-sync-types';
export interface SessionInitResult {
    success: boolean;
    file_count: number;
    session_dir: string;
    git_mode?: boolean;
    branch?: string;
    work_dir?: string;
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
export type RuntimeSessionManagerEnv = Pick<Env, 'DB' | 'RUNTIME_HOST' | 'GIT_OBJECTS' | 'TENANT_SOURCE'>;
interface SessionRepoMountInternal {
    repoId: string;
    repoName: string;
    branch?: string;
    mountPath?: string;
}
export declare class RuntimeSessionManager {
    private env;
    private db;
    private storage;
    private spaceId;
    private sessionId;
    private repoId?;
    private branch?;
    private repoName?;
    private repositories;
    private primaryRepoId?;
    constructor(env: RuntimeSessionManagerEnv, db: D1Database, storage: R2Bucket | undefined, spaceId: string, sessionId: string);
    /** Set repository info for Git-based sessions. */
    setRepositoryInfo(repoId: string, branch?: string, repoName?: string): void;
    /** Set multiple repositories for a session (multi-repo mounts). */
    setRepositories(repos: SessionRepoMountInternal[], primaryRepoId?: string): void;
    /** Check if this session is using Git mode. */
    isGitMode(): boolean;
    private callRuntime;
    /**
     * Initialize runtime session with Git repository.
     * Uses DB-based lock via 'initializing' status to prevent race conditions.
     *
     * @param options.skipDbLock - Skip DB-based lock for ephemeral sessions (e.g., build sessions).
     */
    initSession(options?: {
        skipDbLock?: boolean;
    }): Promise<SessionInitResult>;
    /** Initialize session by fetching files from the Git store for multiple repositories. */
    private _doInitSessionFromRepos;
    /** Clone a repository to the session's work directory. */
    cloneRepository(repoName: string, branch: string, targetDir: string): Promise<GitCloneResult>;
    /** Commit changes in the session's git repository. */
    commitChanges(workDir: string, message: string, author?: {
        name: string;
        email: string;
    }): Promise<GitCommitResult>;
    /** Push changes to the remote repository. */
    pushChanges(workDir: string, branch?: string): Promise<GitPushResult>;
    /** Get the session's work directory path from runtime. */
    getWorkDir(): Promise<string | null>;
    /** Get a session snapshot from runtime. */
    getSnapshot(options?: {
        path?: string;
        includeBinary?: boolean;
    }): Promise<SessionSnapshot>;
    /** Commit a snapshot to the Git store for a specific repository. */
    syncSnapshotToRepo(snapshot: SessionSnapshot, options: {
        repoId: string;
        repoName?: string;
        branch?: string;
        pathPrefix?: string;
        message: string;
        author?: {
            name: string;
            email: string;
        };
    }): Promise<SyncResult>;
    /** Sync session changes back to the Git store. */
    syncToGit(message?: string, author?: {
        name: string;
        email: string;
    }): Promise<SyncResult>;
    /** Destroy runtime session (called when session is discarded or after merge). */
    destroySession(): Promise<void>;
}
//# sourceMappingURL=runtime-session.d.ts.map