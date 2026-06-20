import type { WorkerBinding } from "../../../platform/backends/cloudflare/wfp.ts";
import type { Env } from "../../../shared/types/index.ts";

/**
 * `DeploymentEnv` originated as a documentation-only subset of the full
 * worker `Env` listing the bindings deploy code actively reads. In practice
 * every consumer of `DeploymentEnv` ended up needing fields outside that
 * subset (cloudflare custom-domain TLS provider, deploy git internals,
 * tenant base domain, …) and reached for casts to widen back to `Env`. The
 * runtime always provides the full `Env` at every entry point that calls
 * deploy code (queue dispatch, route handler, tool handler), so making
 * `DeploymentEnv` an alias for `Env` matches the structural reality and
 * removes the family of "widening to Env" casts.
 */
export type DeploymentEnv = Env;

export type ArtifactKind = "worker-bundle" | "container-image";

export type DeployState =
  | "pending"
  | "uploading_bundle"
  | "creating_resources"
  | "deploying_worker"
  | "setting_bindings"
  | "routing"
  | "completed"
  | "failed"
  | "rolled_back";

export type DeploymentStatus =
  | "pending"
  | "in_progress"
  | "success"
  | "failed"
  | "rolled_back";

export type RoutingStatus = "active" | "canary" | "rollback" | "archived";

/**
 * Narrow subset of {@link RoutingStatus} for deployments that are still
 * eligible to receive routed traffic. `archived` deployments are excluded
 * because they have been retired from the routing table.
 */
export type ActiveRoutingStatus = Exclude<RoutingStatus, "archived">;

export type DeploymentBackendName =
  | "workers-dispatch"
  | "runtime-host"
  | "oci";

export function normalizeDeploymentBackendName(
  backendName: string | null | undefined,
): DeploymentBackendName | null {
  switch (backendName) {
    case "workers-dispatch":
    case "runtime-host":
    case "oci":
      return backendName;
    default:
      return null;
  }
}

export type DeploymentBackendRef = {
  name: DeploymentBackendName;
};

export type DeploymentTargetEndpoint =
  | {
    kind: "service-ref";
    ref: string;
  }
  | {
    kind: "http-url";
    base_url: string;
  };

export type DeploymentTargetArtifact = {
  kind?: ArtifactKind;
  image_ref?: string;
  exposed_port?: number;
  health_path?: string;
  health_interval?: number;
  health_timeout?: number;
  health_unhealthy_threshold?: number;
};

/**
 * Workload readiness probe 設定 (Track G — readiness probe 200-OK-only).
 *
 * kernel が deploy 時に workload に対して `GET <path>` を送り、HTTP 200 OK のみ
 * を ready とみなす (201/204/3xx redirect/4xx/5xx/timeout は fail)。timeout は
 * hard-coded で 10 秒。失敗時は routing が更新されず deploy は fail-fast する。
 *
 * 契約の正本は readiness-probe.ts を参照 (WfP-managed worker deploy では probe は skip)。
 */
export type DeploymentTargetReadiness = {
  path: string;
};

export type DeploymentTargetQueueConsumer = {
  binding?: string;
  queue?: string;
  dead_letter_queue?: string;
  settings?: {
    batch_size?: number;
    max_concurrency?: number;
    max_retries?: number;
    max_wait_time_ms?: number;
    retry_delay?: number;
  };
};

export type DeploymentTargetCloudflareContainer = {
  class_name: string;
  image: string;
  instance_type?: string;
  max_instances?: number;
  name?: string;
  image_build_context?: string;
  image_vars?: Record<string, string>;
  rollout_active_grace_period?: number;
  rollout_step_percentage?: number | number[];
};

export type DeploymentTargetCloudflareMigration = {
  tag: string;
  new_classes?: string[];
  new_sqlite_classes?: string[];
};

export type DeploymentTargetCloudflareMetadata = {
  containers?: DeploymentTargetCloudflareContainer[];
  migrations?: DeploymentTargetCloudflareMigration[];
};

export type DeploymentTarget = {
  route_ref?: string;
  endpoint?: DeploymentTargetEndpoint;
  artifact?: DeploymentTargetArtifact;
  readiness?: DeploymentTargetReadiness;
  queue_consumers?: DeploymentTargetQueueConsumer[];
  cloudflare?: DeploymentTargetCloudflareMetadata;
};

export interface Deployment {
  id: string;
  service_id: string;
  worker_id?: string;
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
  deploy_state: DeployState;
  current_step: string | null;
  step_error: string | null;
  status: DeploymentStatus;
  routing_status: RoutingStatus;
  routing_weight: number;
  deployed_by: string | null;
  deploy_message: string | null;
  backend_name: DeploymentBackendName;
  target_json: string;
  backend_state_json: string;
  idempotency_key: string | null;
  is_rollback: boolean;
  rollback_from_version: number | null;
  rolled_back_at: string | null;
  rolled_back_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancellation_requested_at: number | null;
  created_at: string;
  updated_at: string;
}

export interface DeploymentEvent {
  id: number;
  deployment_id: string;
  actor_user_id: string | null;
  event_type: string;
  step_name: string | null;
  message: string | null;
  details: string | null;
  created_at: string;
}

export interface CreateDeploymentInput {
  serviceId?: string;
  workerId?: string;
  spaceId: string;
  userId?: string | null;
  idempotencyKey?: string | null;
  artifactKind?: ArtifactKind;
  bundleContent?: string;
  wasmContent?: ArrayBuffer | null;
  deployMessage?: string;
  strategy?: "direct" | "canary";
  canaryWeight?: number;
  backend?: DeploymentBackendRef;
  target?: DeploymentTarget;
  snapshotOverride?: {
    envVars: Record<string, string>;
    bindings: WorkerBinding[];
    runtimeConfig?: RuntimeConfig;
  };
}

export interface RuntimeConfig {
  compatibility_date?: string;
  compatibility_flags?: string[];
  limits?: { cpu_ms?: number; subrequests?: number };
}

export interface RollbackInput {
  serviceId?: string;
  workerId?: string;
  targetVersion?: number;
  userId: string;
}
