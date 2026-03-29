import type { AuthenticatedRouteEnv } from '../route-auth';
declare const gitCommits: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/commits": {
        $get: {
            input: {
                query: {
                    branch?: string | undefined;
                    limit?: string | undefined;
                    page?: string | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/import": {
        $post: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                success: true;
                commit_sha: string;
                file_count: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/export": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                success: true;
                files: {
                    path: string;
                    content: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/status": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                success: true;
                name: string;
                branch: string;
                commit: string | null;
                file_count: number;
                last_updated: string | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/log": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/commit": {
        $post: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                success: true;
                commit_sha: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/repos/:repoId/commit">;
export default gitCommits;
//# sourceMappingURL=git-commits.d.ts.map