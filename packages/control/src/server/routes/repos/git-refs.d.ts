import type { AuthenticatedRouteEnv } from '../route-auth';
declare const gitRefs: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
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
}, "/", "/repos/:repoId/branches/:branchName/default">;
export default gitRefs;
//# sourceMappingURL=git-refs.d.ts.map