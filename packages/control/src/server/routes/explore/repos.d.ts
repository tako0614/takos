import type { Env, User } from '../../../shared/types';
type Variables = {
    user?: User;
};
declare const _default: import("hono/hono-base").HonoBase<{
    Bindings: Env;
    Variables: Variables;
}, {
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
}, "/", "/repos/:id">;
export default _default;
//# sourceMappingURL=repos.d.ts.map