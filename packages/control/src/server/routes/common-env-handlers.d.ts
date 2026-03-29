import { type CommonEnvAuditActor } from '../../application/services/common-env/audit';
import type { Env } from '../../shared/types';
/**
 * Build an audit actor from a Hono request context and user ID.
 * Shared between workspace common-env routes and worker settings routes.
 */
export declare function buildCommonEnvActor(c: {
    req: {
        header: (name: string) => string | undefined;
    };
    env: Env;
}, userId: string): Promise<CommonEnvAuditActor>;
//# sourceMappingURL=common-env-handlers.d.ts.map