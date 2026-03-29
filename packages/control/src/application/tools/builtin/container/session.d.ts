import type { ToolContext } from '../../types';
import type { D1Database } from '../../../../shared/types/bindings.ts';
export declare function callSessionApi(context: ToolContext, endpoint: string, body?: Record<string, unknown>, timeoutMs?: number): Promise<Response>;
export interface SessionHealth {
    isHealthy: boolean;
    session: {
        id: string;
        status: string;
        last_heartbeat: string | null;
        created_at: string;
    } | null;
    reason?: string;
}
export declare function checkSessionHealth(db: D1Database, sessionId: string): Promise<SessionHealth>;
export declare function validateStringInput(value: unknown, fieldName: string): string | undefined;
export declare function normalizeMountPath(value: unknown): string;
//# sourceMappingURL=session.d.ts.map