import type { AuthenticatedRouteEnv } from '../../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/actions/jobs/:jobId": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    jobId: string;
                };
            };
            output: {
                job: {
                    id: string;
                    run_id: string;
                    name: string;
                    status: string;
                    conclusion: string | null;
                    runner_name: string | null;
                    started_at: string | null;
                    completed_at: string | null;
                    steps: {
                        number: number;
                        name: string;
                        status: string;
                        conclusion: string | null;
                        exit_code: number | null;
                        error_message: string | null;
                        started_at: string | null;
                        completed_at: string | null;
                    }[];
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/jobs/:jobId/logs": {
        $get: {
            input: {
                query: {
                    limit?: string | undefined;
                    offset?: string | undefined;
                };
            } & {
                param: {
                    repoId: string;
                } & {
                    jobId: string;
                };
            };
            output: {
                logs: string;
                job_id: string;
                offset: number;
                next_offset: number;
                has_more: boolean;
                total_size: number | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/repos/:repoId/actions/jobs/:jobId/logs">;
export default _default;
//# sourceMappingURL=jobs.d.ts.map