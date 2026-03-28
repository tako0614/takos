/**
 * Group Deploy — type definitions.
 *
 * Shared types (ServiceDeployResult, ResourceProvisionResult, BindingResult,
 * GroupDeployResult, ProvisionedResource, WranglerConfig, status aliases, and
 * Wrangler binding sub-types) are canonical in
 *   `packages/control/src/application/services/deployment/group-deploy-types.ts`
 * and re-exported here for CLI consumption.
 *
 * CLI-specific types (container specs, manifest defs, template context,
 * wrangler-direct types, GroupDeployOptions) are defined locally below.
 */

// ── Re-exports from canonical source ────────────────────────────────────────

export type {
  ServiceDeployStatus,
  ResourceProvisionStatus,
  BindingStatus,
  ServiceDeployResult,
  ResourceProvisionResult,
  BindingResult,
  GroupDeployResult,
  ProvisionedResource,
  WranglerConfig,
  WranglerD1Binding,
  WranglerR2Binding,
  WranglerKVBinding,
  WranglerServiceBinding,
  WranglerVars,
} from 'takos-control/deployment/group-deploy-types';

// ── CLI-specific types ──────────────────────────────────────────────────────

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
