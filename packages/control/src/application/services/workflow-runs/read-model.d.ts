import type { D1Database } from '../../../shared/types/bindings.ts';
type ListWorkflowRunsOptions = {
    repoId: string;
    workflow?: string;
    status?: string;
    branch?: string;
    event?: string;
    limit: number;
    offset: number;
};
export declare function listWorkflowRuns(db: D1Database, options: ListWorkflowRunsOptions): Promise<{
    runs: {
        id: string;
        workflow_path: string;
        event: string;
        ref: string | null;
        sha: string | null;
        status: string;
        conclusion: string | null;
        run_number: number | null;
        run_attempt: number;
        queued_at: any;
        started_at: any;
        completed_at: any;
        created_at: any;
        actor: {
            id: string;
            name: string | null;
            avatar_url: string | null;
        } | null;
    }[];
    has_more: boolean;
}>;
export declare function getWorkflowRunDetail(db: D1Database, repoId: string, runId: string): Promise<{
    run: {
        id: string;
        workflow_path: string;
        event: string;
        ref: string | null;
        sha: string | null;
        status: string;
        conclusion: string | null;
        run_number: number | null;
        run_attempt: number;
        inputs: null;
        queued_at: any;
        started_at: any;
        completed_at: any;
        created_at: any;
        actor: {
            id: string;
            name: string | null;
            avatar_url: string | null;
        } | null;
        jobs: {
            id: string;
            name: string;
            status: string;
            conclusion: string | null;
            runner_name: string | null;
            started_at: any;
            completed_at: any;
            steps: {
                number: number;
                name: string;
                status: string;
                conclusion: string | null;
                started_at: any;
                completed_at: any;
            }[];
        }[];
    };
} | null>;
export declare function getWorkflowRunJobs(db: D1Database, repoId: string, runId: string): Promise<{
    jobs: {
        id: string;
        name: string;
        status: string;
        conclusion: string | null;
        runner_name: string | null;
        started_at: any;
        completed_at: any;
    }[];
} | null>;
export {};
//# sourceMappingURL=read-model.d.ts.map