import type { Env } from '../../../shared/types';
import type { D1TransactionManager } from '../../../shared/utils/db-transaction';
import { type CommonEnvAuditActor } from './audit';
export interface SpaceEnvDeps {
    env: Env;
    txManager: D1TransactionManager;
}
export declare function listSpaceCommonEnv(deps: SpaceEnvDeps, spaceId: string): Promise<Array<{
    name: string;
    secret: boolean;
    value: string;
    updatedAt: string;
}>>;
export declare function upsertSpaceCommonEnv(deps: SpaceEnvDeps, params: {
    spaceId: string;
    name: string;
    value: string;
    secret?: boolean;
    actor?: CommonEnvAuditActor;
}): Promise<void>;
export declare function ensureSystemCommonEnv(deps: SpaceEnvDeps, spaceId: string, entries: Array<{
    name: string;
    value: string;
    secret?: boolean;
}>): Promise<void>;
export declare function deleteSpaceCommonEnv(deps: SpaceEnvDeps, spaceId: string, nameRaw: string, actor?: CommonEnvAuditActor): Promise<boolean>;
//# sourceMappingURL=space-env-ops.d.ts.map