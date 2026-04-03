import type { WorkerBinding } from "../../../platform/providers/cloudflare/wfp.ts";
import type { Deployment, DeploymentProviderName } from "./models.ts";

export type DeploymentProviderDeployResult = {
  resolvedEndpoint?: { kind: "http-url"; base_url: string };
  logsRef?: string;
};

export type DeploymentProviderRuntimeInput = {
  profile: "workers" | "container-service";
  bindings?: WorkerBinding[];
  config?: {
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: { cpu_ms?: number; subrequests?: number };
  };
};

export type DeploymentProviderDeployInput = {
  deployment: Deployment;
  artifactRef: string;
  bundleContent?: string;
  wasmContent: ArrayBuffer | null;
  runtime: DeploymentProviderRuntimeInput;
};

export type DeploymentProvider = {
  name: DeploymentProviderName;
  deploy(
    input: DeploymentProviderDeployInput,
  ): Promise<DeploymentProviderDeployResult | void>;
  assertRollbackTarget(artifactRef: string): Promise<void>;
  cleanupDeploymentArtifact?(artifactRef: string): Promise<void>;
};

export type WfpDeploymentProviderEnv = {
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  WFP_DISPATCH_NAMESPACE?: string;
};

export type PersistedDeploymentContract = Pick<
  Deployment,
  "provider_name" | "target_json"
>;

export function normalizeDeployRuntime(input: DeploymentProviderDeployInput): {
  profile: "workers" | "container-service";
  bindings: WorkerBinding[];
  compatibilityDate: string;
  compatibilityFlags: string[];
  limits?: { cpu_ms?: number; subrequests?: number };
} {
  const runtime = input.runtime;
  return {
    profile: runtime.profile,
    bindings: runtime.bindings ?? [],
    compatibilityDate: runtime.config?.compatibility_date ?? "2024-01-01",
    compatibilityFlags: runtime.config?.compatibility_flags ?? [],
    limits: runtime.config?.limits,
  };
}
