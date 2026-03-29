import type { AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<import("hono/types").BlankSchema, "/"> | import("hono/types").MergeSchemaPath<{
    "/spaces/:spaceId/repos": {
        $post: {
            input: {
                json: {
                    name: string;
                    description?: string | undefined;
                    visibility?: "private" | "public" | "internal" | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                repository: {
                    owner_username: string;
                    name: string;
                    description: string | null;
                    visibility: import("../../../shared/types").RepositoryVisibility;
                    default_branch: string;
                    stars: number;
                    forks: number;
                    git_enabled: number | boolean;
                    created_at: string | null;
                    updated_at: string | null;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/spaces/:spaceId/repos": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                repositories: {
                    id: string;
                    owner_username: string;
                    owner: {
                        username: string;
                    } | undefined;
                    name: string;
                    description: string | null;
                    visibility: import("../../../shared/types").RepositoryVisibility;
                    default_branch: string;
                    stars: number;
                    forks: number;
                    git_enabled: boolean;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                repository: {
                    owner_username: string;
                    name: string;
                    description: string | null;
                    visibility: import("../../../shared/types").RepositoryVisibility;
                    default_branch: string;
                    stars: number;
                    forks: number;
                    git_enabled: number | boolean;
                    created_at: string | null;
                    updated_at: string | null;
                };
                branch_count: number;
                starred: boolean;
                user_role: import("../../../shared/types").SpaceRole | null;
                workspace: {
                    name: string;
                } | null;
                owner: {
                    name: string;
                    picture: string | null;
                } | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId": {
        $patch: {
            input: {
                json: {
                    name?: string | undefined;
                    description?: string | undefined;
                    visibility?: "private" | "public" | "internal" | undefined;
                    default_branch?: string | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                repository: {
                    owner_username: string;
                    name: string;
                    description: string | null;
                    visibility: import("../../../shared/types").RepositoryVisibility;
                    default_branch: string;
                    stars: number;
                    forks: number;
                    git_enabled: number | boolean;
                    created_at: string | null;
                    updated_at: string | null;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId": {
        $delete: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<import("hono/types").MergeSchemaPath<{
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
}, "/">, "/"> | import("hono/types").MergeSchemaPath<import("hono/types").MergeSchemaPath<{
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
}, "/">, "/"> | import("hono/types").MergeSchemaPath<import("hono/types").MergeSchemaPath<{
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
}, "/">, "/"> | import("hono/types").MergeSchemaPath<{
    "/repos/:repoId/search": {
        $get: {
            input: {
                query: {
                    ref?: string | undefined;
                    path_prefix?: string | undefined;
                    limit?: string | undefined;
                    q?: string | undefined;
                    case_sensitive?: string | undefined;
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
    "/repos/:repoId/semantic-search": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                query: string;
                matches: {
                    score: number;
                    content: string;
                    filePath: string;
                    chunkIndex: number;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/semantic-index": {
        $post: {
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
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/repos/:repoId/star": {
        $post: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                starred: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/star": {
        $delete: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                starred: false;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/starred": {
        $get: {
            input: {};
            output: {
                repos: any;
                has_more: boolean;
                total: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/star": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                starred: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/repos/:repoId/fork": {
        $post: {
            input: {
                json: {
                    name?: string | undefined;
                    target_space_id?: string | undefined;
                    copy_workflows?: boolean | undefined;
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
}, "/"> | import("hono/types").MergeSchemaPath<import("hono/types").MergeSchemaPath<{
    "/repos/:repoId/releases": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                releases: {
                    id: string;
                    repo_id: string;
                    tag: string;
                    name: string | null;
                    description: string | null;
                    commit_sha: string | null;
                    is_prerelease: boolean;
                    is_draft: boolean;
                    assets: {
                        id: string;
                        name: string;
                        content_type: string;
                        size: number;
                        r2_key: string;
                        download_count: number;
                        bundle_format?: string | undefined;
                        bundle_meta?: {
                            name?: string | undefined;
                            app_id?: string | undefined;
                            version: string;
                            description?: string | undefined;
                            icon?: string | undefined;
                            category?: "app" | "service" | "library" | "template" | "social" | undefined;
                            tags?: string[] | undefined;
                            dependencies?: {
                                repo: string;
                                version: string;
                            }[] | undefined;
                        } | undefined;
                        created_at: string;
                    }[];
                    author_id: string | null;
                    published_at: string | null;
                    created_at: string;
                    updated_at: string;
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    } | null;
                }[];
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/releases/:tag": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    tag: string;
                };
            };
            output: {
                release: {
                    id: string;
                    repo_id: string;
                    tag: string;
                    name: string | null;
                    description: string | null;
                    commit_sha: string | null;
                    is_prerelease: boolean;
                    is_draft: boolean;
                    assets: {
                        id: string;
                        name: string;
                        content_type: string;
                        size: number;
                        r2_key: string;
                        download_count: number;
                        bundle_format?: string | undefined;
                        bundle_meta?: {
                            name?: string | undefined;
                            app_id?: string | undefined;
                            version: string;
                            description?: string | undefined;
                            icon?: string | undefined;
                            category?: "app" | "service" | "library" | "template" | "social" | undefined;
                            tags?: string[] | undefined;
                            dependencies?: {
                                repo: string;
                                version: string;
                            }[] | undefined;
                        } | undefined;
                        created_at: string;
                    }[];
                    author_id: string | null;
                    published_at: string | null;
                    created_at: string;
                    updated_at: string;
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    } | null;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/releases": {
        $post: {
            input: {
                json: {
                    tag: string;
                    name?: string | null | undefined;
                    description?: string | null | undefined;
                    commit_sha?: string | undefined;
                    is_prerelease?: boolean | undefined;
                    is_draft?: boolean | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                release: {
                    id: string | undefined;
                    repo_id: string | undefined;
                    tag: string | undefined;
                    name: string | null | undefined;
                    description: string | null | undefined;
                    commit_sha: string | null | undefined;
                    is_prerelease: boolean;
                    is_draft: boolean;
                    assets: {
                        id: string;
                        name: string;
                        content_type: string;
                        size: number;
                        r2_key: string;
                        download_count: number;
                        bundle_format?: string | undefined;
                        bundle_meta?: {
                            name?: string | undefined;
                            app_id?: string | undefined;
                            version: string;
                            description?: string | undefined;
                            icon?: string | undefined;
                            category?: "app" | "service" | "library" | "template" | "social" | undefined;
                            tags?: string[] | undefined;
                            dependencies?: {
                                repo: string;
                                version: string;
                            }[] | undefined;
                        } | undefined;
                        created_at: string;
                    }[];
                    author_id: string | null | undefined;
                    published_at: string | null | undefined;
                    created_at: string | undefined;
                    updated_at: string | undefined;
                    author: any;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/repos/:repoId/releases/:tag": {
        $patch: {
            input: {
                json: {
                    name?: string | null | undefined;
                    description?: string | null | undefined;
                    is_prerelease?: boolean | undefined;
                    is_draft?: boolean | undefined;
                };
            } & {
                param: {
                    repoId: string;
                } & {
                    tag: string;
                };
            };
            output: {
                release: {
                    id: string | undefined;
                    repo_id: string | undefined;
                    tag: string | undefined;
                    name: string | null | undefined;
                    description: string | null | undefined;
                    commit_sha: string | null | undefined;
                    is_prerelease: boolean;
                    is_draft: boolean;
                    assets: {
                        id: string;
                        name: string;
                        content_type: string;
                        size: number;
                        r2_key: string;
                        download_count: number;
                        bundle_format?: string | undefined;
                        bundle_meta?: {
                            name?: string | undefined;
                            app_id?: string | undefined;
                            version: string;
                            description?: string | undefined;
                            icon?: string | undefined;
                            category?: "app" | "service" | "library" | "template" | "social" | undefined;
                            tags?: string[] | undefined;
                            dependencies?: {
                                repo: string;
                                version: string;
                            }[] | undefined;
                        } | undefined;
                        created_at: string;
                    }[];
                    author_id: string | null | undefined;
                    published_at: string | null | undefined;
                    created_at: string | undefined;
                    updated_at: string | undefined;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/releases/:tag": {
        $delete: {
            input: {
                param: {
                    repoId: string;
                } & {
                    tag: string;
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
                    tag: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: 200 | 201;
        };
    };
} & {
    "/repos/:repoId/releases/latest": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                release: {
                    id: string;
                    repo_id: string;
                    tag: string;
                    name: string | null;
                    description: string | null;
                    commit_sha: string | null;
                    is_prerelease: false;
                    is_draft: false;
                    assets: {
                        id: string;
                        name: string;
                        content_type: string;
                        size: number;
                        r2_key: string;
                        download_count: number;
                        bundle_format?: string | undefined;
                        bundle_meta?: {
                            name?: string | undefined;
                            app_id?: string | undefined;
                            version: string;
                            description?: string | undefined;
                            icon?: string | undefined;
                            category?: "app" | "service" | "library" | "template" | "social" | undefined;
                            tags?: string[] | undefined;
                            dependencies?: {
                                repo: string;
                                version: string;
                            }[] | undefined;
                        } | undefined;
                        created_at: string;
                    }[];
                    author_id: string | null;
                    published_at: string | null;
                    created_at: string;
                    updated_at: string;
                    author: {
                        id: string;
                        name: string;
                        avatar_url: string | null;
                    } | null;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/">, "/"> | import("hono/types").MergeSchemaPath<import("hono/types").MergeSchemaPath<{
    "/repos/:repoId/releases/:tag/assets": {
        $post: {
            input: {
                param: {
                    repoId: string;
                } & {
                    tag: string;
                };
            };
            output: {
                asset: {
                    id: string;
                    name: string;
                    content_type: string;
                    size: number;
                    download_count: number;
                    bundle_format: string | undefined;
                    bundle_meta: {
                        name?: string | undefined;
                        app_id?: string | undefined;
                        version: string;
                        description?: string | undefined;
                        icon?: string | undefined;
                        category?: "app" | "service" | "library" | "template" | "social" | undefined;
                        tags?: string[] | undefined;
                        dependencies?: {
                            repo: string;
                            version: string;
                        }[] | undefined;
                    } | undefined;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/repos/:repoId/releases/:tag/assets/:assetId/download": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    tag: string;
                } & {
                    assetId: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/releases/:tag/assets/:assetId": {
        $delete: {
            input: {
                param: {
                    repoId: string;
                } & {
                    tag: string;
                } & {
                    assetId: string;
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
                    tag: string;
                } & {
                    assetId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: 200 | 201;
        };
    };
} & {
    "/repos/:repoId/releases/:tag/assets": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    tag: string;
                };
            };
            output: {
                assets: {
                    id: string;
                    name: string;
                    content_type: string;
                    size: number;
                    download_count: number;
                    bundle_format: string | undefined;
                    bundle_meta: {
                        name?: string | undefined;
                        app_id?: string | undefined;
                        version: string;
                        description?: string | undefined;
                        icon?: string | undefined;
                        category?: "app" | "service" | "library" | "template" | "social" | undefined;
                        tags?: string[] | undefined;
                        dependencies?: {
                            repo: string;
                            version: string;
                        }[] | undefined;
                    } | undefined;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/">, "/"> | import("hono/types").MergeSchemaPath<{
    "/repos/:repoId/fetch": {
        $post: {
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
    "/repos/:repoId/sync": {
        $post: {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                synced: false;
                commits_behind: number;
                commits_ahead: number;
                new_commits: number;
                conflict: true;
                has_merge_base: false;
                merge_base: null;
                message: string;
            };
            outputFormat: "json";
            status: 409;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                synced: false;
                commits_behind: number;
                commits_ahead: number;
                new_commits: number;
                conflict: false;
                has_merge_base: true;
                message: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                synced: false;
                commits_behind: number;
                commits_ahead: number;
                new_commits: number;
                conflict: true;
                has_merge_base: true;
                message: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                synced: true;
                commits_behind: number;
                commits_ahead: number;
                new_commits: number;
                conflict: false;
                has_merge_base: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                status: string;
                conflicts: never[];
                merge_base: null;
                conflict: true;
                has_merge_base: false;
                message: string;
            };
            outputFormat: "json";
            status: 409;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                status: string;
                conflicts: {
                    path: string;
                    type: import("../../../application/services/git-smart").MergeConflictType;
                }[];
                merge_base: string;
                conflict: true;
                has_merge_base: true;
            };
            outputFormat: "json";
            status: 409;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                error: string;
                current: string | undefined;
            };
            outputFormat: "json";
            status: 409;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                status: string;
                ref: string;
                merge_commit: string;
                parents: string[];
                conflict: false;
                has_merge_base: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                json: {
                    branch?: string | undefined;
                    remote?: string | undefined;
                    strategy?: "merge" | "fast-forward" | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                error: string;
                code: import("./shared").TreeFlattenLimitErrorCode;
                detail: string;
            };
            outputFormat: "json";
            status: 413;
        };
    };
} & {
    "/repos/:repoId/sync/status": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                can_sync: false;
                can_fast_forward: false;
                commits_behind: number;
                commits_ahead: number;
                has_merge_base: true;
                conflict: false;
                error: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                can_sync: boolean;
                can_fast_forward: boolean;
                commits_behind: number;
                commits_ahead: number;
                has_merge_base: boolean;
                conflict: boolean;
                upstream: {
                    id: string;
                    name: string;
                    space_id: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
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
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/repos/:repoId/actions/runs": {
        $get: {
            input: {
                query: {
                    workflow?: string | undefined;
                    status?: string | undefined;
                    branch?: string | undefined;
                    event?: string | undefined;
                    limit?: string | undefined;
                    offset?: string | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                runs: any;
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/runs": {
        $post: {
            input: {
                json: {
                    workflow: string;
                    ref?: string | undefined;
                    inputs?: Record<string, unknown> | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                error: string;
                details: string[];
            } | {
                error: string;
            };
            outputFormat: "json";
            status: 500 | 400 | 404;
        } | {
            input: {
                json: {
                    workflow: string;
                    ref?: string | undefined;
                    inputs?: Record<string, unknown> | undefined;
                };
            } & {
                param: {
                    repoId: string;
                };
            };
            output: {
                run: {
                    id: string;
                    workflow_path: string;
                    event: string;
                    ref: string;
                    sha: string;
                    status: string;
                    run_number: number;
                    run_attempt: number;
                    queued_at: string;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/repos/:repoId/actions/runs/:runId": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {
                run: any;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/runs/:runId/ws": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/runs/:runId/cancel": {
        $post: {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {
                cancelled: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/runs/:runId/rerun": {
        $post: {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {
                error: string;
                details: string[];
            } | {
                error: string;
            };
            outputFormat: "json";
            status: 500 | 400 | 404;
        } | {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {
                run: {
                    id: string;
                    workflow_path: string;
                    event: string;
                    ref: string;
                    sha: string;
                    status: string;
                    run_number: number | null;
                    run_attempt: number;
                    queued_at: string;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/repos/:repoId/actions/runs/:runId/jobs": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {
                jobs: any;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/repos/:repoId/actions/jobs/:jobId": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    jobId: string;
                };
            };
            output: {
                job: {
                    id: string;
                    run_id: string;
                    name: string;
                    status: string;
                    conclusion: string | null;
                    runner_name: string | null;
                    started_at: string | null;
                    completed_at: string | null;
                    steps: {
                        number: number;
                        name: string;
                        status: string;
                        conclusion: string | null;
                        exit_code: number | null;
                        error_message: string | null;
                        started_at: string | null;
                        completed_at: string | null;
                    }[];
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/jobs/:jobId/logs": {
        $get: {
            input: {
                query: {
                    limit?: string | undefined;
                    offset?: string | undefined;
                };
            } & {
                param: {
                    repoId: string;
                } & {
                    jobId: string;
                };
            };
            output: {
                logs: string;
                job_id: string;
                offset: number;
                next_offset: number;
                has_more: boolean;
                total_size: number | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/repos/:repoId/actions/secrets": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                secrets: {
                    name: string;
                    created_at: string;
                    updated_at: string | null;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/secrets/:name": {
        $put: {
            input: {
                param: {
                    name: string;
                } & {
                    repoId: string;
                };
            };
            output: {
                name: string;
                created_at: string;
                updated_at: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/secrets/:name": {
        $delete: {
            input: {
                param: {
                    name: string;
                } & {
                    repoId: string;
                };
            };
            output: null;
            outputFormat: "body";
            status: 204;
        } | {
            input: {
                param: {
                    name: string;
                } & {
                    repoId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: 200 | 201;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/repos/:repoId/actions/runs/:runId/artifacts": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    runId: string;
                };
            };
            output: {
                artifacts: {
                    id: string;
                    name: string;
                    size_bytes: number | null;
                    mime_type: string | null;
                    expires_at: string | null;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/artifacts/:artifactId": {
        $get: {
            input: {
                param: {
                    repoId: string;
                } & {
                    artifactId: string;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/repos/:repoId/actions/artifacts/:artifactId": {
        $delete: {
            input: {
                param: {
                    repoId: string;
                } & {
                    artifactId: string;
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
                    artifactId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: 200 | 201;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
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
}, "/">, "/", "/">;
export default _default;
//# sourceMappingURL=index.d.ts.map