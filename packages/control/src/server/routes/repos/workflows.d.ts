import type { AuthenticatedRouteEnv } from '../route-auth';
declare const workflowsRouter: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/workflows": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                workflows: any;
                uncached_paths: string[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/workflows/:path{.+}": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    path: string;
                };
            };
            output: {
                workflow: {
                    id: string;
                    path: string;
                    name: string | null;
                    content: string;
                    triggers: string[];
                    parsed_at: string | null;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/workflows/:path{.+}/sync": {
        $post: {
            input: {
                param: {
                    repoId: string;
                } & {
                    path: string;
                };
            };
            output: {
                workflow: {
                    id: string;
                    path: string;
                    name: string | null;
                    content: string;
                    triggers: string[];
                    parsed_at: string;
                    errors: string[] | undefined;
                };
                synced: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/workflows/sync-all": {
        $post: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                synced: string[];
                errors: {
                    path: string;
                    error: string;
                }[] | undefined;
                total: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/workflows/:path{.+}": {
        $delete: {
            input: {
                param: {
                    repoId: string;
                } & {
                    path: string;
                };
            };
            output: null;
            outputFormat: "body";
            status: 204;
        } | {
            input: {
                param: {
                    repoId: string;
                } & {
                    path: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: 200 | 201;
        };
    };
}, "/", "/repos/:repoId/workflows/:path{.+}">;
export default workflowsRouter;
//# sourceMappingURL=workflows.d.ts.map