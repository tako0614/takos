import type { AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<{
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
}, "/"> | import("hono/types").MergeSchemaPath<{
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
}, "/"> | import("hono/types").MergeSchemaPath<{
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
}, "/"> | import("hono/types").MergeSchemaPath<{
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
}, "/">, "/", "/">;
export default _default;
//# sourceMappingURL=index.d.ts.map