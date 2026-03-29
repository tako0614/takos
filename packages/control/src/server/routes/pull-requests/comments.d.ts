import { type AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/pulls/:prNumber/comments": {
        $post: {
            input: {
                json: {
                    body?: string | undefined;
                    content?: string | undefined;
                    file_path?: string | undefined;
                    line_number?: number | undefined;
                };
            } & {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {
                comment: {
                    id: string;
                    pr_id: string;
                    author_type: "user" | "ai";
                    author_id: string | null;
                    body: string;
                    path: string | null;
                    line: number | null;
                    created_at: string;
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    };
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/repos/:repoId/pulls/:prNumber/comments": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {
                comments: {
                    id: string;
                    pr_id: string;
                    author_type: "user" | "ai";
                    author_id: string | null;
                    body: string;
                    path: string | null;
                    line: number | null;
                    created_at: string;
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    };
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/repos/:repoId/pulls/:prNumber/comments">;
export default _default;
//# sourceMappingURL=comments.d.ts.map