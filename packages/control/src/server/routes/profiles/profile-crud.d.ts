import { type OptionalAuthRouteEnv } from '../route-auth';
export declare const profileCrudRoutes: import("hono/hono-base").HonoBase<OptionalAuthRouteEnv, {
    "/:username": {
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
                    bio: string | null;
                    picture: string | null;
                    public_repo_count: number;
                    followers_count: number;
                    following_count: number;
                    is_self: boolean;
                    private_account: boolean;
                    is_following: boolean;
                    follow_requested: boolean;
                    is_blocking: boolean;
                    is_muted: boolean;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/repos": {
        $get: {
            input: {
                query: {
                    sort?: string | undefined;
                    limit?: string | undefined;
                    offset?: string | undefined;
                    order?: string | undefined;
                };
            } & {
                param: {
                    username: string;
                };
            };
            output: {
                total: number;
                has_more: boolean;
                limit: number;
                offset: number;
                repos: {
                    owner_username: string;
                    name: string;
                    description: string | null;
                    visibility: "public" | "private";
                    default_branch: string;
                    stars: number;
                    forks: number;
                    is_starred: boolean;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/stars": {
        $get: {
            input: {
                query: {
                    limit?: string | undefined;
                    offset?: string | undefined;
                };
            } & {
                param: {
                    username: string;
                };
            };
            output: {
                total: number;
                has_more: boolean;
                limit: number;
                offset: number;
                repos: {
                    owner_username: string;
                    name: string;
                    description: string | null;
                    visibility: "public" | "private";
                    default_branch: string;
                    stars: number;
                    forks: number;
                    is_starred: boolean;
                    updated_at: string;
                    starred_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/activity": {
        $get: {
            input: {
                query: {
                    limit?: string | undefined;
                    before?: string | undefined;
                };
            } & {
                param: {
                    username: string;
                };
            };
            output: {
                events: {
                    id: string;
                    type: import("../../../application/services/identity/profile-activity").ActivityEventType;
                    created_at: string;
                    title: string;
                    repo?: {
                        owner_username: string;
                        name: string;
                    } | null | undefined;
                    data?: {
                        [x: string]: import("hono/utils/types").JSONValue;
                    } | undefined;
                }[];
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:username/activity">;
//# sourceMappingURL=profile-crud.d.ts.map