/**
 * External Git Repository Import Routes.
 *
 * POST /repos/import-external         — Import a repo from an external Git URL
 * POST /repos/:repoId/fetch-remote    — Re-fetch updates from the remote origin
 */
import type { AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/import-external": {
        $post: {
            input: {};
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 401;
        } | {
            input: {};
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
        } | {
            input: {};
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
        } | {
            input: {};
            output: {
                repository: {
                    id: string;
                    name: string;
                    default_branch: string;
                    remote_clone_url: string;
                };
                import_summary: {
                    branches: number;
                    tags: number;
                    commits: number;
                };
            };
            outputFormat: "json";
            status: 201;
        } | {
            input: {};
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 409;
        } | {
            input: {};
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
        };
    };
} & {
    "/repos/:repoId/fetch-remote": {
        $post: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 401;
        } | {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 400;
        } | {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 500;
        } | {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 404;
        } | {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                new_commits: number;
                updated_branches: string[];
                new_tags: string[];
                up_to_date: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/repos/:repoId/fetch-remote">;
export default _default;
//# sourceMappingURL=external-import.d.ts.map