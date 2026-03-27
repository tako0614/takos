import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import type { HttpRoute } from '../routing/types';

export interface ManifestResources {
  d1?: Array<{ binding: string; migrations?: string }>;
  r2?: Array<{ binding: string }>;
  kv?: Array<{ binding: string }>;
  queue?: Array<{
    binding: string;
    maxRetries?: number;
    deadLetterQueue?: string;
    deliveryDelaySeconds?: number;
  }>;
  analyticsEngine?: Array<{
    binding: string;
    dataset?: string;
  }>;
  workflow?: Array<{
    binding: string;
    service: string;
    export: string;
    timeoutMs?: number;
    maxRetries?: number;
  }>;
  vectorize?: Array<{
    binding: string;
    dimensions?: number;
    metric?: 'cosine' | 'euclidean' | 'dot-product';
  }>;
  durableObject?: Array<{
    binding: string;
    className: string;
    scriptName?: string;
  }>;
}

export type TakopackManifestKind =
  | 'Package'
  | 'Resource'
  | 'Workload'
  | 'Endpoint'
  | 'Binding'
  | 'McpServer'
  | 'Policy'
  | 'Rollout';

export interface TakopackObjectBase {
  apiVersion: 'takos.dev/v1alpha1';
  kind: TakopackManifestKind;
  metadata: {
    name: string;
    labels?: Record<string, string>;
  };
  spec: Record<string, unknown>;
}

export interface TakopackFileHandler {
  name: string;
  mimeTypes?: string[];
  extensions?: string[];
  openPath: string;
}

export interface TakopackPackageObject extends TakopackObjectBase {
  kind: 'Package';
  spec: {
    appId?: string;
    version: string;
    description?: string;
    icon?: string;
    category?: 'app' | 'service' | 'library' | 'template' | 'social';
    tags?: string[];
    dependencies?: Array<{ repo: string; version: string }>;
    capabilities?: string[];
    oauth?: {
      clientName: string;
      redirectUris: string[];
      scopes: string[];
      autoEnv?: boolean;
      metadata?: { logoUri?: string; tosUri?: string; policyUri?: string };
    };
    takos?: {
      scopes: string[];
    };
    env?: {
      required?: string[];
    };
    fileHandlers?: TakopackFileHandler[];
  };
}

export interface TakopackResourceObject extends TakopackObjectBase {
  kind: 'Resource';
  spec: {
    type: 'd1' | 'r2' | 'kv' | 'queue' | 'analyticsEngine' | 'workflow' | 'secretRef' | 'vectorize' | 'durableObject';
    binding?: string;
    migrations?: string;
    queue?: {
      maxRetries?: number;
      deadLetterQueue?: string;
      deliveryDelaySeconds?: number;
    };
    analyticsEngine?: {
      dataset?: string;
    };
    workflow?: {
      service: string;
      export: string;
      timeoutMs?: number;
      maxRetries?: number;
    };
    vectorize?: {
      dimensions: number;
      metric: 'cosine' | 'euclidean' | 'dot-product';
    };
    durableObject?: {
      className: string;
      scriptName?: string;
    };
    /** For type: 'secretRef' — auto-generate a random token at deploy time. */
    generate?: boolean;
  };
}

export interface TakopackWorkloadObject extends TakopackObjectBase {
  kind: 'Workload';
  spec: {
    type: string;
    pluginConfig: Record<string, unknown>;
    artifactRef?: string;
    envFrom?: string[];
  };
}

export interface TakopackBindingObject extends TakopackObjectBase {
  kind: 'Binding';
  spec: {
    from: string;
    to: string;
    mount?: {
      as?: string;
      type?: 'd1' | 'r2' | 'kv' | 'queue' | 'analyticsEngine' | 'workflow' | 'secretRef' | 'vectorize' | 'durableObject';
    };
  };
}

export interface TakopackEndpointObject extends TakopackObjectBase {
  kind: 'Endpoint';
  spec: {
    protocol: 'http';
    targetRef: string;
    ingressRef?: string;
    path?: string;
    timeoutMs?: number;
    /** Authentication requirement: 'none' (default), 'bearer', 'takos'. */
    auth?: 'none' | 'bearer' | 'takos';
  };
}

