import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Run } from '../../../shared/types';
import { type RunHierarchyNode, type SpaceModelLookup } from './run-serialization';
type CreatePendingRunParams = {
    runId: string;
    threadId: string;
    spaceId: string;
    requesterAccountId: string;
    parentRunId: string | null;
    childThreadId: string | null;
    rootThreadId: string;
    rootRunId: string;
    agentType: string;
    input: string;
    createdAt: string;
};
type UpdateRunStatusParams = {
    runId: string;
    status: 'queued' | 'failed';
    error: string | null;
};
export type RunRateLimitResult = {
    allowed: boolean;
    reason?: string;
};
export declare function getRunHierarchyNode(dbBinding: D1Database, runId: string): Promise<RunHierarchyNode | null>;
export declare function getSpaceModel(dbBinding: D1Database, spaceId: string): Promise<SpaceModelLookup | null>;
export declare function getRunResponse(dbBinding: D1Database, runId: string): Promise<Run | null>;
export declare function createPendingRun(dbBinding: D1Database, params: CreatePendingRunParams): Promise<void>;
export declare function updateRunStatus(dbBinding: D1Database, params: UpdateRunStatusParams): Promise<void>;
export declare function checkRunRateLimits(dbBinding: D1Database, actorId: string, spaceId: string, options?: {
    isChildRun?: boolean;
}): Promise<RunRateLimitResult>;
export {};
//# sourceMappingURL=create-thread-run-store.d.ts.map