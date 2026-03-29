export type PrincipalKind = 'user' | 'space_agent' | 'service' | 'system' | 'tenant_worker';
export interface Principal {
    id: string;
    type: PrincipalKind;
    display_name: string | null;
    created_at: string;
    updated_at: string;
}
export interface User {
    id: string;
    principal_id?: string;
    email: string;
    name: string;
    username: string;
    principal_kind?: PrincipalKind;
    bio: string | null;
    picture: string | null;
    trust_tier: string;
    setup_completed: boolean;
    created_at: string;
    updated_at: string;
}
export interface Session {
    id: string;
    user_id: string;
    expires_at: number;
    created_at: number;
}
export interface OIDCState {
    state: string;
    nonce: string;
    code_verifier: string;
    return_to: string;
    expires_at: number;
    cli_callback?: string;
}
//# sourceMappingURL=identity.d.ts.map