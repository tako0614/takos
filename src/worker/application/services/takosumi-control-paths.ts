const TAKOSUMI_SESSION_API_PREFIX = "/api/v1";

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function takosumiWorkspaceCapsulesPath(workspaceId: string): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/workspaces/${segment(workspaceId)}/capsules`;
}

export function takosumiWorkspaceInstallPlansPath(workspaceId: string): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/workspaces/${segment(workspaceId)}/install-plans`;
}

export function takosumiInstallPlanPath(installPlanId: string): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/install-plans/${segment(installPlanId)}`;
}

export function takosumiInstallPlanReconcilePath(installPlanId: string): string {
  return `${takosumiInstallPlanPath(installPlanId)}/reconcile`;
}

export function takosumiWorkspaceUiSurfacesPath(workspaceId: string): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/workspaces/${segment(workspaceId)}/ui-surfaces`;
}

export function takosumiCapsulePath(capsuleId: string): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/capsules/${segment(capsuleId)}`;
}

export function takosumiCapsuleDestroyPlanPath(capsuleId: string): string {
  return `${takosumiCapsulePath(capsuleId)}/destroy-plan`;
}

export function takosumiCapsuleRevisionPlansPath(capsuleId: string): string {
  return `${takosumiCapsulePath(capsuleId)}/revision-plans`;
}

export function takosumiRevisionPlanPath(revisionPlanId: string): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/revision-plans/${segment(revisionPlanId)}`;
}

export function takosumiRevisionPlanReconcilePath(
  revisionPlanId: string,
): string {
  return `${takosumiRevisionPlanPath(revisionPlanId)}/reconcile`;
}

export function takosumiCapsuleOutputsPath(capsuleId: string): string {
  return `${takosumiCapsulePath(capsuleId)}/outputs`;
}

export function takosumiRunApplyPath(runId: string): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/runs/${segment(runId)}/apply`;
}

export function takosumiRunApprovePath(runId: string): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/runs/${segment(runId)}/approve`;
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

export function takosumiStateVersionRollbackPlanPath(
  stateVersionId: string,
): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/state-versions/${segment(stateVersionId)}/rollback-plan`;
}

export function takosumiInterfacesPath(): string {
  return `${TAKOSUMI_SESSION_API_PREFIX}/interfaces`;
}

export function takosumiInterfaceBindingsPath(interfaceId: string): string {
  return `${takosumiInterfacesPath()}/${segment(interfaceId)}/bindings`;
}

export function takosumiInterfaceTokenPath(interfaceId: string): string {
  return `${takosumiInterfacesPath()}/${segment(interfaceId)}/token`;
}

export function takosumiSessionApiUrl(baseUrl: string, path: string): URL {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const canonicalPrefix = "/api/v1";
  url.pathname = basePath.endsWith(normalizedPath)
    ? basePath
    : basePath.endsWith(canonicalPrefix) &&
        normalizedPath.startsWith(`${canonicalPrefix}/`)
      ? `${basePath}${normalizedPath.slice(canonicalPrefix.length)}`
      : `${basePath}${normalizedPath}`;
  url.search = "";
  url.hash = "";
  return url;
}
