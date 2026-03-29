import type { AuthenticatedRouteEnv } from '../route-auth';
declare const workersSettings: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<{
    "/:id/settings": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                compatibility_date: string | undefined;
                compatibility_flags: string[];
                limits: {
                    cpu_ms?: number | undefined;
                    subrequests?: number | undefined;
                };
                mcp_server: {
                    enabled: boolean;
                    name: string;
                    path: string;
                } | undefined;
                applies_on_next_deploy: true;
                updated_at: string | null;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/settings": {
        $patch: {
            input: {
                json: {
                    compatibility_date?: string | undefined;
                    compatibility_flags?: string[] | undefined;
                    limits?: {
                        cpu_ms?: number | undefined;
                        subrequests?: number | undefined;
                    } | undefined;
                    mcp_server?: {
                        name: string;
                        path: string;
                        enabled: boolean;
                    } | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
                settings: {
                    compatibility_date: string | undefined;
                    compatibility_flags: string[];
                    limits: {
                        cpu_ms?: number | undefined;
                        subrequests?: number | undefined;
                    };
                    mcp_server: {
                        enabled: boolean;
                        name: string;
                        path: string;
                    } | undefined;
                    updated_at: string | null;
                };
                applies_on_next_deploy: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/:id/env": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                env: {
                    name: string;
                    type: "plain_text" | "secret_text";
                    value: string;
                    updated_at: string;
                }[];
                applies_on_next_deploy: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/env": {
        $patch: {
            input: {
                json: {
                    variables: {
                        name: string;
                        value: string;
                        secret?: boolean | undefined;
                    }[];
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
                env: {
                    name: string;
                    type: "plain_text" | "secret_text";
                    value: string;
                    updated_at: string;
                }[];
                applies_on_next_deploy: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/:id/common-env-links": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                links: {
                    name: string;
                    source: import("../../../application/services/common-env/repository").LinkSource;
                    hasCommonValue: boolean;
                    syncState: import("../../../application/services/common-env/repository").SyncState;
                    syncReason: string | null;
                }[];
                builtins: {
                    [x: string]: {
                        managed: true;
                        available: boolean;
                        configured?: boolean | undefined;
                        scopes?: string[] | undefined;
                        subject_mode?: import("../../../application/services/common-env/takos-builtins").TakosTokenSubjectMode | undefined;
                        sync_state?: "managed" | "pending" | "missing_common" | "missing_builtin" | "overridden" | "error" | undefined;
                        sync_reason?: string | null | undefined;
                    };
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/common-env-links": {
        $put: {
            input: {
                json: {
                    keys?: string[] | undefined;
                    builtins?: {
                        TAKOS_ACCESS_TOKEN?: {
                            scopes: string[];
                        } | undefined;
                    } | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
                links: {
                    name: string;
                    source: import("../../../application/services/common-env/repository").LinkSource;
                    hasCommonValue: boolean;
                    syncState: import("../../../application/services/common-env/repository").SyncState;
                    syncReason: string | null;
                }[];
                builtins: {
                    [x: string]: {
                        managed: true;
                        available: boolean;
                        configured?: boolean | undefined;
                        scopes?: string[] | undefined;
                        subject_mode?: import("../../../application/services/common-env/takos-builtins").TakosTokenSubjectMode | undefined;
                        sync_state?: "managed" | "pending" | "missing_common" | "missing_builtin" | "overridden" | "error" | undefined;
                        sync_reason?: string | null | undefined;
                    };
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/common-env-links": {
        $patch: {
            input: {
                json: {
                    set?: string[] | undefined;
                    add?: string[] | undefined;
                    remove?: string[] | undefined;
                    builtins?: {
                        TAKOS_ACCESS_TOKEN?: {
                            scopes: string[];
                        } | undefined;
                    } | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
                diff: {
                    added: string[];
                    removed: string[];
                };
                links: {
                    name: string;
                    source: import("../../../application/services/common-env/repository").LinkSource;
                    hasCommonValue: boolean;
                    syncState: import("../../../application/services/common-env/repository").SyncState;
                    syncReason: string | null;
                }[];
                builtins: {
                    [x: string]: {
                        managed: true;
                        available: boolean;
                        configured?: boolean | undefined;
                        scopes?: string[] | undefined;
                        subject_mode?: import("../../../application/services/common-env/takos-builtins").TakosTokenSubjectMode | undefined;
                        sync_state?: "managed" | "pending" | "missing_common" | "missing_builtin" | "overridden" | "error" | undefined;
                        sync_reason?: string | null | undefined;
                    };
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/:id/bindings": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                bindings: {
                    id: string;
                    name: string;
                    type: string;
                    resource_id: string;
                    resource_name: string | null;
                }[];
                available_resources: {
                    id: string;
                    name: string;
                    cf_id: string | null;
                    cf_name: string | null;
                }[];
                applies_on_next_deploy: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/bindings": {
        $patch: {
            input: {
                json: {
                    bindings: {
                        type: string;
                        name: string;
                        resource_id?: string | undefined;
                        resource_name?: string | undefined;
                    }[];
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
                applies_on_next_deploy: true;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/">, "/", "/">;
export default workersSettings;
//# sourceMappingURL=settings.d.ts.map