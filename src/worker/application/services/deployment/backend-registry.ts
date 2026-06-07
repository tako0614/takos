import {
  type DeploymentBackendName,
  normalizeDeploymentBackendName,
} from "./models.ts";
import type { WfpDeploymentBackendEnv } from "./backend-contracts.ts";

export type OciDeploymentOrchestratorConfig = {
  orchestratorUrl?: string;
  orchestratorToken?: string;
  fetchImpl?: typeof fetch;
};

export type DeploymentBackendFactoryConfig =
  & OciDeploymentOrchestratorConfig
  & {
    cloudflareEnv?: WfpDeploymentBackendEnv;
  };

export type OrchestratedDeploymentBackendName = "oci";

export type OrchestratedDeploymentBackendConfig =
  & OciDeploymentOrchestratorConfig
  & {
    backendName: OrchestratedDeploymentBackendName;
    backendConfig?: Record<string, unknown>;
  };

export type ResolvedDeploymentBackendFactory =
  | {
    kind: "orchestrated";
    config: OrchestratedDeploymentBackendConfig;
  }
  | {
    kind: "workers-dispatch";
    cloudflareEnv: Required<WfpDeploymentBackendEnv>;
  }
  | {
    kind: "runtime-host";
  };

export function resolveDeploymentBackendFactory(
  backendName: DeploymentBackendName,
  hasImageRef: boolean,
  config: DeploymentBackendFactoryConfig = {},
): ResolvedDeploymentBackendFactory {
  const normalizedBackendName = normalizeDeploymentBackendName(backendName) ??
    backendName;

  switch (normalizedBackendName) {
    case "oci":
      if (hasImageRef && !config.orchestratorUrl?.trim()) {
        throw new Error("OCI deployment target requires OCI_ORCHESTRATOR_URL");
      }
      return {
        kind: "orchestrated",
        config: {
          backendName: "oci",
          orchestratorUrl: config.orchestratorUrl,
          orchestratorToken: config.orchestratorToken,
          fetchImpl: config.fetchImpl,
        },
      };

    case "workers-dispatch": {
      const accountId = config.cloudflareEnv?.CF_ACCOUNT_ID;
      const apiToken = config.cloudflareEnv?.CF_API_TOKEN;
      const dispatchNamespace = config.cloudflareEnv?.WFP_DISPATCH_NAMESPACE;

      if (!accountId || !apiToken || !dispatchNamespace) {
        throw new Error("workers-dispatch deployment requires WFP environment");
      }

      return {
        kind: "workers-dispatch",
        cloudflareEnv: {
          CF_ACCOUNT_ID: accountId,
          CF_API_TOKEN: apiToken,
          WFP_DISPATCH_NAMESPACE: dispatchNamespace,
        },
      };
    }

    case "runtime-host":
      return { kind: "runtime-host" };

    default:
      throw new Error(`Unknown deployment backend: ${backendName}`);
  }
}
