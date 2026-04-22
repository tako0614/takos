import type {
  ArtifactKind,
  DeploymentBackendName,
  DeploymentBackendRef,
  DeploymentEnv,
} from "./models.ts";

function hasText(value: string | undefined): boolean {
  return !!value?.trim();
}

function hasWorkersDispatchEnv(env: DeploymentEnv): boolean {
  return hasText(env.CF_ACCOUNT_ID) && hasText(env.CF_API_TOKEN) &&
    hasText(env.WFP_DISPATCH_NAMESPACE);
}

function hasEcsEnv(env: DeploymentEnv): boolean {
  return hasText(env.AWS_ECS_CLUSTER_ARN) &&
    hasText(env.AWS_ECS_TASK_DEFINITION_FAMILY) &&
    (hasText(env.AWS_ECS_REGION) || hasText(env.AWS_REGION));
}

function hasCloudRunEnv(env: DeploymentEnv): boolean {
  return hasText(env.GCP_PROJECT_ID) &&
    (hasText(env.GCP_CLOUD_RUN_REGION) || hasText(env.GCP_REGION));
}

function hasK8sEnv(env: DeploymentEnv): boolean {
  return hasText(env.K8S_NAMESPACE);
}

export function resolveDefaultDeploymentBackendName(
  env: DeploymentEnv,
  artifactKind: ArtifactKind,
): DeploymentBackendName {
  if (artifactKind === "worker-bundle") {
    return hasWorkersDispatchEnv(env) ? "workers-dispatch" : "runtime-host";
  }

  if (hasEcsEnv(env)) return "ecs";
  if (hasCloudRunEnv(env)) return "cloud-run";
  if (hasK8sEnv(env)) return "k8s";
  return "oci";
}

export function resolveDefaultDeploymentBackendRef(
  env: DeploymentEnv,
  artifactKind: ArtifactKind,
): DeploymentBackendRef {
  return { name: resolveDefaultDeploymentBackendName(env, artifactKind) };
}
