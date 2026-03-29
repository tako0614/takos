import type { RepositoryVisibility, User } from '../../../shared/types';
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
export declare function toWorkspaceResponse(ws: {
    id?: string;
    kind?: string;
    name: string;
    slug: string | null;
    description?: string | null;
    owner_principal_id?: string;
    automation_principal_id?: string | null;
    head_snapshot_id?: string | null;
    security_posture?: 'standard' | 'restricted_egress';
    created_at: string;
    updated_at: string;
    member_role?: string;
    repository?: {
        id: string;
        name: string | null;
        default_branch: string | null;
    } | null;
}): {
    id: string | undefined;
    slug: string;
    name: string;
    description: string | null;
    kind: string;
    owner_principal_id: string | null;
    automation_principal_id: string | null;
    security_posture: "standard" | "restricted_egress";
    created_at: string;
    updated_at: string;
};
/**
 * Transform user for API response - excludes internal id field.
 * Frontend should use username to identify users.
 */
export declare function toUserResponse(user: User): {
    email: string;
    name: string;
    username: string;
    picture: string | null;
    setup_completed: boolean;
};
//# sourceMappingURL=response-formatters.d.ts.map