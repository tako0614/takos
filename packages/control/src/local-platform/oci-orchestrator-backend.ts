import type { ContainerBackend } from "./container-backend.ts";
import { CloudRunContainerBackend } from "./cloud-run-container-backend.ts";
import { DockerContainerBackend } from "./docker-container-backend.ts";
import { EcsContainerBackend } from "./ecs-container-backend.ts";
import { K8sContainerBackend } from "./k8s-container-backend.ts";
import type {
  OciProviderName,
  OciServiceRecord,
} from "./oci-orchestrator-storage.ts";

export type OciOrchestratorBackendResolverInput = {
  providerName: OciProviderName;
  providerConfig: Record<string, unknown> | null;
};

export type OciOrchestratorBackendResolver = (
  input: OciOrchestratorBackendResolverInput,
) => ContainerBackend;

function readProviderConfigString(
  providerConfig: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = providerConfig?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readProviderConfigBoolean(
  providerConfig: Record<string, unknown> | null,
  key: string,
): boolean | undefined {
  const value = providerConfig?.[key];
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

function readProviderConfigNumber(
  providerConfig: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = providerConfig?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readProviderConfigStringArray(
  providerConfig: Record<string, unknown> | null,
  key: string,
): string[] | undefined {
  const value = providerConfig?.[key];
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

export function createDefaultOciOrchestratorBackendResolver(options?: {
  fallbackBackend?: ContainerBackend;
}): OciOrchestratorBackendResolver {
  const fallbackBackend = options?.fallbackBackend ??
    new DockerContainerBackend();
  const providerBackends = new Map<string, ContainerBackend>();

  return ({ providerName, providerConfig }) => {
    if (providerName === "oci") {
      return fallbackBackend;
    }

    const cacheKey = `${providerName}:${JSON.stringify(providerConfig ?? {})}`;
    const existing = providerBackends.get(cacheKey);
    if (existing) {
      return existing;
    }

    let backend: ContainerBackend;
    switch (providerName) {
      case "k8s": {
        backend = new K8sContainerBackend(
          readProviderConfigString(providerConfig, "namespace"),
        );
        break;
      }
      case "cloud-run": {
        const projectId = readProviderConfigString(providerConfig, "projectId");
        const region = readProviderConfigString(providerConfig, "region");
        if (!projectId || !region) {
          return fallbackBackend;
        }
        backend = new CloudRunContainerBackend({
          projectId,
          region,
          serviceId: readProviderConfigString(providerConfig, "serviceId"),
          serviceAccount: readProviderConfigString(
            providerConfig,
            "serviceAccount",
          ),
          ingress: readProviderConfigString(providerConfig, "ingress"),
          allowUnauthenticated: readProviderConfigBoolean(
            providerConfig,
            "allowUnauthenticated",
          ),
          baseUrl: readProviderConfigString(providerConfig, "baseUrl"),
          deleteOnRemove: readProviderConfigBoolean(
            providerConfig,
            "deleteOnRemove",
          ),
        });
        break;
      }
      case "ecs": {
        const region = readProviderConfigString(providerConfig, "region");
        const clusterArn = readProviderConfigString(
          providerConfig,
          "clusterArn",
        );
        const taskDefinitionFamily = readProviderConfigString(
          providerConfig,
          "taskDefinitionFamily",
        );
        if (!region || !clusterArn || !taskDefinitionFamily) {
          return fallbackBackend;
        }
        backend = new EcsContainerBackend({
          region,
          clusterArn,
          taskDefinitionFamily,
          serviceArn: readProviderConfigString(providerConfig, "serviceArn"),
          serviceName: readProviderConfigString(providerConfig, "serviceName"),
          containerName: readProviderConfigString(
            providerConfig,
            "containerName",
          ),
          subnetIds: readProviderConfigStringArray(providerConfig, "subnetIds"),
          securityGroupIds: readProviderConfigStringArray(
            providerConfig,
            "securityGroupIds",
          ),
          assignPublicIp: readProviderConfigBoolean(
            providerConfig,
            "assignPublicIp",
          ),
          launchType: readProviderConfigString(providerConfig, "launchType"),
          desiredCount: readProviderConfigNumber(
            providerConfig,
            "desiredCount",
          ),
          baseUrl: readProviderConfigString(providerConfig, "baseUrl"),
          healthUrl: readProviderConfigString(providerConfig, "healthUrl"),
        });
        break;
      }
      default:
        return fallbackBackend;
    }

    providerBackends.set(cacheKey, backend);
    return backend;
  };
}

export function resolveServiceBackend(
  backendResolver: OciOrchestratorBackendResolver,
  record: Pick<OciServiceRecord, "provider_name" | "provider_config">,
): ContainerBackend {
  return backendResolver({
    providerName: record.provider_name,
    providerConfig: record.provider_config,
  });
}
