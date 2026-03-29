import type { AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<{
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
                    type: import("../../../shared/types").ResourceType;
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
                    type: import("../../../shared/types").ResourceType;
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
                    type: import("../../../shared/types").ResourceType;
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
                    type: import("../../../shared/types").ResourceType;
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
                    type: import("../../../shared/types").ResourceType;
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
                    type: import("../../../shared/types").ResourceType;
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
                    type: import("../../../shared/types").ResourceType;
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
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/:id/access": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                access: {
                    workspace_name: string | null;
                    id: string;
                    resource_id: string;
                    space_id: string;
                    permission: import("../../../shared/types").ResourcePermission;
                    granted_by: string | null;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/access": {
        $post: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                message: string;
                permission: import("../../../shared/types").ResourcePermission | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        } | {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                access: {
                    id: string;
                    resource_id: string;
                    space_id: string;
                    permission: import("../../../shared/types").ResourcePermission;
                    granted_by: string;
                    created_at: string;
                } | undefined;
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:id/access/:spaceId": {
        $delete: {
            input: {
                param: {
                    spaceId: string;
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
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/:id/bind": {
        $post: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                binding: {
                    id: string;
                    service_id: string;
                    resource_id: string;
                    binding_name: string;
                    binding_type: string;
                    config: string;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:id/bind/:serviceId": {
        $delete: {
            input: {
                param: {
                    id: string;
                } & {
                    serviceId: string;
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
    "/by-name/:name/bind/:serviceId": {
        $delete: {
            input: {
                param: {
                    name: string;
                } & {
                    serviceId: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/:id/d1/tables": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                tables: {
                    name: string;
                    columns: {
                        cid: number;
                        name: string;
                        type: string;
                        notnull: number;
                        dflt_value: string | null;
                        pk: number;
                    }[];
                    row_count: number;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/d1/tables/:tableName": {
        $get: {
            input: {
                param: {
                    id: string;
                } & {
                    tableName: string;
                };
            };
            output: {
                table: string;
                columns: {
                    cid: number;
                    name: string;
                    type: string;
                    notnull: number;
                    dflt_value: string | null;
                    pk: number;
                }[];
                rows: any;
                total_count: number;
                limit: number;
                offset: number;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/d1/query": {
        $post: {
            input: {
                json: {
                    sql: string;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                result: import("hono/utils/types").JSONValue;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/d1/export": {
        $post: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                database: string;
                tables: {
                    [x: string]: import("hono/utils/types").JSONValue[];
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/:id/r2/objects": {
        $get: {
            input: {
                query: {
                    limit?: string | undefined;
                    prefix?: string | undefined;
                    cursor?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                objects: {
                    key: string;
                    size: number;
                    uploaded: string;
                    etag: string;
                }[];
                truncated: boolean;
                cursor: string | undefined;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/r2/stats": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                stats: {
                    objectCount: number;
                    payloadSize: number;
                    metadataSize: number;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/r2/objects/:key": {
        $delete: {
            input: {
                param: {
                    id: string;
                } & {
                    key: string;
                };
            };
            output: {
                success: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/:id/tokens": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                tokens: {
                    id: string;
                    name: string;
                    token_prefix: string;
                    permission: string;
                    expires_at: string | null;
                    last_used_at: string | null;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/by-name/:name/tokens": {
        $get: {
            input: {
                param: {
                    name: string;
                };
            };
            output: {
                tokens: {
                    id: string;
                    name: string;
                    token_prefix: string;
                    permission: string;
                    expires_at: string | null;
                    last_used_at: string | null;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/tokens": {
        $post: {
            input: {
                json: {
                    name: string;
                    permission?: "read" | "write" | undefined;
                    expires_in_days?: number | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                token: {
                    id: string;
                    name: string;
                    token: string;
                    token_prefix: string;
                    permission: "read" | "write";
                    expires_at: string | null;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/by-name/:name/tokens": {
        $post: {
            input: {
                json: {
                    name: string;
                    permission?: "read" | "write" | undefined;
                    expires_in_days?: number | undefined;
                };
            } & {
                param: {
                    name: string;
                };
            };
            output: {
                token: {
                    id: string;
                    name: string;
                    token: string;
                    token_prefix: string;
                    permission: "read" | "write";
                    expires_at: string | null;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:id/tokens/:tokenId": {
        $delete: {
            input: {
                param: {
                    id: string;
                } & {
                    tokenId: string;
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
    "/by-name/:name/tokens/:tokenId": {
        $delete: {
            input: {
                param: {
                    name: string;
                } & {
                    tokenId: string;
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
    "/:id/connection": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                type: import("../../../shared/types").ResourceType;
                name: string;
                status: import("../../../shared/types").ResourceStatus;
                connection: {
                    [x: string]: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/by-name/:name/connection": {
        $get: {
            input: {
                param: {
                    name: string;
                };
            };
            output: {
                type: import("../../../shared/types").ResourceType;
                name: string;
                status: import("../../../shared/types").ResourceStatus;
                connection: {
                    [x: string]: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/">, "/", "/">;
export default _default;
//# sourceMappingURL=index.d.ts.map