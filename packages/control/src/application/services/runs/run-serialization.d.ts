import type { Run } from '../../../shared/types';
export type RunRow = {
    id: string;
    threadId: string;
    spaceId: string;
    sessionId: string | null;
    parentRunId: string | null;
    childThreadId: string | null;
    rootThreadId: string | null;
    rootRunId: string | null;
    agentType: string;
    status: string;
    input: string;
    output: string | null;
    error: string | null;
    usage: string;
    serviceId?: string | null;
    workerId?: string | null;
    serviceHeartbeat?: string | Date | null;
    workerHeartbeat?: string | Date | null;
    startedAt: string | Date | null;
    completedAt: string | Date | null;
    createdAt: string | Date;
};
export type RunHierarchyNode = {
    id: string;
    threadId: string;
    accountId: string;
    parentRunId: string | null;
    rootThreadId: string | null;
    rootRunId: string | null;
};
export type SpaceModelLookup = {
    aiModel: string | null;
};
export type D1CountRow = {
    count: number | string;
};
export declare const runSelect: {
    readonly id: true;
    readonly threadId: true;
    readonly spaceId: true;
    readonly sessionId: true;
    readonly parentRunId: true;
    readonly childThreadId: true;
    readonly rootThreadId: true;
    readonly rootRunId: true;
    readonly agentType: true;
    readonly status: true;
    readonly input: true;
    readonly output: true;
    readonly error: true;
    readonly usage: true;
    readonly serviceId: true;
    readonly serviceHeartbeat: true;
    readonly startedAt: true;
    readonly completedAt: true;
    readonly createdAt: true;
};
export declare function asRunRow(row: Record<string, unknown>): RunRow;
export declare function runRowToApi(row: RunRow): Run;
//# sourceMappingURL=run-serialization.d.ts.map