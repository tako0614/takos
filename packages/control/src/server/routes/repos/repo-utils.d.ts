/**
 * Private helpers for repo CRUD routes (format, cleanup, owner resolution).
 */
import type { RepositoryVisibility } from '../../../shared/types';
import type { AuthenticatedRouteEnv } from '../route-auth';
import type { Database } from '../../../infra/db';
type GitObjectsBucket = NonNullable<AuthenticatedRouteEnv['Bindings']['GIT_OBJECTS']>;
export type RepositoryResponseSource = {
    name: string;
    description: string | null;
    visibility: string;
    defaultBranch: string;
    stars: number;
    forks: number;
    gitEnabled: number | boolean;
    createdAt: string | Date;
    updatedAt: string | Date;
};
/**
 * Resolve the display username for an account (workspace or user).
 * The account's own slug is the username -- no personal workspace indirection needed.
 */
export declare function resolveOwnerUsername(db: Database, spaceId: string): Promise<string>;
export declare function formatRepositoryResponse(repository: RepositoryResponseSource, ownerUsername: string): {
    owner_username: string;
    name: string;
    description: string | null;
    visibility: RepositoryVisibility;
    default_branch: string;
    stars: number;
    forks: number;
    git_enabled: number | boolean;
    created_at: string | null;
    updated_at: string | null;
};
export declare function deleteR2Prefix(bucket: GitObjectsBucket, prefix: string): Promise<void>;
export declare function cleanupRepoGitObjects(db: Database, d1: AuthenticatedRouteEnv['Bindings']['DB'], bucket: GitObjectsBucket, deletedRepoId: string, candidateOids: Set<string>): Promise<void>;
/**
 * Collect reachable object SHAs for cleanup, with a safety cap.
 * Returns null if the candidate set is too large.
 */
export declare function collectCleanupCandidates(d1: AuthenticatedRouteEnv['Bindings']['DB'], bucket: GitObjectsBucket, repoId: string): Promise<Set<string> | null>;
export {};
//# sourceMappingURL=repo-utils.d.ts.map