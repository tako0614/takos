import { type OptionalAuthRouteEnv } from '../route-auth';
export declare const followRoutes: import("hono/hono-base").HonoBase<OptionalAuthRouteEnv, {
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
}, "/", "/:username/follow">;
//# sourceMappingURL=follow.d.ts.map