export interface TakopackMcpServerObject extends TakopackObjectBase {
  kind: 'McpServer';
  spec: {
    endpointRef: string;
    name?: string;
    transport?: 'streamable-http';
    /** Reference to a Resource(type=secretRef) for Bearer token auth. */
    authSecretRef?: string;
  };
}

/** Reserved — parsed but not processed in v1alpha1. */
export interface TakopackPolicyObject extends TakopackObjectBase {
  kind: 'Policy';
}

export interface TakopackRolloutObject extends TakopackObjectBase {
  kind: 'Rollout';
  spec: {
    strategy: 'staged' | 'immediate';
    stages?: Array<{
      weight: number;
      pauseMinutes: number;
    }>;
    healthCheck?: {
      errorRateThreshold: number;
      minRequests: number;
    };
    autoPromote: boolean;
  };
}

export interface RolloutState {
  status: 'in_progress' | 'paused' | 'completed' | 'aborted' | 'failed';
  currentStageIndex: number;
  stages: Array<{ weight: number; pauseMinutes: number }>;
  healthCheck: { errorRateThreshold: number; minRequests: number } | null;
  autoPromote: boolean;
  stageEnteredAt: string;
  deploymentId: string;
  serviceId: string;
}

export type TakopackObject =
  | TakopackPackageObject
  | TakopackResourceObject
  | TakopackWorkloadObject
  | TakopackBindingObject
  | TakopackEndpointObject
  | TakopackMcpServerObject
  | TakopackPolicyObject
  | TakopackRolloutObject;

export type TakopackApplyPhase = 'validated' | 'planned' | 'applied';

export interface TakopackApplyReportEntry {
  objectName: string;
  kind: TakopackManifestKind;
  phase: TakopackApplyPhase;
  status: 'success' | 'failed';
  message?: string;
}

// Internal normalized manifest for installer pipeline.
export interface TakopackManifest {
  manifestVersion: 'vnext-infra-v1alpha1';
  buildSources?: Array<{
    serviceName: string;
    workflowPath: string;
    workflowJobKey: string;
    workflowJobId: string;
    workflowArtifact: string;
    workflowArtifactPath: string;
    sourceRef: string;
    sourceSha: string;
  }>;
  meta: {
    name: string;
    appId: string;
    version: string;
    description?: string;
    icon?: string;
    category?: 'app' | 'service' | 'library' | 'template' | 'social';
    tags?: string[];
    createdAt: string;
    dependencies?: Array<{ repo: string; version: string }>;
  };
  dependencies?: Array<{ repo: string; version: string }>;
  capabilities?: string[];
  resources?: ManifestResources;
  group?: {
    workers: string[];
    ui: string[];
    resources: {
      d1: string[];
      r2: string[];
      kv: string[];
      queue: string[];
      analyticsEngine: string[];
      workflow: string[];
      vectorize: string[];
      durableObject: string[];
    };
    links: Array<{ label: string; url: string; icon?: string }>;
  };
  oauth?: {
    clientName: string;
    redirectUris: string[];
    scopes: string[];
    autoEnv: boolean;
    metadata?: { logoUri?: string; tosUri?: string; policyUri?: string };
  };
  takos?: {
    scopes: string[];
  };
  env?: {
    required?: string[];
  };
  workers?: Array<{
    name: string;
    bundle: string;
    bundleHash: string;
    bundleSize: number;
    bindings: {
      d1: string[];
      r2: string[];
      kv: string[];
      queue?: string[];
      analytics?: string[];
      workflows?: string[];
      vectorize?: string[];
      durableObjects?: string[];
      services?: string[];
    };
    triggers?: {
      schedules?: Array<{ cron: string; export: string }>;
      queues?: Array<{ queue: string; export: string }>;
    };
    env: Record<string, string>;
  }>;
  endpoints?: ManifestEndpoint[];
  mcpServers?: ManifestMcpServer[];
  fileHandlers?: TakopackFileHandler[];
  rollout?: TakopackRolloutObject['spec'];
  objects: TakopackObject[];
}

