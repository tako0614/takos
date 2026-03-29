import { type AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/pulls/:prNumber/merge": {
        $post: {
            input: {
                json: {
                    commit_message?: string | undefined;
                    merge_method?: "merge" | "rebase" | "squash" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/pulls/:prNumber/conflicts": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {
                conflicts: {
                    path: string;
                    type: string;
                    base: string | null;
                    ours: string | null;
                    theirs: string | null;
                }[];
                merge_base: string | null;
                message: string;
            };
            outputFormat: "json";
            status: 409;
        } | {
            input: {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {
                conflicts: {
                    path: string;
                    type: string;
                    base: string | null;
                    ours: string | null;
                    theirs: string | null;
                }[];
                merge_base: string | null;
                is_mergeable: boolean;
                base_sha?: string | undefined;
                head_sha?: string | undefined;
                message?: string | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/pulls/:prNumber/resolve": {
        $post: {
            input: {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
}, "/", "/repos/:repoId/pulls/:prNumber/resolve">;
export default _default;
//# sourceMappingURL=merge-handlers.d.ts.map