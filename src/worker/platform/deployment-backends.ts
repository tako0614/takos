import type {
  CloudRunDeployBackendConfig,
  EcsDeployBackendConfig,
  K8sDeployBackendConfig,
  OciDeployBackendConfig,
  PlatformDeployBackendConfig,
  PlatformDeployBackendRegistry,
  WorkersDispatchDeployBackendConfig,
} from "./platform-config.ts";
import { resolveGoogleCloudProject } from "./gcp-project.ts";

type EnvRecord = object;

function getEnvString(env: EnvRecord, key: string): string | undefined {
  const value = Reflect.get(env, key);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getEnvBoolean(env: EnvRecord, key: string): boolean | undefined {
  const value = getEnvString(env, key);
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return undefined;
}

function getEnvNumber(env: EnvRecord, key: string): number | undefined {
  const value = getEnvString(env, key);
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getEnvStringList(env: EnvRecord, key: string): string[] | undefined {
  const value = getEnvString(env, key);
  if (!value) return undefined;
  const entries = value.split(",").map((entry) => entry.trim()).filter((
    entry,
  ) => entry.length > 0);
  return entries.length > 0 ? entries : undefined;
}

function createWorkersDispatchConfig(
  env: EnvRecord,
): WorkersDispatchDeployBackendConfig | null {
  const accountId = getEnvString(env, "CF_ACCOUNT_ID");
  const apiToken = getEnvString(env, "CF_API_TOKEN");
  const dispatchNamespace = getEnvString(env, "WFP_DISPATCH_NAMESPACE");
  if (!accountId || !apiToken || !dispatchNamespace) {
    return null;
  }
  const zoneId = getEnvString(env, "CF_ZONE_ID");
  return {
    name: "workers-dispatch",
    config: {
      accountId,
      apiToken,
      dispatchNamespace,
      ...(zoneId ? { zoneId } : {}),
    },
  };
}

function createOciConfig(env: EnvRecord): OciDeployBackendConfig | null {
  const orchestratorUrl = getEnvString(env, "OCI_ORCHESTRATOR_URL");
  if (!orchestratorUrl) return null;
  const orchestratorToken = getEnvString(env, "OCI_ORCHESTRATOR_TOKEN");
  return {
    name: "oci",
    config: {
      orchestratorUrl,
      ...(orchestratorToken ? { orchestratorToken } : {}),
    },
  };
}

function createEcsConfig(env: EnvRecord): EcsDeployBackendConfig | null {
  const clusterArn = getEnvString(env, "AWS_ECS_CLUSTER_ARN");
  const taskDefinitionFamily = getEnvString(
    env,
    "AWS_ECS_TASK_DEFINITION_FAMILY",
  );
  const region = getEnvString(env, "AWS_ECS_REGION") ??
    getEnvString(env, "AWS_REGION");
  if (!clusterArn || !taskDefinitionFamily || !region) {
    return null;
  }
  const serviceArn = getEnvString(env, "AWS_ECS_SERVICE_ARN");
  const serviceName = getEnvString(env, "AWS_ECS_SERVICE_NAME");
  const containerName = getEnvString(env, "AWS_ECS_CONTAINER_NAME");
  const subnetIds = getEnvStringList(env, "AWS_ECS_SUBNET_IDS");
  const securityGroupIds = getEnvStringList(env, "AWS_ECS_SECURITY_GROUP_IDS");
  const assignPublicIp = getEnvBoolean(env, "AWS_ECS_ASSIGN_PUBLIC_IP");
  const launchType = getEnvString(env, "AWS_ECS_LAUNCH_TYPE");
  const desiredCount = getEnvNumber(env, "AWS_ECS_DESIRED_COUNT");
  const baseUrl = getEnvString(env, "AWS_ECS_BASE_URL");
  const healthUrl = getEnvString(env, "AWS_ECS_HEALTH_URL");
  const ecrRepositoryUri = getEnvString(env, "AWS_ECR_REPOSITORY_URI");
  return {
    name: "ecs",
    config: {
      region,
      clusterArn,
      taskDefinitionFamily,
      ...(serviceArn ? { serviceArn } : {}),
      ...(serviceName ? { serviceName } : {}),
      ...(containerName ? { containerName } : {}),
      ...(subnetIds ? { subnetIds } : {}),
      ...(securityGroupIds ? { securityGroupIds } : {}),
      ...(assignPublicIp !== undefined ? { assignPublicIp } : {}),
      ...(launchType ? { launchType } : {}),
      ...(desiredCount !== undefined ? { desiredCount } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(healthUrl ? { healthUrl } : {}),
      ...(ecrRepositoryUri ? { ecrRepositoryUri } : {}),
    },
  };
}

function createCloudRunConfig(
  env: EnvRecord,
): CloudRunDeployBackendConfig | null {
  const projectId = resolveGoogleCloudProject(
    env as { GOOGLE_CLOUD_PROJECT?: string; GCP_PROJECT_ID?: string },
  );
  const region = getEnvString(env, "GCP_CLOUD_RUN_REGION") ??
    getEnvString(env, "GCP_REGION");
  if (!projectId || !region) {
    return null;
  }
  const serviceId = getEnvString(env, "GCP_CLOUD_RUN_SERVICE_ID");
  const serviceAccount = getEnvString(env, "GCP_CLOUD_RUN_SERVICE_ACCOUNT");
  const ingress = getEnvString(env, "GCP_CLOUD_RUN_INGRESS");
  const allowUnauthenticated = getEnvBoolean(
    env,
    "GCP_CLOUD_RUN_ALLOW_UNAUTHENTICATED",
  );
  const baseUrl = getEnvString(env, "GCP_CLOUD_RUN_BASE_URL");
  const deleteOnRemove = getEnvBoolean(env, "GCP_CLOUD_RUN_DELETE_ON_REMOVE");
  const artifactRegistryRepo = getEnvString(env, "GCP_ARTIFACT_REGISTRY_REPO");
  return {
    name: "cloud-run",
    config: {
      projectId,
      region,
      ...(serviceId ? { serviceId } : {}),
      ...(serviceAccount ? { serviceAccount } : {}),
      ...(ingress ? { ingress } : {}),
      ...(allowUnauthenticated !== undefined ? { allowUnauthenticated } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(deleteOnRemove !== undefined ? { deleteOnRemove } : {}),
      ...(artifactRegistryRepo ? { artifactRegistryRepo } : {}),
    },
  };
}

function createK8sConfig(env: EnvRecord): K8sDeployBackendConfig | null {
  const namespace = getEnvString(env, "K8S_NAMESPACE");
  if (!namespace) {
    return null;
  }
  const deploymentName = getEnvString(env, "K8S_DEPLOYMENT_NAME");
  const imageRegistry = getEnvString(env, "K8S_IMAGE_REGISTRY");
  return {
    name: "k8s",
    config: {
      namespace,
      ...(deploymentName ? { deploymentName } : {}),
      ...(imageRegistry ? { imageRegistry } : {}),
    },
  };
}

const BACKEND_DEFAULT_ORDER: Array<PlatformDeployBackendConfig["name"]> = [
  "workers-dispatch",
  "ecs",
  "cloud-run",
  "k8s",
  "oci",
];

export function createDeploymentBackendRegistry(
  configs: PlatformDeployBackendConfig[],
  defaultName?: PlatformDeployBackendConfig["name"],
): PlatformDeployBackendRegistry | undefined {
  if (configs.length === 0) return undefined;

  const unique = new Map<
    PlatformDeployBackendConfig["name"],
    PlatformDeployBackendConfig
  >();
  for (const config of configs) {
    unique.set(config.name, config);
  }
  const entries = Array.from(unique.values());
  const firstEntry = entries[0];
  if (!firstEntry) {
    // unique is populated from configs; configs.length > 0 was checked above.
    throw new Error(
      "deployment backend registry has no entries after deduplication",
    );
  }
  const resolvedDefaultName = defaultName ??
    BACKEND_DEFAULT_ORDER.find((name) => unique.has(name)) ??
    firstEntry.name;

  return {
    defaultName: resolvedDefaultName,
    list() {
      return [...entries];
    },
    get(name: string) {
      return entries.find((entry) => entry.name === name);
    },
  };
}

export function resolveDeploymentBackendConfigsFromEnv(
  env: EnvRecord,
): PlatformDeployBackendConfig[] {
  return [
    createWorkersDispatchConfig(env),
    createEcsConfig(env),
    createCloudRunConfig(env),
    createK8sConfig(env),
    createOciConfig(env),
  ].filter((config): config is PlatformDeployBackendConfig => config != null);
}
