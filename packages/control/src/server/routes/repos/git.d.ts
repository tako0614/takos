import type { AuthenticatedRouteEnv } from '../route-auth';
declare const repoGit: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<{
    "/repos/:repoId/branches": {
        $get: {
            input: {
                query: {
                    include_commits?: string | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                branches: {
                    name: string;
                    is_default: boolean;
                    is_protected: boolean;
                    commit_sha: string;
                    latest_commit?: {
                        sha: string;
                        message: string;
                        author_name: string;
                        date: string;
                    } | undefined;
                }[];
                default_branch: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/branches": {
        $post: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                success: true;
                branch: {
                    name: string;
                    commit_sha: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/repos/:repoId/branches/:branchName": {
        $delete: {
            input: {
                param: {
                    repoId: string;
                } & {
                    branchName: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/branches/:branchName/default": {
        $post: {
            input: {
                param: {
                    repoId: string;
                } & {
                    branchName: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/repos/:repoId/tree/:ref/*": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    ref: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/tree/:ref": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    ref: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/blob/:ref/*": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    ref: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/blob/:ref": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    ref: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/diff/:baseHead": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    baseHead: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
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
}, "/">, "/", "/">;
export default repoGit;
//# sourceMappingURL=git.d.ts.map