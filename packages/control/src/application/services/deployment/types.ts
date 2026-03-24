import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';

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

export type DeploymentProviderName = 'cloudflare' | 'oci';

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
  image_ref?: string;
  exposed_port?: number;
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
  bundleContent: string;
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
