/**
 * Run state management — DB lookups, heartbeat, status transitions,
 * and run lifecycle handlers for the executor-host subsystem.
 */
import { runs } from '../../infra/db/schema';
import type { SelectOf } from '../../shared/types/drizzle-utils';
import type { Env } from './executor-utils';
export type RunBootstrap = {
    status: SelectOf<typeof runs>['status'] | null;
    spaceId: string;
    sessionId: string | null;
    threadId: string;
    userId: string;
    agentType: string;
};
export declare function resolveExecutionUserIdForRun(env: Env, runId: string): Promise<string>;
export declare function getRunBootstrap(env: Env, runId: string): Promise<RunBootstrap>;
export declare function handleHeartbeat(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleRunStatus(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleRunRecord(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleRunBootstrap(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleRunFail(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleRunReset(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleRunContext(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleNoLlmComplete(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleCurrentSession(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleIsCancelled(body: Record<string, unknown>, env: Env): Promise<Response>;
//# sourceMappingURL=executor-run-state.d.ts.map