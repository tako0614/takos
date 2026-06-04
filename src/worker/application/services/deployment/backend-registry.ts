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

type DeploymentBackendRegistryEntry = {
  name: DeploymentBackendName;
  config?: Record<string, unknown>;
};

export type DeploymentBackendFactoryConfig =
  & OciDeploymentOrchestratorConfig
  & {
    cloudflareEnv?: WfpDeploymentBackendEnv;
    backendRegistry?: {
      get(
        name: DeploymentBackendName,
      ): DeploymentBackendRegistryEntry | undefined;
    };
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

function readRegistryString(
  entry: DeploymentBackendRegistryEntry | undefined,
  key: string,
): string | undefined {
  const value = entry?.config?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function resolveRegistryBackendConfig(
  entry: DeploymentBackendRegistryEntry | undefined,
): Record<string, unknown> | undefined {
  if (
    !entry?.config || typeof entry.config !== "object" ||
    Array.isArray(entry.config)
  ) {
    return undefined;
  }

  const backendConfig = Object.fromEntries(
    Object.entries(entry.config)
      .filter(([key]) =>
        key !== "orchestratorUrl" && key !== "orchestratorToken"
      ),
  );

  return Object.keys(backendConfig).length > 0 ? backendConfig : undefined;
}

export function resolveDeploymentBackendFactory(
  backendName: DeploymentBackendName,
  hasImageRef: boolean,
  config: DeploymentBackendFactoryConfig = {},
): ResolvedDeploymentBackendFactory {
  const normalizedBackendName = normalizeDeploymentBackendName(backendName) ??
    backendName;
  const registryEntry = config.backendRegistry?.get(normalizedBackendName);
  const registryOrchestratorUrl = readRegistryString(
    registryEntry,
    "orchestratorUrl",
  );
  const registryOrchestratorToken = readRegistryString(
    registryEntry,
    "orchestratorToken",
  );
  const registryBackendConfig = resolveRegistryBackendConfig(registryEntry);

  switch (normalizedBackendName) {
    case "oci":
      if (
        hasImageRef &&
        !((registryOrchestratorUrl ?? config.orchestratorUrl)?.trim())
      ) {
        throw new Error("OCI deployment target requires OCI_ORCHESTRATOR_URL");
      }
      return {
        kind: "orchestrated",
        config: {
          backendName: "oci",
          backendConfig: registryBackendConfig,
          orchestratorUrl: registryOrchestratorUrl ?? config.orchestratorUrl,
          orchestratorToken: registryOrchestratorToken ??
            config.orchestratorToken,
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
