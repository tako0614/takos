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

export function resolveDefaultDeploymentBackendName(
  env: DeploymentEnv,
  artifactKind: ArtifactKind,
): DeploymentBackendName {
  if (artifactKind === "worker-bundle") {
    return hasWorkersDispatchEnv(env) ? "workers-dispatch" : "runtime-host";
  }

  // Container-image workloads are realized through the OCI orchestrator.
  return "oci";
}

export function resolveDefaultDeploymentBackendRef(
  env: DeploymentEnv,
  artifactKind: ArtifactKind,
): DeploymentBackendRef {
  return { name: resolveDefaultDeploymentBackendName(env, artifactKind) };
}
