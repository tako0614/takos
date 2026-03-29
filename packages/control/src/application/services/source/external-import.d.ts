/**
 * External Git Repository Import Service.
 *
 * Imports a repository from any Git HTTPS server into the Takos store.
 * Uses the Git Smart HTTP client to fetch refs and packfiles, then stores
 * objects in R2 and indexes metadata in D1 — the same storage format used
 * by locally created repositories.
 *
 * After import, the repository is fully browsable, forkable, and
 * accessible by agents through the standard Takos APIs.
 */
import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
export interface ImportExternalRepoInput {
    accountId: string;
    url: string;
    name?: string;
    authHeader?: string | null;
    description?: string;
    visibility?: 'public' | 'private';
}
export interface ImportExternalRepoResult {
    repositoryId: string;
    name: string;
    defaultBranch: string;
    branchCount: number;
    tagCount: number;
    commitCount: number;
    remoteUrl: string;
}
export interface FetchRemoteResult {
    newCommits: number;
    updatedBranches: string[];
    newTags: string[];
}
/**
 * Import an external Git repository into the Takos store.
 *
 * 1. Fetches refs from the remote server
 * 2. Downloads all objects via packfile
 * 3. Unpacks objects into R2
 * 4. Creates a local repository record
 * 5. Creates branches and tags
 * 6. Indexes commits
 */
export declare function importExternalRepository(dbBinding: D1Database, bucket: R2Bucket, input: ImportExternalRepoInput): Promise<ImportExternalRepoResult>;
/**
 * Fetch updates from the remote origin for an already-imported repository.
 *
 * Compares local refs against remote refs and fetches only the delta.
 */
export declare function fetchRemoteUpdates(dbBinding: D1Database, bucket: R2Bucket, repoId: string): Promise<FetchRemoteResult>;
//# sourceMappingURL=external-import.d.ts.map