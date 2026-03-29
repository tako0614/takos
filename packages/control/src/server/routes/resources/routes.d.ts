import type { ResourceType } from '../../../shared/types';
import { type AuthenticatedRouteEnv } from '../route-auth';
declare const resourcesBase: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
    "/": {
        $get: {
            input: {};
            output: {
                resources: {
                    access_level: string;
                    id: string;
                    owner_id: string;
                    space_id: string | null;
                    name: string;
                    type: ResourceType;
                    status: import("../../../shared/types").ResourceStatus;
                    cf_id: string | null;
                    cf_name: string | null;
                    config: string;
                    metadata: string;
                    size_bytes?: number | undefined;
                    item_count?: number | undefined;
                    last_used_at?: string | null | undefined;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {};
            output: {
                owned: {
                    access_level: string;
                    id: string;
                    owner_id: string;
                    space_id: string | null;
                    name: string;
                    type: ResourceType;
                    status: import("../../../shared/types").ResourceStatus;
                    cf_id: string | null;
                    cf_name: string | null;
                    config: string;
                    metadata: string;
                    size_bytes?: number | undefined;
                    item_count?: number | undefined;
                    last_used_at?: string | null | undefined;
                    created_at: string;
                    updated_at: string;
                }[];
                shared: {
                    access_level: string;
                    id: string;
                    owner_id: string;
                    space_id: string | null;
                    name: string;
                    type: ResourceType;
                    status: import("../../../shared/types").ResourceStatus;
                    cf_id: string | null;
                    cf_name: string | null;
                    config: string;
                    metadata: string;
                    size_bytes?: number | undefined;
                    item_count?: number | undefined;
                    last_used_at?: string | null | undefined;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/shared/:spaceId": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                shared_resources: {
                    name: string;
                    type: string;
                    status: string;
                    cf_id: string | null;
                    cf_name: string | null;
                    access_level: string;
                    owner_name: string;
                    owner_email: string | null;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/type/:type": {
        $get: {
            input: {
                param: {
                    type: string;
                };
            };
            output: {
                resources: {
                    access_level: string;
                    id: string;
                    owner_id: string;
                    space_id: string | null;
                    name: string;
                    type: ResourceType;
                    status: import("../../../shared/types").ResourceStatus;
                    cf_id: string | null;
                    cf_name: string | null;
                    config: string;
                    metadata: string;
                    size_bytes?: number | undefined;
                    item_count?: number | undefined;
                    last_used_at?: string | null | undefined;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                resource: {
                    id: string;
                    owner_id: string;
                    space_id: string | null;
                    name: string;
                    type: ResourceType;
                    status: import("../../../shared/types").ResourceStatus;
                    cf_id: string | null;
                    cf_name: string | null;
                    config: string;
                    metadata: string;
                    size_bytes?: number | undefined;
                    item_count?: number | undefined;
                    last_used_at?: string | null | undefined;
                    created_at: string;
                    updated_at: string;
                };
                access: {
                    workspace_name: string | null;
                    id: string;
                    resource_id: string;
                    space_id: string;
                    permission: import("../../../shared/types").ResourcePermission;
                    granted_by: string | null;
                    created_at: string;
                }[];
                bindings: {
                    service_hostname: string | null;
                    service_slug: string | null;
                    service_status: string | null;
                    id: string;
                    service_id: string;
                    resource_id: string;
                    binding_name: string;
                    binding_type: import("../../../shared/types").BindingType;
                    config: string;
                    created_at: string;
                }[];
                is_owner: boolean;
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
                    type: string;
                    name: string;
                    config?: Record<string, unknown> | undefined;
                    space_id?: string | undefined;
                };
            };
            output: Promise<void>;
            outputFormat: "json";
            status: import("hono/utils/http-status").StatusCode;
        } | {
            input: {
                json: {
                    type: string;
                    name: string;
                    config?: Record<string, unknown> | undefined;
                    space_id?: string | undefined;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        } | {
            input: {
                json: {
                    type: string;
                    name: string;
                    config?: Record<string, unknown> | undefined;
                    space_id?: string | undefined;
                };
            };
            output: {};
            outputFormat: string;
            status: import("hono/utils/http-status").StatusCode;
        };
    };
} & {
    "/:id": {
        $patch: {
            input: {
                json: {
                    metadata?: Record<string, unknown> | undefined;
                    config?: Record<string, unknown> | undefined;
                    name?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                resource: {
                    id: string;
                    owner_id: string;
                    space_id: string | null;
                    name: string;
                    type: ResourceType;
                    status: import("../../../shared/types").ResourceStatus;
                    cf_id: string | null;
                    cf_name: string | null;
                    config: string;
                    metadata: string;
                    size_bytes?: number | undefined;
                    item_count?: number | undefined;
                    last_used_at?: string | null | undefined;
                    created_at: string;
                    updated_at: string;
                };
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
                error: string;
                binding_count: number;
            };
            outputFormat: "json";
            status: 409;
        } | {
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
    "/by-name/:name": {
        $get: {
            input: {
                param: {
                    name: string;
                };
            };
            output: {
                resource: {
                    id: string;
                    owner_id: string;
                    space_id: string | null;
                    name: string;
                    type: ResourceType;
                    status: import("../../../shared/types").ResourceStatus;
                    cf_id: string | null;
                    cf_name: string | null;
                    config: string;
                    metadata: string;
                    size_bytes?: number | undefined;
                    item_count?: number | undefined;
                    last_used_at?: string | null | undefined;
                    created_at: string;
                    updated_at: string;
                };
                access: {
                    workspace_name: string | null;
                    id: string;
                    resource_id: string;
                    space_id: string;
                    permission: import("../../../shared/types").ResourcePermission;
                    granted_by: string | null;
                    created_at: string;
                }[];
                bindings: {
                    service_hostname: string | null;
                    service_slug: string | null;
                    service_status: string | null;
                    id: string;
                    service_id: string;
                    resource_id: string;
                    binding_name: string;
                    binding_type: import("../../../shared/types").BindingType;
                    config: string;
                    created_at: string;
                }[];
                is_owner: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/by-name/:name": {
        $delete: {
            input: {
                param: {
                    name: string;
                };
            };
            output: {
                error: string;
                binding_count: number;
            };
            outputFormat: "json";
            status: 409;
        } | {
            input: {
                param: {
                    name: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/", "/by-name/:name">;
export default resourcesBase;
//# sourceMappingURL=routes.d.ts.map