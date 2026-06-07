import type { WorkerBinding } from "../../../platform/backends/cloudflare/wfp.ts";
import { CF_COMPATIBILITY_DATE } from "../../../shared/constants/index.ts";
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
  /**
   * Optional cancellation signal threaded from the deployment pipeline.
   *
   * Drivers that perform an outgoing fetch / RPC SHOULD propagate this into
   * their underlying transport (e.g. `fetch(url, { signal })`). Drivers
   * without an external call (e.g. `runtime-host`, in-memory mocks) MAY
   * accept the field and ignore it — but they MUST still treat a pre-aborted
   * signal as an immediate failure, so that the caller observes prompt
   * cancellation behavior. See `execute.ts` `deployment-pipeline:pre-commit`
   * for the producer side.
   *
   * WFP-backed drivers propagate this through `WfpClient.fetch`, where it is
   * composed with the provider timeout signal before reaching `fetch`.
   */
  signal?: AbortSignal;
};

export type DeploymentBackendQueueConsumerSyncInput = {
  deployment: Deployment;
  artifactRef: string;
  runtime: DeploymentBackendRuntimeInput;
  previousDeployment?: Deployment | null;
  previousArtifactRef?: string | null;
  previousRuntime?: DeploymentBackendRuntimeInput | null;
  /** Optional cancellation signal threaded from the deployment pipeline. */
  signal?: AbortSignal;
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
    compatibilityDate: runtime.config?.compatibility_date ?? CF_COMPATIBILITY_DATE,
    compatibilityFlags: runtime.config?.compatibility_flags ?? [],
    limits: runtime.config?.limits,
  };
}
