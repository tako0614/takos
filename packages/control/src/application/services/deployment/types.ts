import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import type { DbEnv } from '../../../shared/types';
import type { DurableNamespaceBinding, KvStoreBinding, ObjectStoreBinding } from '../../../shared/types/bindings.ts';
import type { WfpDeploymentProviderEnv, DeploymentProviderRegistryLike } from './provider';

export type DeploymentEnv = DbEnv & WfpDeploymentProviderEnv & {
  ENCRYPTION_KEY?: string;
  ADMIN_DOMAIN: string;
  WORKER_BUNDLES?: ObjectStoreBinding;
  OCI_ORCHESTRATOR_URL?: string;
  OCI_ORCHESTRATOR_TOKEN?: string;
  HOSTNAME_ROUTING: KvStoreBinding;
  ROUTING_DO?: DurableNamespaceBinding;
  ROUTING_DO_PHASE?: string;
  SERVICE_INTERNAL_JWT_ISSUER?: string;
  DEPLOYMENT_PROVIDER_REGISTRY?: DeploymentProviderRegistryLike;
};

export type ArtifactKind = 'worker-bundle' | 'container-image';

export type DeployState =
  | 'pending'
  | 'uploading_bundle'
  | 'creating_resources'
  | 'deploying_worker'
  | 'setting_bindings'
  | 'routing'
  | 'completed'
  | 'failed'
  | 'rolled_back';

export type DeploymentStatus = 'pending' | 'in_progress' | 'success' | 'failed' | 'rolled_back';

export type RoutingStatus = 'active' | 'canary' | 'rollback' | 'archived';

export type DeploymentProviderName = 'workers-dispatch' | 'oci' | 'ecs' | 'cloud-run' | 'k8s';

export type DeploymentProviderRef = {
  name: DeploymentProviderName;
};

export type DeploymentTargetEndpoint =
  | {
      kind: 'service-ref';
      ref: string;
    }
  | {
      kind: 'http-url';
      base_url: string;
    };

export type DeploymentTargetArtifact = {
  kind?: ArtifactKind;
  image_ref?: string;
  exposed_port?: number;
  health_path?: string;
};

export type DeploymentTarget = {
  route_ref?: string;
  endpoint?: DeploymentTargetEndpoint;
  artifact?: DeploymentTargetArtifact;
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
  strategy?: 'direct' | 'canary';
  canaryWeight?: number;
  provider?: DeploymentProviderRef;
  target?: DeploymentTarget;
  snapshotOverride?: {
    envVars: Record<string, string>;
    bindings: WorkerBinding[];
    runtimeConfig?: {
      compatibility_date?: string;
      compatibility_flags?: string[];
      limits?: { cpu_ms?: number; subrequests?: number };
      mcp_server?: {
        enabled: boolean;
        name: string;
        path: string;
      };
    };
  };
}

export interface RollbackInput {
  serviceId?: string;
  workerId?: string;
  targetVersion?: number;
  userId: string;
}
