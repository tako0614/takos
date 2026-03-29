import { type AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/pulls/:prNumber/reviews": {
        $post: {
            input: {
                json: {
                    status: "approved" | "changes_requested" | "commented";
                    body?: string | undefined;
                };
            } & {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {
                review: {
                    id: string;
                    pr_id: string;
                    reviewer_type: "user" | "ai";
                    reviewer_id: string | null;
                    status: "approved" | "changes_requested" | "commented";
                    body: string | null;
                    analysis: string | null;
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
    "/repos/:repoId/pulls/:prNumber/reviews": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {
                reviews: {
                    id: string;
                    pr_id: string;
                    reviewer_type: "user" | "ai";
                    reviewer_id: string | null;
                    status: "approved" | "changes_requested" | "commented";
                    body: string | null;
                    analysis: string | null;
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
} & {
    "/repos/:repoId/pulls/:prNumber/ai-review": {
        $post: {
            input: {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {
                review: {
                    id: string;
                    pr_id: string;
                    reviewer_type: "user" | "ai";
                    reviewer_id: string | null;
                    status: "approved" | "changes_requested" | "commented";
                    body: string | null;
                    analysis: string | null;
                    created_at: string;
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    };
                };
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
                model: string;
                provider: string;
            };
            outputFormat: "json";
            status: 201;
        };
    };
}, "/", "/repos/:repoId/pulls/:prNumber/ai-review">;
export default _default;
//# sourceMappingURL=reviews.d.ts.map