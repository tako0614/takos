import type { AuthenticatedRouteEnv } from '../../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/actions/runs": {
        $get: {
            input: {
                query: {
                    workflow?: string | undefined;
                    status?: string | undefined;
                    branch?: string | undefined;
                    event?: string | undefined;
                    limit?: string | undefined;
                    offset?: string | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                runs: any;
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/runs": {
        $post: {
            input: {
                json: {
                    workflow: string;
                    ref?: string | undefined;
                    inputs?: Record<string, unknown> | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                error: string;
                details: string[];
            } | {
                error: string;
            };
            outputFormat: "json";
            status: 500 | 400 | 404;
        } | {
            input: {
                json: {
                    workflow: string;
                    ref?: string | undefined;
                    inputs?: Record<string, unknown> | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
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
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/repos/:repoId/actions/runs/:runId": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {
                run: any;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/runs/:runId/ws": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/runs/:runId/cancel": {
        $post: {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {
                cancelled: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/runs/:runId/rerun": {
        $post: {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {
                error: string;
                details: string[];
            } | {
                error: string;
            };
            outputFormat: "json";
            status: 500 | 400 | 404;
        } | {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {
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
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/repos/:repoId/actions/runs/:runId/jobs": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {
                jobs: any;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/repos/:repoId/actions/runs/:runId/jobs">;
export default _default;
//# sourceMappingURL=runs.d.ts.map