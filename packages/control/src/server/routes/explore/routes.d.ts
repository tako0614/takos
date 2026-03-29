import type { Env, User } from '../../../shared/types';
type Variables = {
    user?: User;
};
declare const _default: import("hono/hono-base").HonoBase<{
    Bindings: Env;
    Variables: Variables;
}, import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<{
    "/repos": {
        $get: {
            input: {};
            output: {
                repos: {
                    id: string;
                    name: string;
                    description: string | null;
                    visibility: "public";
                    default_branch: string;
                    stars: number;
                    forks: number;
                    workspace: {
                        id: string;
                        name: string;
                    };
                    owner: {
                        id: string;
                        name: string;
                        username: string;
                        avatar_url: string | null;
                    };
                    is_starred: boolean;
                    created_at: string;
                    updated_at: string;
                }[];
                total: number;
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/trending": {
        $get: {
            input: {};
            output: {
                repos: {
                    id: string;
                    name: string;
                    description: string | null;
                    visibility: "public";
                    default_branch: string;
                    stars: number;
                    forks: number;
                    workspace: {
                        id: string;
                        name: string;
                    };
                    owner: {
                        id: string;
                        name: string;
                        username: string;
                        avatar_url: string | null;
                    };
                    is_starred: boolean;
                    created_at: string;
                    updated_at: string;
                }[];
                total: number;
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/new": {
        $get: {
            input: {};
            output: {
                repos: {
                    id: string;
                    name: string;
                    description: string | null;
                    visibility: "public";
                    default_branch: string;
                    stars: number;
                    forks: number;
                    workspace: {
                        id: string;
                        name: string;
                    };
                    owner: {
                        id: string;
                        name: string;
                        username: string;
                        avatar_url: string | null;
                    };
                    is_starred: boolean;
                    created_at: string;
                    updated_at: string;
                }[];
                total: number;
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/recent": {
        $get: {
            input: {};
            output: {
                repos: {
                    id: string;
                    name: string;
                    description: string | null;
                    visibility: "public";
                    default_branch: string;
                    stars: number;
                    forks: number;
                    workspace: {
                        id: string;
                        name: string;
                    };
                    owner: {
                        id: string;
                        name: string;
                        username: string;
                        avatar_url: string | null;
                    };
                    is_starred: boolean;
                    created_at: string;
                    updated_at: string;
                }[];
                total: number;
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/by-name/:username/:repoName": {
        $get: {
            input: {
                param: {
                    username: string;
                } & {
                    repoName: string;
                };
            };
            output: {
                repository: {
                    id: string;
                    name: string;
                    description: string | null;
                    visibility: string;
                    default_branch: string;
                    stars: number;
                    forks: number;
                    created_at: string;
                    updated_at: string;
                };
                workspace: {
                    id: string;
                    name: string;
                };
                owner: {
                    id: string;
                    name: string;
                    username: string;
                    avatar_url: string | null;
                };
                is_starred: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/repos/:id": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                repository: {
                    id: string;
                    name: string;
                    description: string | null;
                    visibility: string;
                    default_branch: string;
                    stars: number;
                    forks: number;
                    created_at: string;
                    updated_at: string;
                };
                workspace: {
                    id: string | null;
                    name: string | null;
                };
                owner: {
                    id: string | null;
                    name: string | null;
                    username: string | null;
                    avatar_url: string | null;
                };
                is_starred: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/catalog": {
        $get: {
            input: {};
            output: {
                items: {
                    repo: {
                        id: string;
                        name: string;
                        description: string | null;
                        visibility: "public";
                        default_branch: string;
                        stars: number;
                        forks: number;
                        category: string | null;
                        language: string | null;
                        license: string | null;
                        is_starred: boolean;
                        created_at: string;
                        updated_at: string;
                        workspace: {
                            id: string;
                            name: string;
                        };
                        owner: {
                            id: string;
                            name: string;
                            username: string;
                            avatar_url: string | null;
                        };
                    };
                    takopack: {
                        available: boolean;
                        app_id: string | null;
                        latest_version: string | null;
                        latest_tag: string | null;
                        release_id: string | null;
                        release_tag: string | null;
                        asset_id: string | null;
                        description: string | null;
                        icon: string | null;
                        category: string | null;
                        tags: string[];
                        downloads: number;
                        rating_avg: number | null;
                        rating_count: number;
                        publish_status: "none" | "pending" | "approved" | "rejected";
                        certified: boolean;
                        published_at: string | null;
                    };
                    installation?: {
                        installed: boolean;
                        bundle_deployment_id: string | null;
                        installed_version: string | null;
                        deployed_at: string | null;
                    } | undefined;
                    official?: boolean | undefined;
                }[];
                total: number;
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/suggest": {
        $get: {
            input: {};
            output: {
                users: {
                    username: string;
                    name: string;
                    avatar_url: string | null;
                }[];
                repos: {
                    id: string;
                    name: string;
                    description: string | null;
                    stars: number;
                    updated_at: string;
                    owner: {
                        username: string;
                        name: string | null;
                        avatar_url: string | null;
                    };
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/catalog/suggest": {
        $get: {
            input: {};
            output: {
                users: {
                    username: string;
                    name: string;
                    avatar_url: string | null;
                }[];
                repos: {
                    id: string;
                    name: string;
                    description: string | null;
                    stars: number;
                    updated_at: string;
                    owner: {
                        username: string;
                        name: string | null;
                        avatar_url: string | null;
                    };
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/packages": {
        $get: {
            input: {};
            output: {
                packages: {
                    id: string;
                    name: string;
                    app_id: string;
                    version: string;
                    description: string | null;
                    icon: string | undefined;
                    category: string | undefined;
                    tags: string[] | undefined;
                    repository: {
                        id: string;
                        name: string;
                        description: string | null;
                        stars: number;
                    };
                    owner: {
                        id: string;
                        name: string;
                        username: string;
                        avatar_url: string | null;
                    } | null;
                    release: {
                        id: string;
                        tag: string;
                        published_at: string | null;
                    };
                    asset: {
                        id: string;
                        name: string;
                        size: number;
                        download_count: number;
                    };
                    total_downloads: number;
                    published_at: string | null;
                    rating_avg: number | null;
                    rating_count: number;
                    publish_status: string;
                    certified: boolean;
                }[];
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/packages/suggest": {
        $get: {
            input: {};
            output: {
                packages: {
                    id: string;
                    name: string;
                    app_id: string;
                    version: string;
                    description: string | null;
                    icon: string | undefined;
                    category: string | undefined;
                    tags: string[] | undefined;
                    repository: {
                        id: string;
                        name: string;
                        description: string | null;
                        stars: number;
                    };
                    owner: {
                        id: string;
                        name: string;
                        username: string;
                        avatar_url: string | null;
                    } | null;
                    release: {
                        id: string;
                        tag: string;
                        published_at: string | null;
                    };
                    asset: {
                        id: string;
                        name: string;
                        size: number;
                        download_count: number;
                    };
                    total_downloads: number;
                    published_at: string | null;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/packages/:username/:repoName/latest": {
        $get: {
            input: {
                param: {
                    username: string;
                } & {
                    repoName: string;
                };
            };
            output: {
                package: {
                    name: string;
                    app_id: string;
                    version: string;
                    description: string | null;
                    icon: string | undefined;
                    repository: {
                        id: string;
                        name: string;
                        description: string | null;
                        stars: number;
                    };
                    owner: {
                        id: string;
                        name: string;
                        username: string;
                        avatar_url: string | null;
                    };
                    release: {
                        id: string;
                        tag: string;
                        published_at: string | null;
                    };
                    asset: {
                        id: string;
                        name: string;
                        size: number;
                        download_count: number;
                    };
                    published_at: string | null;
                    rating_avg: number | null;
                    rating_count: number;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/packages/:username/:repoName/versions": {
        $get: {
            input: {
                param: {
                    username: string;
                } & {
                    repoName: string;
                };
            };
            output: {
                versions: {
                    tag: string;
                    app_id: string;
                    version: string;
                    is_prerelease: boolean;
                    asset_id: string;
                    size: number;
                    download_count: number;
                    published_at: string | null;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/packages/by-repo/:repoId/reviews": {
        $get: {
            input: {
                param: {
                    repoId: string;
                };
            };
            output: {
                repo: {
                    id: string;
                    name: string;
                };
                rating: {
                    rating_avg: number | null;
                    rating_count: number;
                };
                reviews: never[];
                viewer_review: null;
                has_more: false;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/users": {
        $get: {
            input: {};
            output: {
                users: {
                    username: string;
                    name: string;
                    avatar_url: string | null;
                    public_repo_count: number;
                }[];
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/users/:username": {
        $get: {
            input: {
                param: {
                    username: string;
                };
            };
            output: {
                user: {
                    username: string;
                    name: string;
                    avatar_url: string | null;
                    bio: string | null;
                };
                repositories: {
                    id: string;
                    name: string;
                    description: string | null;
                    visibility: string;
                    stars: number;
                    forks: number;
                    created_at: string;
                    updated_at: string;
                    workspace: {
                        slug: string | null;
                        name: string | null;
                    };
                    owner: {
                        username: string;
                        name: string;
                        avatar_url: string | null;
                    };
                    is_starred: boolean;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/">, "/", "/">;
export default _default;
//# sourceMappingURL=routes.d.ts.map