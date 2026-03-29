import { type AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/repos/:repoId/pulls": {
        $post: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                pull_request: {
                    id: string;
                    repo_id: string;
                    number: number;
                    title: string;
                    description: string | null;
                    status: "open" | "merged" | "closed";
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    };
                    source_branch: string;
                    target_branch: string;
                    commits_count: number;
                    comments_count: number;
                    reviews_count: number;
                    is_mergeable: boolean;
                    created_at: string;
                    updated_at: string;
                    merged_at: string | null;
                    closed_at: string | null;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/repos/:repoId/pulls": {
        $get: {
            input: {
                query: {
                    status?: string | undefined;
                    limit?: string | undefined;
                    offset?: string | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                pull_requests: {
                    id: string;
                    repo_id: string;
                    number: number;
                    title: string;
                    description: string | null;
                    status: "open" | "merged" | "closed";
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    };
                    source_branch: string;
                    target_branch: string;
                    commits_count: number;
                    comments_count: number;
                    reviews_count: number;
                    is_mergeable: boolean;
                    created_at: string;
                    updated_at: string;
                    merged_at: string | null;
                    closed_at: string | null;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/pulls/:prNumber": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {
                pull_request: {
                    id: string;
                    repo_id: string;
                    number: number;
                    title: string;
                    description: string | null;
                    status: "open" | "merged" | "closed";
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    };
                    source_branch: string;
                    target_branch: string;
                    commits_count: number;
                    comments_count: number;
                    reviews_count: number;
                    is_mergeable: boolean;
                    created_at: string;
                    updated_at: string;
                    merged_at: string | null;
                    closed_at: string | null;
                };
                diff: {
                    base: string;
                    head: string;
                    files: {
                        path: string;
                        status: import("./diff").FileStatus;
                        additions: number;
                        deletions: number;
                    }[];
                    stats: {
                        total_additions: number;
                        total_deletions: number;
                        files_changed: number;
                    };
                } | null;
                diff_stats: {
                    total_additions: number;
                    total_deletions: number;
                    files_changed: number;
                } | null;
                review_count: number;
                comment_count: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/pulls/:prNumber/diff": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {
                error: string;
                message?: string | undefined;
            };
            outputFormat: "json";
            status: 500 | 404 | 422;
        } | {
            input: {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {
                base: string;
                head: string;
                files: {
                    path: string;
                    status: import("./diff").FileStatus;
                    additions: number;
                    deletions: number;
                    hunks: {
                        old_start: number;
                        old_lines: number;
                        new_start: number;
                        new_lines: number;
                        lines: {
                            type: "context" | "addition" | "deletion";
                            content: string;
                            old_line?: number | undefined;
                            new_line?: number | undefined;
                        }[];
                    }[];
                }[];
                stats: {
                    total_additions: number;
                    total_deletions: number;
                    files_changed: number;
                };
                truncated: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/pulls/:prNumber": {
        $patch: {
            input: {
                json: {
                    description?: string | undefined;
                    title?: string | undefined;
                };
            } & {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {
                pull_request: {
                    id: string;
                    repo_id: string;
                    number: number;
                    title: string;
                    description: string | null;
                    status: "open" | "merged" | "closed";
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    };
                    source_branch: string;
                    target_branch: string;
                    commits_count: number;
                    comments_count: number;
                    reviews_count: number;
                    is_mergeable: boolean;
                    created_at: string;
                    updated_at: string;
                    merged_at: string | null;
                    closed_at: string | null;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/pulls/:prNumber/close": {
        $post: {
            input: {
                param: {
                    repoId: string;
                } & {
                    prNumber: string;
                };
            };
            output: {
                pull_request: {
                    id: string;
                    repo_id: string;
                    number: number;
                    title: string;
                    description: string | null;
                    status: "open" | "merged" | "closed";
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    };
                    source_branch: string;
                    target_branch: string;
                    commits_count: number;
                    comments_count: number;
                    reviews_count: number;
                    is_mergeable: boolean;
                    created_at: string;
                    updated_at: string;
                    merged_at: string | null;
                    closed_at: string | null;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/repos/:repoId/pulls/:prNumber/close">;
export default _default;
//# sourceMappingURL=routes.d.ts.map