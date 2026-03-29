/**
 * Git ref management (branches & tags) — D1 with Drizzle + fallback.
 *
 * Adapted from git-store/refs.ts with SHA-1 (40-char) validation.
 */
import type { D1Database } from '../../../../shared/types/bindings.ts';
import type { GitBranch, GitTag, RefUpdateResult } from '../git-objects';
export declare function isValidRefName(name: unknown): name is string;
export declare function getBranch(dbBinding: D1Database, repoId: string, name: string): Promise<GitBranch | null>;
export declare function getBranchesByNames(dbBinding: D1Database, repoId: string, names: string[]): Promise<Map<string, GitBranch>>;
export declare function getDefaultBranch(dbBinding: D1Database, repoId: string): Promise<GitBranch | null>;
export declare function listBranches(dbBinding: D1Database, repoId: string): Promise<GitBranch[]>;
export declare function createBranch(dbBinding: D1Database, repoId: string, name: string, commitSha: string, isDefault?: boolean): Promise<RefUpdateResult>;
export declare function updateBranch(dbBinding: D1Database, repoId: string, name: string, oldSha: string | null, newSha: string): Promise<RefUpdateResult>;
export declare function deleteBranch(dbBinding: D1Database, repoId: string, name: string): Promise<RefUpdateResult>;
export declare function setDefaultBranch(dbBinding: D1Database, repoId: string, name: string): Promise<RefUpdateResult>;
export declare function getTag(dbBinding: D1Database, repoId: string, name: string): Promise<GitTag | null>;
export declare function listTags(dbBinding: D1Database, repoId: string): Promise<GitTag[]>;
export declare function createTag(dbBinding: D1Database, repoId: string, name: string, commitSha: string, message?: string, taggerName?: string, taggerEmail?: string): Promise<RefUpdateResult>;
export declare function deleteTag(dbBinding: D1Database, repoId: string, name: string): Promise<RefUpdateResult>;
export declare function resolveRef(dbBinding: D1Database, repoId: string, ref: string): Promise<string | null>;
export declare function listAllRefs(dbBinding: D1Database, repoId: string): Promise<Array<{
    name: string;
    target: string;
    type: 'branch' | 'tag' | 'remote';
}>>;
//# sourceMappingURL=refs.d.ts.map