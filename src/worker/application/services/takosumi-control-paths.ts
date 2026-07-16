const TAKOSUMI_SESSION_API_PREFIX = "/api/v1";

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function takosumiWorkspaceCapsulesPath(workspaceId: string): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/workspaces/${segment(workspaceId)}/capsules`;
}

export function takosumiCapsulePath(capsuleId: string): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/capsules/${segment(capsuleId)}`;
}

export function takosumiCapsulePlanPath(capsuleId: string): string {
  return `${takosumiCapsulePath(capsuleId)}/plan`;
}

export function takosumiCapsuleDestroyPlanPath(capsuleId: string): string {
  return `${takosumiCapsulePath(capsuleId)}/destroy-plan`;
}

export function takosumiCapsuleOutputsPath(capsuleId: string): string {
  return `${takosumiCapsulePath(capsuleId)}/outputs`;
}

export function takosumiRunApplyPath(runId: string): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/runs/${segment(runId)}/apply`;
}

export function takosumiRunPath(runId: string): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/runs/${segment(runId)}`;
}

export function takosumiSourcesPath(): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/sources`;
}

export function takosumiSourcePath(sourceId: string): string {
  return `${takosumiSourcesPath()}/${segment(sourceId)}`;
}

export function takosumiSourceSyncPath(sourceId: string): string {
  return `${takosumiSourcePath(sourceId)}/sync`;
}

export function takosumiStateVersionRollbackPlanPath(
  stateVersionId: string,
): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/state-versions/${segment(stateVersionId)}/rollback-plan`;
}

export function takosumiInterfacesPath(): string {
  return "/v1/interfaces";
}

export function takosumiSessionApiUrl(baseUrl: string, path: string): URL {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  url.pathname = `${basePath}${normalizedPath}`;
  url.search = "";
  url.hash = "";
  return url;
}
