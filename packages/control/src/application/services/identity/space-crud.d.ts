import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Env, Repository, Space, SecurityPosture } from '../../../shared/types';
type RepoSummary = {
    id: string;
    name: string | null;
    default_branch: string | null;
};
export interface SpaceListItem {
    id: string;
    kind: 'user' | 'team' | 'system';
    name: string;
    slug: string | null;
    owner_principal_id: string;
    automation_principal_id?: string | null;
    head_snapshot_id?: string | null;
    security_posture: import('../../../shared/types').SecurityPosture;
    created_at: string;
    updated_at: string;
    member_role: import('../../../shared/types').SpaceRole;
    repository: RepoSummary | null;
}
export declare function findLatestRepositoryBySpaceId(db: D1Database, spaceId: string): Promise<RepoSummary | null>;
export declare function loadSpaceById(db: D1Database, spaceId: string): Promise<{
    updatedAt: string;
    createdAt: string;
    id: string;
    type: string;
    status: string;
    name: string;
    slug: string;
    description: string | null;
    picture: string | null;
    bio: string | null;
    email: string | null;
    trustTier: string;
    setupCompleted: boolean;
    defaultRepositoryId: string | null;
    headSnapshotId: string | null;
    aiModel: string | null;
    aiProvider: string | null;
    securityPosture: string;
    ownerAccountId: string | null;
} | undefined>;
export declare function getRepositoryById(db: D1Database, repoId: string): Promise<Repository | null>;
export declare function listWorkspacesForUser(env: Env, userId: string): Promise<SpaceListItem[]>;
export declare function createWorkspaceWithDefaultRepo(env: Env, userId: string, name: string, options?: {
    id?: string;
    skipIdCheck?: boolean;
    kind?: 'team';
    description?: string;
}): Promise<{
    workspace: Space;
    repository: Repository | null;
}>;
export declare function getWorkspaceWithRepository(env: Env, workspace: Space): Promise<{
    workspace: Space;
    repository: Repository | null;
}>;
export declare function updateWorkspace(db: D1Database, spaceId: string, updates: {
    name?: string;
    ai_model?: string;
    ai_provider?: string;
    security_posture?: SecurityPosture;
}): Promise<Space | null>;
export declare function getWorkspaceByIdOrSlug(db: D1Database, idOrSlug: string): Promise<Space | null>;
export declare function deleteWorkspace(db: D1Database, spaceId: string): Promise<void>;
export declare function getPersonalWorkspace(env: Env, userId: string): Promise<SpaceListItem | null>;
export declare function getOrCreatePersonalWorkspace(env: Env, userId: string): Promise<SpaceListItem | null>;
export declare function ensurePersonalWorkspace(env: Env, userId: string): Promise<boolean>;
export {};
//# sourceMappingURL=space-crud.d.ts.map