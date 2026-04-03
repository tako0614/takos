import type { DeploymentProviderName } from "./models.ts";
import type { WfpDeploymentProviderEnv } from "./provider-contracts.ts";

export type OciDeploymentOrchestratorConfig = {
  orchestratorUrl?: string;
  orchestratorToken?: string;
  fetchImpl?: typeof fetch;
};

type DeploymentProviderRegistryEntry = {
  name: DeploymentProviderName;
  config?: Record<string, unknown>;
};

export type DeploymentProviderFactoryConfig =
  & OciDeploymentOrchestratorConfig
  & {
    cloudflareEnv?: WfpDeploymentProviderEnv;
    awsRegion?: string;
    awsEcsClusterArn?: string;
    awsEcsTaskDefinitionFamily?: string;
    awsEcsServiceArn?: string;
    awsEcsServiceName?: string;
    awsEcsContainerName?: string;
    awsEcsSubnetIds?: string;
    awsEcsSecurityGroupIds?: string;
    awsEcsAssignPublicIp?: string;
    awsEcsLaunchType?: string;
    awsEcsDesiredCount?: string;
    awsEcsBaseUrl?: string;
    awsEcsHealthUrl?: string;
    awsEcrRepositoryUri?: string;
    gcpProjectId?: string;
    gcpRegion?: string;
    gcpCloudRunServiceId?: string;
    gcpCloudRunServiceAccount?: string;
    gcpCloudRunIngress?: string;
    gcpCloudRunAllowUnauthenticated?: string;
    gcpCloudRunBaseUrl?: string;
    gcpCloudRunDeleteOnRemove?: string;
    gcpArtifactRegistryRepo?: string;
    k8sNamespace?: string;
    k8sDeploymentName?: string;
    k8sImageRegistry?: string;
    providerRegistry?: {
      get(
        name: DeploymentProviderName,
      ): DeploymentProviderRegistryEntry | undefined;
    };
  };

export type OrchestratedDeploymentProviderName =
  | "oci"
  | "ecs"
  | "cloud-run"
  | "k8s";

export type OrchestratedDeploymentProviderConfig =
  & OciDeploymentOrchestratorConfig
  & {
    providerName: OrchestratedDeploymentProviderName;
    providerConfig?: Record<string, unknown>;
  };

export type ResolvedDeploymentProviderFactory =
  | {
    kind: "orchestrated";
    config: OrchestratedDeploymentProviderConfig;
  }
  | {
    kind: "workers-dispatch";
    cloudflareEnv: Required<WfpDeploymentProviderEnv>;
  }
  | {
    kind: "runtime-host";
  };

function compactRecord<T extends Record<string, unknown>>(
  value: T,
): T | undefined {
  const filtered = Object.entries(value).filter(([, entry]) => {
    if (entry == null) return false;
    if (typeof entry === "string") return entry.trim().length > 0;
    return true;
  });
  if (filtered.length === 0) {
    return undefined;
  }
  return Object.fromEntries(filtered) as T;
}

function readRegistryString(
  entry: DeploymentProviderRegistryEntry | undefined,
  key: string,
): string | undefined {
  const value = entry?.config?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readConfigString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readConfigBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return undefined;
}

function readConfigNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readConfigStringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const entries = value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return entries.length > 0 ? entries : undefined;
  }
  if (typeof value === "string") {
    const entries = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return entries.length > 0 ? entries : undefined;
  }
  return undefined;
}

function resolveRegistryProviderConfig(
  entry: DeploymentProviderRegistryEntry | undefined,
): Record<string, unknown> | undefined {
  if (
    !entry?.config || typeof entry.config !== "object" ||
    Array.isArray(entry.config)
  ) {
    return undefined;
  }

  const providerConfig = Object.fromEntries(
    Object.entries(entry.config)
      .filter(([key]) =>
        key !== "orchestratorUrl" && key !== "orchestratorToken"
      ),
  );

  return Object.keys(providerConfig).length > 0 ? providerConfig : undefined;
}

function resolveEnvProviderConfig(
  providerName: OrchestratedDeploymentProviderName,
  config: DeploymentProviderFactoryConfig,
): Record<string, unknown> | undefined {
  switch (providerName) {
    case "ecs":
      return compactRecord({
        region: readConfigString(config.awsRegion),
        clusterArn: readConfigString(config.awsEcsClusterArn),
        taskDefinitionFamily: readConfigString(
          config.awsEcsTaskDefinitionFamily,
        ),
        serviceArn: readConfigString(config.awsEcsServiceArn),
        serviceName: readConfigString(config.awsEcsServiceName),
        containerName: readConfigString(config.awsEcsContainerName),
        subnetIds: readConfigStringList(config.awsEcsSubnetIds),
        securityGroupIds: readConfigStringList(config.awsEcsSecurityGroupIds),
        assignPublicIp: readConfigBoolean(config.awsEcsAssignPublicIp),
        launchType: readConfigString(config.awsEcsLaunchType),
        desiredCount: readConfigNumber(config.awsEcsDesiredCount),
        baseUrl: readConfigString(config.awsEcsBaseUrl),
        healthUrl: readConfigString(config.awsEcsHealthUrl),
        ecrRepositoryUri: readConfigString(config.awsEcrRepositoryUri),
      });
    case "cloud-run":
      return compactRecord({
        projectId: readConfigString(config.gcpProjectId),
        region: readConfigString(config.gcpRegion),
        serviceId: readConfigString(config.gcpCloudRunServiceId),
        serviceAccount: readConfigString(config.gcpCloudRunServiceAccount),
        ingress: readConfigString(config.gcpCloudRunIngress),
        allowUnauthenticated: readConfigBoolean(
          config.gcpCloudRunAllowUnauthenticated,
        ),
        baseUrl: readConfigString(config.gcpCloudRunBaseUrl),
        deleteOnRemove: readConfigBoolean(config.gcpCloudRunDeleteOnRemove),
        artifactRegistryRepo: readConfigString(config.gcpArtifactRegistryRepo),
      });
    case "k8s":
      return compactRecord({
        namespace: readConfigString(config.k8sNamespace),
        deploymentName: readConfigString(config.k8sDeploymentName),
        imageRegistry: readConfigString(config.k8sImageRegistry),
      });
    case "oci":
    default:
      return undefined;
  }
}

export function resolveDeploymentProviderFactory(
  providerName: DeploymentProviderName,
  hasImageRef: boolean,
  config: DeploymentProviderFactoryConfig = {},
): ResolvedDeploymentProviderFactory {
  const registryEntry = config.providerRegistry?.get(providerName);
  const registryOrchestratorUrl = readRegistryString(
    registryEntry,
    "orchestratorUrl",
  );
  const registryOrchestratorToken = readRegistryString(
    registryEntry,
    "orchestratorToken",
  );
  const registryProviderConfig = resolveRegistryProviderConfig(registryEntry);

  switch (providerName) {
    case "ecs":
    case "cloud-run":
    case "k8s":
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
          providerName,
          providerConfig: registryProviderConfig ??
            resolveEnvProviderConfig(providerName, config),
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
      throw new Error(`Unknown deployment provider: ${providerName}`);
  }
}
