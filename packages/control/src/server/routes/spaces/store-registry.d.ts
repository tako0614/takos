import { type AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/:spaceId/store-registry": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                stores: {
                    id: string;
                    actor_url: string;
                    domain: string;
                    store_slug: string;
                    name: string;
                    summary: string | null;
                    icon_url: string | null;
                    is_active: boolean;
                    subscription_enabled: boolean;
                    last_fetched_at: string | null;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/store-registry": {
        $post: {
            input: {
                json: {
                    identifier: string;
                    subscribe?: boolean | undefined;
                    set_active?: boolean | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                store: {
                    id: string;
                    actor_url: string;
                    domain: string;
                    store_slug: string;
                    name: string;
                    summary: string | null;
                    icon_url: string | null;
                    is_active: boolean;
                    subscription_enabled: boolean;
                    last_fetched_at: string | null;
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:spaceId/store-registry/:entryId": {
        $delete: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    entryId: string;
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
    "/:spaceId/store-registry/:entryId": {
        $patch: {
            input: {
                json: {
                    is_active?: boolean | undefined;
                    subscription_enabled?: boolean | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                } & {
                    entryId: string;
                };
            };
            output: {
                store: {
                    id: string;
                    actor_url: string;
                    domain: string;
                    store_slug: string;
                    name: string;
                    summary: string | null;
                    icon_url: string | null;
                    is_active: boolean;
                    subscription_enabled: boolean;
                    last_fetched_at: string | null;
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/store-registry/:entryId/refresh": {
        $post: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    entryId: string;
                };
            };
            output: {
                store: {
                    id: string;
                    actor_url: string;
                    domain: string;
                    store_slug: string;
                    name: string;
                    summary: string | null;
                    icon_url: string | null;
                    is_active: boolean;
                    subscription_enabled: boolean;
                    last_fetched_at: string | null;
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/store-registry/:entryId/repositories": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    entryId: string;
                };
            };
            output: {
                total: number;
                page: number;
                limit: number;
                repositories: {
                    id: string;
                    name: string;
                    summary: string;
                    url: string;
                    owner: string | undefined;
                    visibility: string | undefined;
                    default_branch: string | undefined;
                    clone_url: string | undefined;
                    browse_url: string | undefined;
                    published: string;
                    updated: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/store-registry/:entryId/repositories/search": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    entryId: string;
                };
            };
            output: {
                total: number;
                query: string;
                page: number;
                limit: number;
                repositories: {
                    id: string;
                    name: string;
                    summary: string;
                    url: string;
                    owner: string | undefined;
                    visibility: string | undefined;
                    default_branch: string | undefined;
                    clone_url: string | undefined;
                    browse_url: string | undefined;
                    published: string;
                    updated: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/store-registry/:entryId/install": {
        $post: {
            input: {
                json: {
                    remote_owner: string;
                    remote_repo_name: string;
                    local_name?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                } & {
                    entryId: string;
                };
            };
            output: {
                repository: {
                    id: string;
                    name: string;
                    clone_url: string;
                    remote_store_actor_url: string;
                    remote_browse_url: string | null;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:spaceId/store-registry/updates": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                total: number;
                updates: {
                    id: string;
                    registry_entry_id: string;
                    store_name: string;
                    store_domain: string;
                    activity_id: string;
                    activity_type: string;
                    object_id: string;
                    object_type: string | null;
                    object_name: string | null;
                    object_summary: string | null;
                    published: string | null;
                    seen: boolean;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:spaceId/store-registry/updates/mark-seen": {
        $post: {
            input: {
                json: {
                    all?: boolean | undefined;
                    update_ids?: string[] | undefined;
                };
            } & {
                param: {
                    spaceId: string;
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
    "/:spaceId/store-registry/:entryId/poll": {
        $post: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    entryId: string;
                };
            };
            output: {
                new_updates: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/:spaceId/store-registry/:entryId/poll">;
export default _default;
//# sourceMappingURL=store-registry.d.ts.map