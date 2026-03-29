import type { Env } from '../../../shared/types';
import type { D1Database } from '../../../shared/types/bindings.ts';
export interface CommonEnvAuditActor {
    type: 'user' | 'system';
    userId?: string | null;
    requestId?: string;
    ipHash?: string;
    userAgent?: string;
}
export declare function hashAuditIp(env: Env, ipRaw?: string): Promise<string | undefined>;
export declare function writeCommonEnvAuditLog(params: {
    db: D1Database;
    spaceId: string;
    eventType: 'workspace_env_created' | 'workspace_env_updated' | 'workspace_env_deleted' | 'worker_link_added' | 'worker_link_removed' | 'required_link_overridden';
    envName: string;
    serviceId?: string | null;
    workerId?: string | null;
    linkSource?: 'manual' | 'required' | null;
    changeBefore?: Record<string, unknown>;
    changeAfter?: Record<string, unknown>;
    actor?: CommonEnvAuditActor;
}): Promise<void>;
//# sourceMappingURL=audit.d.ts.map