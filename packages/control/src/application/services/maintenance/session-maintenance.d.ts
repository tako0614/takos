import type { Env } from '../../../shared/types';
export interface CleanupDeadSessionsSummary {
    markedDead: number;
    cutoffTime: string;
    startupCutoff: string;
    heartbeatTimeoutMs: number;
    startupGraceMs: number;
}
export declare function cleanupDeadSessions(env: Pick<Env, 'DB'>, options?: {
    heartbeatTimeoutMs?: number;
    startupGraceMs?: number;
}): Promise<CleanupDeadSessionsSummary>;
//# sourceMappingURL=session-maintenance.d.ts.map