/**
 * Group Deploy — type definitions.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type ServiceDeployStatus = 'deployed' | 'failed' | 'skipped';
export type ResourceProvisionStatus = 'provisioned' | 'exists' | 'failed';
export type BindingStatus = 'bound' | 'failed';

export interface ServiceDeployResult {
  name: string;
  type: 'worker' | 'container' | 'http';
  status: ServiceDeployStatus;
  scriptName?: string;
  url?: string;
  error?: string;
}

export interface ResourceProvisionResult {
  name: string;
  type: string;
  status: ResourceProvisionStatus;
  id?: string;
  error?: string;
}

export interface BindingResult {
  from: string;
  to: string;
  type: string;
  status: BindingStatus;
  error?: string;
}

export interface GroupDeployResult {
  groupName: string;
  env: string;
  namespace?: string;
  dryRun: boolean;
  services: ServiceDeployResult[];
  resources: ResourceProvisionResult[];
  bindings: BindingResult[];
}

export interface ContainerSpec {
  dockerfile: string;
  port?: number;
  instanceType?: string;
  maxInstances?: number;
}

export interface WorkerContainerSpec {
  name: string;
  dockerfile: string;
  port: number;
  instanceType?: string;
  maxInstances?: number;
}

export interface ManifestWorkerDef {
  build?: {
    fromWorkflow: {
      path: string;
      job: string;
      artifact: string;
      artifactPath: string;
    };
  };
  env?: Record<string, string>;
  bindings?: {
    d1?: string[];
    r2?: string[];
    kv?: string[];
    services?: string[];
  };
  containers?: string[];
}

export interface ManifestContainerDef {
  dockerfile: string;
  port?: number;
  instanceType?: string;
  maxInstances?: number;
  ipv4?: boolean;
  env?: Record<string, string>;
}

export interface TemplateContext {
  routes: Record<string, { url: string; domain: string; path: string }>;
  containers: Record<string, { ipv4?: string }>;
  workers: Record<string, { url?: string }>;
  resources: Record<string, { id?: string }>;
}

export interface GroupDeployOptions {
  manifest: {
    apiVersion: string;
    kind: string;
    metadata: { name: string; appId?: string };
    spec: {
      version: string;
      resources?: Record<string, { type: 'd1' | 'r2' | 'kv' | 'secretRef'; binding?: string }>;
      workers?: Record<string, ManifestWorkerDef>;
      containers?: Record<string, ManifestContainerDef>;
      routes?: Array<{ name: string; target: string; path?: string }>;
      env?: { required?: string[]; inject?: Record<string, string> };
    };
  };
  env: string;
  namespace?: string;
  groupName?: string;
  accountId: string;
  apiToken: string;
  dryRun?: boolean;
  compatibilityDate?: string;
  serviceFilter?: string[];
  workerFilter?: string[];
  containerFilter?: string[];
  manifestDir?: string;
  baseDomain?: string;
}

export interface WranglerDirectDeployOptions {
  wranglerConfigPath: string;
  env: string;
  namespace?: string;
  accountId: string;
  apiToken: string;
  dryRun?: boolean;
}

export interface WranglerDirectDeployResult {
  configPath: string;
  env: string;
  namespace?: string;
  status: 'deployed' | 'failed' | 'dry-run';
  error?: string;
}

export interface ProvisionedResource {
  name: string;
  type: string;
  id: string;
  binding: string;
}

export interface WranglerConfig {
  name: string;
  main: string;
  compatibility_date: string;
  vars?: Record<string, string>;
  d1_databases?: Array<{ binding: string; database_name: string; database_id: string }>;
  r2_buckets?: Array<{ binding: string; bucket_name: string }>;
  kv_namespaces?: Array<{ binding: string; id: string }>;
  services?: Array<{ binding: string; service: string }>;
  dispatch_namespace?: string;
}

export interface ContainerWranglerConfig {
  name: string;
  main: string;
  compatibility_date: string;
  compatibility_flags: string[];
  durable_objects: { bindings: Array<{ name: string; class_name: string }> };
  containers: Array<{ class_name: string; image: string; image_build_context: string; instance_type: string; max_instances: number }>;
  migrations: Array<{ tag: string; new_classes: string[] }>;
  dispatch_namespace?: string;
}

/** Container service definition - used by container.ts */
export interface ContainerServiceDef {
  type: 'container';
  container: ContainerSpec;
  env?: Record<string, string>;
}

/** Worker service definition - used by wrangler-config.ts */
export interface WorkerServiceDef {
  type: 'worker';
  build?: { fromWorkflow: { path: string; job: string; artifact: string; artifactPath: string } };
  env?: Record<string, string>;
  bindings?: { d1?: string[]; r2?: string[]; kv?: string[]; services?: string[] };
  containers?: WorkerContainerSpec[];
}
