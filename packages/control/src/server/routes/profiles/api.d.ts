import type { OptionalAuthRouteEnv } from '../route-auth';
export type { UserProfileResponse, ProfileRepoResponse, FollowUserResponse, FollowRequestResponse } from './dto';
declare const profilesApi: import("hono/hono-base").HonoBase<OptionalAuthRouteEnv, import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<{
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
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/:username/followers": {
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
                followers: {
                    username: string;
                    name: string;
                    picture: string | null;
                    bio: string | null;
                    is_following: boolean;
                }[];
                total: number;
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/following": {
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
                following: {
                    username: string;
                    name: string;
                    picture: string | null;
                    bio: string | null;
                    is_following: boolean;
                }[];
                total: number;
                has_more: boolean;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/follow-requests": {
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
                requests: {
                    id: string;
                    requester: {
                        username: string;
                        name: string;
                        picture: string | null;
                        bio: string | null;
                        is_following: boolean;
                    };
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/follow-requests/:id/accept": {
        $post: {
            input: {
                param: {
                    username: string;
                } & {
                    id: string;
                };
            };
            output: {
                success: true;
                followers_count: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/follow-requests/:id/reject": {
        $post: {
            input: {
                param: {
                    username: string;
                } & {
                    id: string;
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
    "/:username/follow": {
        $post: {
            input: {
                param: {
                    username: string;
                };
            };
            output: {
                following: false;
                requested: true;
                followers_count: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                param: {
                    username: string;
                };
            };
            output: {
                following: true;
                requested: false;
                followers_count: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/follow": {
        $delete: {
            input: {
                param: {
                    username: string;
                };
            };
            output: {
                following: false;
                requested: false;
                followers_count: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/:username/block": {
        $post: {
            input: {
                param: {
                    username: string;
                };
            };
            output: {
                success: true;
                blocked: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/block": {
        $delete: {
            input: {
                param: {
                    username: string;
                };
            };
            output: {
                success: true;
                blocked: false;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/mute": {
        $post: {
            input: {
                param: {
                    username: string;
                };
            };
            output: {
                success: true;
                muted: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:username/mute": {
        $delete: {
            input: {
                param: {
                    username: string;
                };
            };
            output: {
                success: true;
                muted: false;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/">, "/", "/">;
export default profilesApi;
//# sourceMappingURL=api.d.ts.map