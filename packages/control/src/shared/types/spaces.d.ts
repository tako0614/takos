export type SpaceRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type SpaceKind = 'user' | 'team' | 'system';
export type SecurityPosture = 'standard' | 'restricted_egress';
export interface Space {
    id: string;
    kind: SpaceKind;
    name: string;
    slug: string | null;
    description?: string | null;
    principal_id?: string;
    owner_user_id?: string;
    owner_principal_id: string;
    automation_principal_id?: string | null;
    head_snapshot_id?: string | null;
    ai_model?: string | null;
    ai_provider?: string | null;
    security_posture?: SecurityPosture;
    created_at: string;
    updated_at: string;
}
export interface SpaceMembership {
    id: string;
    space_id: string;
    principal_id: string;
    role: SpaceRole;
    created_at: string;
}
//# sourceMappingURL=spaces.d.ts.map