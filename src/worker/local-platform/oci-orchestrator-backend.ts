import type { ContainerBackend } from "./container-backend.ts";
import { CloudRunContainerBackend } from "./cloud-run-container-backend.ts";
import { DockerContainerBackend } from "./docker-container-backend.ts";
import { EcsContainerBackend } from "./ecs-container-backend.ts";
import { K8sContainerBackend } from "./k8s-container-backend.ts";
import type {
  OciBackendName,
  OciServiceRecord,
} from "./oci-orchestrator-storage.ts";

export type OciOrchestratorBackendResolverInput = {
  backendName: OciBackendName;
  backendConfig: Record<string, unknown> | null;
};

export type OciOrchestratorBackendResolver = (
  input: OciOrchestratorBackendResolverInput,
) => ContainerBackend;

function readBackendConfigString(
  backendConfig: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = backendConfig?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readBackendConfigBoolean(
  backendConfig: Record<string, unknown> | null,
  key: string,
): boolean | undefined {
  const value = backendConfig?.[key];
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

function readBackendConfigNumber(
  backendConfig: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = backendConfig?.[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readBackendConfigStringArray(
  backendConfig: Record<string, unknown> | null,
  key: string,
): string[] | undefined {
  const value = backendConfig?.[key];
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

function requireBackendConfigString(
  backendName: OciBackendName,
  backendConfig: Record<string, unknown> | null,
  key: string,
): string {
  const value = readBackendConfigString(backendConfig, key);
  if (!value) {
    throw new Error(`${backendName} backend requires backend_config.${key}`);
  }
  return value;
}

export function createDefaultOciOrchestratorBackendResolver(options?: {
  fallbackBackend?: ContainerBackend;
}): OciOrchestratorBackendResolver {
  const fallbackBackend = options?.fallbackBackend ??
    new DockerContainerBackend();
  const backendInstances = new Map<string, ContainerBackend>();

  return ({ backendName, backendConfig }) => {
    if (backendName === "oci") {
      return fallbackBackend;
    }

    const cacheKey = `${backendName}:${JSON.stringify(backendConfig ?? {})}`;
    const existing = backendInstances.get(cacheKey);
    if (existing) {
      return existing;
    }

    let backend: ContainerBackend;
    switch (backendName) {
      case "k8s": {
        backend = new K8sContainerBackend({
          namespace: readBackendConfigString(backendConfig, "namespace"),
          deploymentName: readBackendConfigString(
            backendConfig,
            "deploymentName",
          ),
          imageRegistry: readBackendConfigString(
            backendConfig,
            "imageRegistry",
          ),
        });
        break;
      }
      case "cloud-run": {
        const projectId = requireBackendConfigString(
          backendName,
          backendConfig,
          "projectId",
        );
        const region = requireBackendConfigString(
          backendName,
          backendConfig,
          "region",
        );
        backend = new CloudRunContainerBackend({
          projectId,
          region,
          serviceId: readBackendConfigString(backendConfig, "serviceId"),
          serviceAccount: readBackendConfigString(
            backendConfig,
            "serviceAccount",
          ),
          ingress: readBackendConfigString(backendConfig, "ingress"),
          allowUnauthenticated: readBackendConfigBoolean(
            backendConfig,
            "allowUnauthenticated",
          ),
          baseUrl: readBackendConfigString(backendConfig, "baseUrl"),
          deleteOnRemove: readBackendConfigBoolean(
            backendConfig,
            "deleteOnRemove",
          ),
        });
        break;
      }
      case "ecs": {
        const region = requireBackendConfigString(
          backendName,
          backendConfig,
          "region",
        );
        const clusterArn = requireBackendConfigString(
          backendName,
          backendConfig,
          "clusterArn",
        );
        const taskDefinitionFamily = requireBackendConfigString(
          backendName,
          backendConfig,
          "taskDefinitionFamily",
        );
        backend = new EcsContainerBackend({
          region,
          clusterArn,
          taskDefinitionFamily,
          serviceArn: readBackendConfigString(backendConfig, "serviceArn"),
          serviceName: readBackendConfigString(backendConfig, "serviceName"),
          containerName: readBackendConfigString(
            backendConfig,
            "containerName",
          ),
          subnetIds: readBackendConfigStringArray(backendConfig, "subnetIds"),
          securityGroupIds: readBackendConfigStringArray(
            backendConfig,
            "securityGroupIds",
          ),
          assignPublicIp: readBackendConfigBoolean(
            backendConfig,
            "assignPublicIp",
          ),
          launchType: readBackendConfigString(backendConfig, "launchType"),
          desiredCount: readBackendConfigNumber(
            backendConfig,
            "desiredCount",
          ),
          baseUrl: readBackendConfigString(backendConfig, "baseUrl"),
          healthUrl: readBackendConfigString(backendConfig, "healthUrl"),
        });
        break;
      }
      default:
        throw new Error(`Unsupported OCI backend: ${backendName}`);
    }

    backendInstances.set(cacheKey, backend);
    return backend;
  };
}

export function resolveServiceBackend(
  backendResolver: OciOrchestratorBackendResolver,
  record: Pick<OciServiceRecord, "backend_name" | "backend_config">,
): ContainerBackend {
  return backendResolver({
    backendName: record.backend_name,
    backendConfig: record.backend_config,
  });
}
