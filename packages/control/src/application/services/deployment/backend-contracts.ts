import type { WorkerBinding } from "../../../platform/backends/cloudflare/wfp.ts";
import type { Deployment, DeploymentBackendName } from "./models.ts";

export type DeploymentBackendDeployResult = {
  resolvedEndpoint?: { kind: "http-url"; base_url: string };
  logsRef?: string;
};

export type DeploymentBackendRuntimeInput = {
  profile: "workers" | "container-service";
  bindings?: WorkerBinding[];
  envVars?: Record<string, string>;
  config?: {
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: { cpu_ms?: number; subrequests?: number };
  };
};

export type DeploymentBackendDeployInput = {
  deployment: Deployment;
  artifactRef: string;
  bundleContent?: string;
  wasmContent: ArrayBuffer | null;
  runtime: DeploymentBackendRuntimeInput;
};

export type DeploymentBackendQueueConsumerSyncInput = {
  deployment: Deployment;
  artifactRef: string;
  runtime: DeploymentBackendRuntimeInput;
  previousDeployment?: Deployment | null;
  previousArtifactRef?: string | null;
  previousRuntime?: DeploymentBackendRuntimeInput | null;
};

export type DeploymentBackend = {
  name: DeploymentBackendName;
  deploy(
    input: DeploymentBackendDeployInput,
  ): Promise<DeploymentBackendDeployResult | void>;
  assertRollbackTarget(artifactRef: string): Promise<void>;
  syncQueueConsumers?(
    input: DeploymentBackendQueueConsumerSyncInput,
  ): Promise<void>;
  cleanupDeploymentArtifact?(artifactRef: string): Promise<void>;
};

export type WfpDeploymentBackendEnv = {
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  WFP_DISPATCH_NAMESPACE?: string;
};

export type PersistedDeploymentBackendContract = Pick<
  Deployment,
  "backend_name" | "target_json"
>;

export function normalizeDeployRuntime(input: DeploymentBackendDeployInput): {
  profile: "workers" | "container-service";
  bindings: WorkerBinding[];
  envVars: Record<string, string>;
  compatibilityDate: string;
  compatibilityFlags: string[];
  limits?: { cpu_ms?: number; subrequests?: number };
} {
  const runtime = input.runtime;
  return {
    profile: runtime.profile,
    bindings: runtime.bindings ?? [],
    envVars: runtime.envVars ?? {},
    compatibilityDate: runtime.config?.compatibility_date ?? "2024-01-01",
    compatibilityFlags: runtime.config?.compatibility_flags ?? [],
    limits: runtime.config?.limits,
  };
}
