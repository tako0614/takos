import type { AuthenticatedRouteEnv } from '../route-auth';
declare const _default: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<{
    "/": {
        $get: {
            input: {};
            output: {
                services: {
                    workspace_name: string;
                    id: string;
                    space_id: string;
                    service_type: "app" | "service";
                    status: "pending" | "building" | "deployed" | "failed" | "stopped";
                    config: string | null;
                    hostname: string | null;
                    service_name: string | null;
                    slug: string | null;
                    created_at: string;
                    updated_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/space/:spaceId": {
        $get: {
            input: {
                param: {
                    spaceId: string;
                };
            };
            output: {
                services: {
                    id: string;
                    space_id: string;
                    service_type: "app" | "service";
                    status: "pending" | "building" | "deployed" | "failed" | "stopped";
                    config: string | null;
                    hostname: string | null;
                    service_name: string | null;
                    slug: string | null;
                    created_at: string;
                    updated_at: string;
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
                    config?: string | undefined;
                    space_id?: string | undefined;
                    slug?: string | undefined;
                    service_type?: "service" | "app" | undefined;
                };
            };
            output: {
                error: string;
            };
            outputFormat: "json";
            status: 429;
        } | {
            input: {
                json: {
                    config?: string | undefined;
                    space_id?: string | undefined;
                    slug?: string | undefined;
                    service_type?: "service" | "app" | undefined;
                };
            };
            output: {
                service: {
                    id: string;
                    space_id: string;
                    service_type: "app" | "service";
                    status: "pending" | "building" | "deployed" | "failed" | "stopped";
                    config: string | null;
                    hostname: string | null;
                    service_name: string | null;
                    slug: string | null;
                    created_at: string;
                    updated_at: string;
                } | null;
            };
            outputFormat: "json";
            status: 201;
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
                service: {
                    workspace_name: string;
                    id: string;
                    space_id: string;
                    service_type: "app" | "service";
                    status: "pending" | "building" | "deployed" | "failed" | "stopped";
                    config: string | null;
                    hostname: string | null;
                    service_name: string | null;
                    slug: string | null;
                    created_at: string;
                    updated_at: string;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/logs": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                invocations: {
                    datetime: string;
                    status: string;
                    cpuTime: number;
                    responseStatus: number;
                    clientRequestMethod: string;
                    clientRequestPath: string;
                }[];
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
}, "/"> | import("hono/types").MergeSchemaPath<{
    "/:id/deployments": {
        $post: {
            input: {
                json: {
                    target?: {
                        artifact?: {
                            kind?: "worker-bundle" | "container-image" | undefined;
                            image_ref?: string | undefined;
                            exposed_port?: number | undefined;
                            health_path?: string | undefined;
                        } | undefined;
                        route_ref?: string | undefined;
                        endpoint?: {
                            ref: string;
                            kind: "service-ref";
                        } | {
                            kind: "http-url";
                            base_url: string;
                        } | undefined;
                    } | undefined;
                    provider?: {
                        name: "workers-dispatch" | "oci" | "ecs" | "cloud-run" | "k8s";
                    } | undefined;
                    deploy_message?: string | undefined;
                    canary_weight?: number | undefined;
                    strategy?: "canary" | "direct" | undefined;
                    bundle?: string | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                deployment: {
                    id: string;
                    version: number;
                    status: import("../../../application/services/deployment/models").DeploymentStatus;
                    deploy_state: import("../../../application/services/deployment").DeployState;
                    artifact_kind: import("../../../application/services/deployment/models").ArtifactKind;
                    provider: {
                        name: import("../../../application/services/deployment/models").DeploymentProviderName;
                    };
                    target: {
                        route_ref?: string | undefined;
                        endpoint?: {
                            kind: "service-ref";
                            ref: string;
                        } | {
                            kind: "http-url";
                            base_url: string;
                        } | undefined;
                        artifact?: {
                            kind?: import("../../../application/services/deployment/models").ArtifactKind | undefined;
                            image_ref?: string | undefined;
                            exposed_port?: number | undefined;
                            health_path?: string | undefined;
                        } | undefined;
                    };
                    routing_status: import("../../../application/services/deployment/models").RoutingStatus;
                    routing_weight: number;
                    created_at: string;
                };
            };
            outputFormat: "json";
            status: 201;
        };
    };
} & {
    "/:id/deployments": {
        $get: {
            input: {
                param: {
                    id: string;
                };
            };
            output: {
                deployments: {
                    id: string;
                    version: number;
                    status: "pending" | "in_progress" | "success" | "failed" | "rolled_back";
                    deploy_state: string;
                    artifact_ref: string | null;
                    artifact_kind: import("../../../application/services/deployment/models").ArtifactKind;
                    routing_status: "active" | "canary" | "rollback" | "archived";
                    routing_weight: number;
                    bundle_hash: string | null;
                    bundle_size: number | null;
                    provider: {
                        name: import("../../../application/services/deployment/models").DeploymentProviderName;
                    };
                    target: {
                        route_ref?: string | undefined;
                        endpoint?: {
                            kind: "service-ref";
                            ref: string;
                        } | {
                            kind: "http-url";
                            base_url: string;
                        } | undefined;
                        artifact?: {
                            kind?: import("../../../application/services/deployment/models").ArtifactKind | undefined;
                            image_ref?: string | undefined;
                            exposed_port?: number | undefined;
                            health_path?: string | undefined;
                        } | undefined;
                    };
                    deployed_by: string | null;
                    deploy_message: string | null;
                    created_at: string;
                    completed_at: string | null;
                    error_message: string | null;
                    resolved_endpoint?: {
                        kind: string;
                        base_url: string;
                    } | null | undefined;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/deployments/rollback": {
        $post: {
            input: {
                json: {
                    target_version?: number | undefined;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
                deployment: {
                    id: string;
                    version: number;
                    artifact_kind: import("../../../application/services/deployment/models").ArtifactKind;
                    provider: {
                        name: import("../../../application/services/deployment/models").DeploymentProviderName;
                    };
                    target: {
                        route_ref?: string | undefined;
                        endpoint?: {
                            kind: "service-ref";
                            ref: string;
                        } | {
                            kind: "http-url";
                            base_url: string;
                        } | undefined;
                        artifact?: {
                            kind?: import("../../../application/services/deployment/models").ArtifactKind | undefined;
                            image_ref?: string | undefined;
                            exposed_port?: number | undefined;
                            health_path?: string | undefined;
                        } | undefined;
                    };
                    routing_status: import("../../../application/services/deployment/models").RoutingStatus;
                    routing_weight: number;
                };
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
} & {
    "/:id/deployments/:deploymentId": {
        $get: {
            input: {
                param: {
                    id: string;
                } & {
                    deploymentId: string;
                };
            };
            output: {
                deployment: {
                    resolved_endpoint?: {
                        kind: string;
                        base_url: string;
                    } | undefined;
                    provider: {
                        name: import("../../../application/services/deployment/models").DeploymentProviderName;
                    };
                    target: {
                        route_ref?: string | undefined;
                        endpoint?: {
                            kind: "service-ref";
                            ref: string;
                        } | {
                            kind: "http-url";
                            base_url: string;
                        } | undefined;
                        artifact?: {
                            kind?: import("../../../application/services/deployment/models").ArtifactKind | undefined;
                            image_ref?: string | undefined;
                            exposed_port?: number | undefined;
                            health_path?: string | undefined;
                        } | undefined;
                    };
                    error_message: string | null;
                    env_vars_masked: {
                        [x: string]: string;
                    };
                    bindings: {
                        type: "plain_text" | "secret_text" | "d1" | "r2_bucket" | "kv_namespace" | "queue" | "analytics_engine" | "workflow" | "vectorize" | "service" | "durable_object_namespace";
                        name: string;
                        text?: string | undefined;
                        database_id?: string | undefined;
                        bucket_name?: string | undefined;
                        namespace_id?: string | undefined;
                        queue_name?: string | undefined;
                        delivery_delay?: number | undefined;
                        dataset?: string | undefined;
                        workflow_name?: string | undefined;
                        class_name?: string | undefined;
                        script_name?: string | undefined;
                        index_name?: string | undefined;
                        service?: string | undefined;
                        environment?: string | undefined;
                    }[];
                    id: string;
                    service_id: string;
                    worker_id?: string | undefined;
                    space_id: string;
                    version: number;
                    artifact_ref: string | null;
                    artifact_kind: import("../../../application/services/deployment/models").ArtifactKind;
                    bundle_r2_key: string | null;
                    bundle_hash: string | null;
                    bundle_size: number | null;
                    wasm_r2_key: string | null;
                    wasm_hash: string | null;
                    assets_manifest: string | null;
                    runtime_config_snapshot_json: string;
                    bindings_snapshot_encrypted: string | null;
                    env_vars_snapshot_encrypted: string | null;
                    deploy_state: import("../../../application/services/deployment").DeployState;
                    current_step: string | null;
                    step_error: string | null;
                    status: import("../../../application/services/deployment/models").DeploymentStatus;
                    routing_status: import("../../../application/services/deployment/models").RoutingStatus;
                    routing_weight: number;
                    deployed_by: string | null;
                    deploy_message: string | null;
                    provider_name: import("../../../application/services/deployment/models").DeploymentProviderName;
                    target_json: string;
                    provider_state_json: string;
                    idempotency_key: string | null;
                    is_rollback: boolean;
                    rollback_from_version: number | null;
                    rolled_back_at: string | null;
                    rolled_back_by: string | null;
                    started_at: string | null;
                    completed_at: string | null;
                    created_at: string;
                    updated_at: string;
                };
                events: {
                    id: string;
                    type: string;
                    message: string;
                    created_at: string;
                }[];
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/"> | import("hono/types").MergeSchemaPath<import("hono/types").BlankSchema | import("hono/types").MergeSchemaPath<{
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
}, "/">, "/"> | import("hono/types").MergeSchemaPath<{
    "/:id/slug": {
        $patch: {
            input: {
                json: {
                    slug: string;
                };
            } & {
                param: {
                    id: string;
                };
            };
            output: {
                success: true;
                slug: string;
                hostname: string;
            };
            outputFormat: "json";
            status: import("hono/utils/http-status").ContentfulStatusCode;
        };
    };
}, "/">, "/", "/">;
export default _default;
//# sourceMappingURL=index.d.ts.map