import type { Context } from 'hono';
import type { Env } from '../../../shared/types';
import type { Session } from '../../../application/services/sync';
import type { BaseVariables } from '../route-auth';
export type SessionContext = Context<{
    Bindings: Env;
    Variables: BaseVariables;
}>;
export type JwtHeartbeatPayload = {
    session_id?: string;
    space_id?: string;
};
export declare function toSessionSnakeCase(dbSession: {
    id: string;
    accountId: string;
    baseSnapshotId: string | null;
    headSnapshotId: string | null;
    status: string;
    repoId: string | null;
    branch: string | null;
    createdAt: string | Date;
    updatedAt: string | Date;
    lastHeartbeat: string | Date | null;
}): Session;
//# sourceMappingURL=session-mappers.d.ts.map