import type { AuthenticatedRouteEnv } from '../route-auth';
import type { ArtifactKind, DeploymentProviderName } from '../../../application/services/deployment/models.ts';
declare const workersDeployments: import("hono/hono-base").HonoBase<AuthenticatedRouteEnv, {
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
                    status: import("../../../application/services/deployment/models.ts").DeploymentStatus;
                    deploy_state: import("../../../application/services/deployment/models.ts").DeployState;
                    artifact_kind: ArtifactKind;
                    provider: {
                        name: DeploymentProviderName;
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
                            kind?: ArtifactKind | undefined;
                            image_ref?: string | undefined;
                            exposed_port?: number | undefined;
                            health_path?: string | undefined;
                        } | undefined;
                    };
                    routing_status: import("../../../application/services/deployment/models.ts").RoutingStatus;
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
                    artifact_kind: ArtifactKind;
                    routing_status: "active" | "canary" | "rollback" | "archived";
                    routing_weight: number;
                    bundle_hash: string | null;
                    bundle_size: number | null;
                    provider: {
                        name: DeploymentProviderName;
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
                            kind?: ArtifactKind | undefined;
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
                    artifact_kind: ArtifactKind;
                    provider: {
                        name: DeploymentProviderName;
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
                            kind?: ArtifactKind | undefined;
                            image_ref?: string | undefined;
                            exposed_port?: number | undefined;
                            health_path?: string | undefined;
                        } | undefined;
                    };
                    routing_status: import("../../../application/services/deployment/models.ts").RoutingStatus;
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
                        name: DeploymentProviderName;
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
                            kind?: ArtifactKind | undefined;
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
                    artifact_kind: ArtifactKind;
                    bundle_r2_key: string | null;
                    bundle_hash: string | null;
                    bundle_size: number | null;
                    wasm_r2_key: string | null;
                    wasm_hash: string | null;
                    assets_manifest: string | null;
                    runtime_config_snapshot_json: string;
                    bindings_snapshot_encrypted: string | null;
                    env_vars_snapshot_encrypted: string | null;
                    deploy_state: import("../../../application/services/deployment/models.ts").DeployState;
                    current_step: string | null;
                    step_error: string | null;
                    status: import("../../../application/services/deployment/models.ts").DeploymentStatus;
                    routing_status: import("../../../application/services/deployment/models.ts").RoutingStatus;
                    routing_weight: number;
                    deployed_by: string | null;
                    deploy_message: string | null;
                    provider_name: DeploymentProviderName;
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
}, "/", "/:id/deployments/:deploymentId">;
export default workersDeployments;
//# sourceMappingURL=deployments.d.ts.map