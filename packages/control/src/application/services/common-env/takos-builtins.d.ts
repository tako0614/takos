import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Env } from '../../../shared/types';
import type { SyncState } from './repository';
export declare const TAKOS_API_URL_ENV_NAME = "TAKOS_API_URL";
export declare const TAKOS_ACCESS_TOKEN_ENV_NAME = "TAKOS_ACCESS_TOKEN";
export type TakosTokenSubjectMode = 'owner_principal' | 'space_agent';
type SpaceIdentityRow = {
    id: string;
    kind: 'user' | 'team' | 'system';
    name: string;
    slug: string | null;
    owner_user_id: string;
    owner_principal_id: string;
};
export interface TakosBuiltinStatus {
    managed: true;
    available: boolean;
    configured?: boolean;
    scopes?: string[];
    subject_mode?: TakosTokenSubjectMode;
    sync_state?: 'managed' | 'pending' | 'missing_common' | 'missing_builtin' | 'overridden' | 'error';
    sync_reason?: string | null;
}
type LinkStateLike = {
    syncState: SyncState;
    syncReason: string | null;
};
export declare function normalizeTakosScopes(scopes: string[]): string[];
export declare function resolveTakosApiUrl(env: Pick<Env, 'ADMIN_DOMAIN'>): string | null;
export declare function resolveTakosTokenSubject(params: {
    env: Pick<Env, 'DB'>;
    spaceId: string;
}): Promise<{
    subjectUserId: string;
    subjectMode: TakosTokenSubjectMode;
    space: SpaceIdentityRow;
}>;
export declare function deleteManagedTakosTokenConfig(params: {
    env: Pick<Env, 'DB'>;
    spaceId: string;
    serviceId?: string;
    workerId?: string;
    envName?: string;
}): Promise<void>;
export declare function upsertManagedTakosTokenConfig(params: {
    env: Pick<Env, 'DB' | 'ENCRYPTION_KEY'>;
    spaceId: string;
    serviceId?: string;
    workerId?: string;
    scopes: string[];
    envName?: string;
}): Promise<void>;
export declare function ensureManagedTakosTokenValue(params: {
    env: Pick<Env, 'DB' | 'ENCRYPTION_KEY'>;
    spaceId: string;
    serviceId?: string;
    workerId?: string;
    envName?: string;
}): Promise<{
    value: string;
    scopes: string[];
    subjectMode: TakosTokenSubjectMode;
} | null>;
export declare function listTakosBuiltinStatuses(params: {
    env: Pick<Env, 'DB' | 'ADMIN_DOMAIN'>;
    spaceId: string;
    serviceId?: string;
    workerId?: string;
    linkStateByName?: Map<string, LinkStateLike>;
}): Promise<Record<string, TakosBuiltinStatus>>;
export declare function markManagedTakosTokenUsedByHash(db: D1Database, tokenHash: string): Promise<void>;
export {};
//# sourceMappingURL=takos-builtins.d.ts.map