export interface ManifestEndpoint {
  name: string;
  protocol: 'http';
  targetRef: string;
  targetRuntime: 'cloudflare.worker';
  ingressRef?: string;
  ingressWorker?: string;
  routes: HttpRoute[];
  path?: string;
  timeoutMs?: number;
  auth?: 'none' | 'bearer' | 'takos';
}

export type { HttpRoute };

export interface ManifestMcpServer {
  name: string;
  transport: 'streamable-http';
  worker: string;
  endpoint: string;
  path: string;
  /** Resource name of a secretRef to use as Bearer token auth. */
  authSecretRef?: string;
}

export interface ParsedTakopackPackage {
  manifest: TakopackManifest;
  files: Map<string, ArrayBuffer>;
  applyReport: TakopackApplyReportEntry[];
}

export interface ResourceProvisionResultEntry {
  binding: string;
  id: string;
  name: string;
  resourceId: string;
  wasAdopted: boolean;
}

export interface ResourceProvisionResult {
  d1: ResourceProvisionResultEntry[];
  r2: Array<{ binding: string; name: string; resourceId: string; wasAdopted: boolean }>;
  kv: ResourceProvisionResultEntry[];
  queue: ResourceProvisionResultEntry[];
  analyticsEngine: Array<{ binding: string; name: string; resourceId: string; wasAdopted: boolean }>;
  workflow: Array<{ binding: string; name: string; resourceId: string; wasAdopted: boolean }>;
  vectorize: ResourceProvisionResultEntry[];
  durableObject: Array<{ binding: string; name: string; resourceId: string; className: string; scriptName?: string; wasAdopted: boolean }>;
}

export interface WorkerDeploymentResult {
  manifestWorkerName: string;
  workerId: string;
  workerName: string;
  artifactRef: string;
  slug: string;
  hostname: string;
}

export type ManifestWorkerConfig = NonNullable<TakopackManifest['workers']>[number];

export interface ResolvedWorkerResourceBinding {
  bindingType: 'd1' | 'r2' | 'kv' | 'queue' | 'analytics_engine' | 'workflow' | 'vectorize' | 'durable_object';
  bindingName: string;
  resourceId: string;
  wfpBinding: WorkerBinding;
}

export interface ProvisionedResourceReferenceMaps {
  d1: Map<string, string>;
  r2: Map<string, string>;
  kv: Map<string, string>;
  queue: Map<string, string>;
  analyticsEngine: Map<string, string>;
  workflow: Map<string, string>;
  vectorize: Map<string, string>;
  durableObject: Map<string, string>;
}

export interface InstallResult {
  bundleDeploymentId: string;
  appId: string;
  name: string;
  version: string;
  groupsCreated: number;
  toolsCreated: number;
  resourcesCreated: {
    d1: number;
    r2: number;
    kv: number;
    queue: number;
    analyticsEngine: number;
    workflow: number;
    vectorize: number;
    durableObject: number;
  };
  rolloutInitiated?: boolean;
  applyReport: TakopackApplyReportEntry[];
  oauthClientId?: string;
  sourceType?: 'git' | 'upload';
  sourceRepoId?: string;
  sourceTag?: string;
  sourceAssetId?: string;
}

export interface GitInstallOptions {
  repoId: string;
  releaseTag: string;
  assetId?: string;
  replaceBundleDeploymentId?: string;
  approveSourceChange?: boolean;
  takosBaseUrl?: string;
  installAction?: 'install' | 'update' | 'rollback';
  skipDependencyResolution?: boolean;
  requireAutoEnvApproval?: boolean;
  oauthAutoEnvApproved?: boolean;
}

export interface ReleaseAsset {
  id: string;
  name: string;
  content_type: string;
  size: number;
  r2_key: string;
  download_count: number;
  bundle_format?: string;
  bundle_meta?: {
    name?: string;
    app_id?: string;
    version: string;
    description?: string;
    icon?: string;
    category?: 'app' | 'service' | 'library' | 'template' | 'social';
    tags?: string[];
    dependencies?: Array<{ repo: string; version: string }>;
  };
  created_at: string;
}
