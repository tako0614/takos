import type { Env } from '../../../shared/types';
import { getRunResponse } from '../runs/create-thread-run-store';
type CreateThreadRunInput = {
    userId: string;
    threadId: string;
    agentType?: string;
    input?: Record<string, unknown>;
    parentRunId?: string;
    model?: string;
};
type CreateThreadRunError = {
    ok: false;
    status: 400 | 404 | 429 | 500;
    error: string;
};
type CreateThreadRunSuccess = {
    ok: true;
    status: 201;
    run: Awaited<ReturnType<typeof getRunResponse>>;
};
export type CreateThreadRunResult = CreateThreadRunError | CreateThreadRunSuccess;
export declare function createThreadRun(env: Env, input: CreateThreadRunInput): Promise<CreateThreadRunResult>;
export {};
//# sourceMappingURL=run-creation.d.ts.map