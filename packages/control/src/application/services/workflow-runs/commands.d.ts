import type { Env } from '../../../shared/types';
export declare function dispatchWorkflowRun(env: Env, params: {
    repoId: string;
    workflowPath: string;
    refName: string;
    actorId: string;
    inputs?: Record<string, unknown>;
}): Promise<{
    ok: false;
    status: 500;
    error: string;
    details?: undefined;
    run?: undefined;
} | {
    ok: false;
    status: 404;
    error: string;
    details?: undefined;
    run?: undefined;
} | {
    ok: false;
    status: 400;
    error: string;
    details: string[];
    run?: undefined;
} | {
    ok: true;
    status: 201;
    run: {
        id: string;
        workflow_path: string;
        event: string;
        ref: string;
        sha: string;
        status: string;
        run_number: number;
        run_attempt: number;
        queued_at: string;
        created_at: string;
    };
    error?: undefined;
    details?: undefined;
}>;
export declare function cancelWorkflowRun(env: Env, params: {
    repoId: string;
    runId: string;
}): Promise<{
    ok: false;
    status: 404;
    error: string;
    cancelled?: undefined;
} | {
    ok: false;
    status: 400;
    error: string;
    cancelled?: undefined;
} | {
    ok: true;
    status: 200;
    cancelled: boolean;
    error?: undefined;
}>;
export declare function rerunWorkflowRun(env: Env, params: {
    repoId: string;
    runId: string;
    actorId: string;
    defaultBranch: string;
}): Promise<{
    ok: false;
    status: 404;
    error: string;
    details?: undefined;
    run?: undefined;
} | {
    ok: false;
    status: 400;
    error: string;
    details?: undefined;
    run?: undefined;
} | {
    ok: false;
    status: 500;
    error: string;
    details?: undefined;
    run?: undefined;
} | {
    ok: false;
    status: 400;
    error: string;
    details: string[];
    run?: undefined;
} | {
    ok: true;
    status: 201;
    run: {
        id: string;
        workflow_path: string;
        event: string;
        ref: string;
        sha: string;
        status: string;
        run_number: number | null;
        run_attempt: number;
        queued_at: string;
        created_at: string;
    };
    error?: undefined;
    details?: undefined;
}>;
//# sourceMappingURL=commands.d.ts.map