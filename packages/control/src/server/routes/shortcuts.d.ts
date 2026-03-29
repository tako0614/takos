import type { Env, User } from '../../shared/types';
declare const _default: import("hono/hono-base").HonoBase<{
    Bindings: Env;
    Variables: {
        user: User;
    };
}, {
    "/": {
        $get: {
            input: {};
            output: {
                shortcuts: {
                    id: string;
                    user_id: string;
                    space_id: string;
                    resource_type: string;
                    resource_id: string;
                    name: string;
                    icon: string | null;
                    position: number;
                    created_at: string;
                    updated_at: string;
                    service_hostname?: string | null | undefined;
                    service_status?: string | null | undefined;
                    resource_name?: string | null | undefined;
                    resource_type_name?: string | null | undefined;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/": {
        $post: {
            input: {
                json: {
                    name: string;
                    resourceId: string;
                    resourceType: string;
                    icon?: string | undefined;
                };
            };
            output: {
                id: string;
                user_id: string;
                space_id: string;
                resource_type: string;
                resource_id: string;
                name: string;
                icon: string | null;
                position: number;
                created_at: string;
                updated_at: string;
                service_hostname?: string | null | undefined;
                service_status?: string | null | undefined;
                resource_name?: string | null | undefined;
                resource_type_name?: string | null | undefined;
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:id": {
        $put: {
            input: {
                json: {
                    name?: string | undefined;
                    position?: number | undefined;
                    icon?: string | undefined;
                };
            } & {
                param: {
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
    "/:id": {
        $delete: {
            input: {
                param: {
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
    "/reorder": {
        $post: {
            input: {
                json: {
                    order: string[];
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/reorder">;
export default _default;
/**
 * Shortcut Groups API Routes
 *
 * GET    /api/spaces/:spaceId/shortcuts/groups - List groups
 * POST   /api/spaces/:spaceId/shortcuts/groups - Create group
 * GET    /api/spaces/:spaceId/shortcuts/groups/:groupId - Get group
 * PATCH  /api/spaces/:spaceId/shortcuts/groups/:groupId - Update group
 * DELETE /api/spaces/:spaceId/shortcuts/groups/:groupId - Delete group
 * POST   /api/spaces/:spaceId/shortcuts/groups/:groupId/items - Add item
 * DELETE /api/spaces/:spaceId/shortcuts/groups/:groupId/items/:itemId - Remove item
 */
export declare const shortcutGroupRoutes: import("hono/hono-base").HonoBase<{
    Bindings: Env;
    Variables: {
        user: User;
    };
}, {
    "/spaces/:spaceId/shortcuts/groups": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                data: {
                    id: string;
                    spaceId: string;
                    name: string;
                    icon?: string | undefined;
                    items: {
                        type: "service" | "ui" | "d1" | "r2" | "kv" | "link";
                        id: string;
                        label: string;
                        icon?: string | undefined;
                        serviceId?: string | undefined;
                        uiPath?: string | undefined;
                        resourceId?: string | undefined;
                        url?: string | undefined;
                    }[];
                    bundleDeploymentId?: string | undefined;
                    createdAt: string;
                    updatedAt: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/shortcuts/groups": {
        $post: {
            input: {
                json: {
                    name: string;
                    icon?: string | undefined;
                    items?: {
                        type: string;
                        label: string;
                        url?: string | undefined;
                        serviceId?: string | undefined;
                        resourceId?: string | undefined;
                        icon?: string | undefined;
                    }[] | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                };
            };
            output: {
                data: {
                    id: string;
                    spaceId: string;
                    name: string;
                    icon?: string | undefined;
                    items: {
                        type: "service" | "ui" | "d1" | "r2" | "kv" | "link";
                        id: string;
                        label: string;
                        icon?: string | undefined;
                        serviceId?: string | undefined;
                        uiPath?: string | undefined;
                        resourceId?: string | undefined;
                        url?: string | undefined;
                    }[];
                    bundleDeploymentId?: string | undefined;
                    createdAt: string;
                    updatedAt: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/spaces/:spaceId/shortcuts/groups/:groupId": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    groupId: string;
                };
            };
            output: {
                data: {
                    id: string;
                    spaceId: string;
                    name: string;
                    icon?: string | undefined;
                    items: {
                        type: "service" | "ui" | "d1" | "r2" | "kv" | "link";
                        id: string;
                        label: string;
                        icon?: string | undefined;
                        serviceId?: string | undefined;
                        uiPath?: string | undefined;
                        resourceId?: string | undefined;
                        url?: string | undefined;
                    }[];
                    bundleDeploymentId?: string | undefined;
                    createdAt: string;
                    updatedAt: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/shortcuts/groups/:groupId": {
        $patch: {
            input: {
                json: {
                    name?: string | undefined;
                    icon?: string | undefined;
                    items?: {
                        type: string;
                        label: string;
                        url?: string | undefined;
                        serviceId?: string | undefined;
                        resourceId?: string | undefined;
                        icon?: string | undefined;
                    }[] | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                } & {
                    groupId: string;
                };
            };
            output: {
                data: {
                    id: string;
                    spaceId: string;
                    name: string;
                    icon?: string | undefined;
                    items: {
                        type: "service" | "ui" | "d1" | "r2" | "kv" | "link";
                        id: string;
                        label: string;
                        icon?: string | undefined;
                        serviceId?: string | undefined;
                        uiPath?: string | undefined;
                        resourceId?: string | undefined;
                        url?: string | undefined;
                    }[];
                    bundleDeploymentId?: string | undefined;
                    createdAt: string;
                    updatedAt: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/spaces/:spaceId/shortcuts/groups/:groupId": {
        $delete: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    groupId: string;
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
    "/spaces/:spaceId/shortcuts/groups/:groupId/items": {
        $post: {
            input: {
                json: {
                    type: "link" | "r2" | "service" | "d1" | "kv" | "ui";
                    label: string;
                    url?: string | undefined;
                    serviceId?: string | undefined;
                    resourceId?: string | undefined;
                    icon?: string | undefined;
                };
            } & {
                param: {
                    spaceId: string;
                } & {
                    groupId: string;
                };
            };
            output: {
                data: {
                    type: "service" | "ui" | "d1" | "r2" | "kv" | "link";
                    id: string;
                    label: string;
                    icon?: string | undefined;
                    serviceId?: string | undefined;
                    uiPath?: string | undefined;
                    resourceId?: string | undefined;
                    url?: string | undefined;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/spaces/:spaceId/shortcuts/groups/:groupId/items/:itemId": {
        $delete: {
            input: {
                param: {
                    spaceId: string;
                } & {
                    groupId: string;
                } & {
                    itemId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/spaces/:spaceId/shortcuts/groups/:groupId/items/:itemId">;
//# sourceMappingURL=shortcuts.d.ts.map