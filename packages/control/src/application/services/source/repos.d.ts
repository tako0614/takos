import type { D1Database, R2Bucket } from '../../../shared/types/bindings.ts';
import type { Env, Repository, RepositoryVisibility, SpaceRole } from '../../../shared/types';
import type { SelectOf } from '../../../shared/types/drizzle-utils';
import { repositories } from '../../../infra/db';
export interface RepoAccess {
    repo: Repository;
    spaceId: string;
    role: SpaceRole;
}
export interface CheckRepoAccessOptions {
    allowPublicRead?: boolean;
}
export interface CreateRepositoryInput {
    spaceId: string;
    name: string;
    description?: string | null;
    visibility?: RepositoryVisibility | 'internal';
    actorAccountId?: string;
}
export declare class RepositoryCreationError extends Error {
    readonly code: 'INVALID_NAME' | 'SPACE_NOT_FOUND' | 'REPOSITORY_EXISTS' | 'GIT_STORAGE_NOT_CONFIGURED' | 'INIT_FAILED';
    constructor(message: string, code: 'INVALID_NAME' | 'SPACE_NOT_FOUND' | 'REPOSITORY_EXISTS' | 'GIT_STORAGE_NOT_CONFIGURED' | 'INIT_FAILED');
}
type RepositoryRow = SelectOf<typeof repositories>;
export declare function toApiRepositoryFromDb(row: RepositoryRow): Repository;
export declare function checkRepoAccess(env: Env, repoId: string, userId: string | null | undefined, requiredRoles?: SpaceRole[], options?: CheckRepoAccessOptions): Promise<RepoAccess | null>;
export declare function getRepositoryById(db: D1Database, repoId: string): Promise<Repository | null>;
export declare function listRepositoriesBySpace(db: D1Database, spaceId: string): Promise<Repository[]>;
export declare function createRepository(dbBinding: D1Database, bucket: R2Bucket | undefined, input: CreateRepositoryInput): Promise<Repository>;
export {};
//# sourceMappingURL=repos.d.ts.map