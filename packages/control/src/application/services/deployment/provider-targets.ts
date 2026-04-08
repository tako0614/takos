import type {
  ArtifactKind,
  Deployment,
  DeploymentProviderRef,
  DeploymentTarget,
  DeploymentTargetArtifact,
  DeploymentTargetEndpoint,
  DeploymentTargetReadiness,
} from "./models.ts";
import type { PersistedDeploymentContract } from "./provider-contracts.ts";

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeTargetEndpoint(
  raw: Record<string, unknown>,
): DeploymentTargetEndpoint | undefined {
  const endpoint = raw.endpoint;
  if (endpoint && typeof endpoint === "object") {
    const parsed = endpoint as Record<string, unknown>;
    if (
      parsed.kind === "service-ref" && typeof parsed.ref === "string" &&
      parsed.ref.length > 0
    ) {
      return {
        kind: "service-ref",
        ref: parsed.ref,
      };
    }
    if (
      parsed.kind === "http-url" && typeof parsed.base_url === "string" &&
      parsed.base_url.length > 0
    ) {
      return {
        kind: "http-url",
        base_url: parsed.base_url,
      };
    }
  }
  return undefined;
}

function normalizeTargetArtifact(
  raw: Record<string, unknown>,
): DeploymentTargetArtifact | undefined {
  const artifact = raw.artifact;
  if (artifact && typeof artifact === "object") {
    const parsed = artifact as Record<string, unknown>;
    const normalized: DeploymentTargetArtifact = {};
    if (parsed.kind === "worker-bundle" || parsed.kind === "container-image") {
      normalized.kind = parsed.kind as ArtifactKind;
    }
    if (typeof parsed.image_ref === "string" && parsed.image_ref.length > 0) {
      normalized.image_ref = parsed.image_ref;
    }
    if (
      typeof parsed.exposed_port === "number" &&
      Number.isFinite(parsed.exposed_port)
    ) {
      normalized.exposed_port = parsed.exposed_port;
    }
    if (
      typeof parsed.health_path === "string" && parsed.health_path.length > 0
    ) {
      normalized.health_path = parsed.health_path;
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  return undefined;
}

/**
 * Normalize the readiness probe field stored in `target_json` (Track G).
 * Only `path` is recognized; non-string / empty values are dropped.
 */
function normalizeTargetReadiness(
  raw: Record<string, unknown>,
): DeploymentTargetReadiness | undefined {
  const readiness = raw.readiness;
  if (readiness && typeof readiness === "object") {
    const parsed = readiness as Record<string, unknown>;
    if (typeof parsed.path === "string" && parsed.path.length > 0) {
      return { path: parsed.path };
    }
  }
  return undefined;
}

function normalizeDeploymentTarget(
  raw: Record<string, unknown>,
): DeploymentTarget {
  const endpoint = normalizeTargetEndpoint(raw);
  const routeRef = typeof raw.route_ref === "string" && raw.route_ref.length > 0
    ? raw.route_ref
    : endpoint?.kind === "service-ref"
    ? endpoint.ref
    : undefined;
  const artifact = normalizeTargetArtifact(raw);
  const readiness = normalizeTargetReadiness(raw);

  return {
    ...(routeRef ? { route_ref: routeRef } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(artifact ? { artifact } : {}),
    ...(readiness ? { readiness } : {}),
  };
}

export function targetContainsContainerImage(
  target: DeploymentTarget,
): boolean {
  return target.artifact?.kind === "container-image" &&
    typeof target.artifact.image_ref === "string" &&
    target.artifact.image_ref.trim().length > 0;
}

export function parseDeploymentTargetConfig(
  deployment: PersistedDeploymentContract,
): DeploymentTarget {
  const parsed = safeJsonParse<Record<string, unknown>>(
    deployment.target_json,
    {},
  );
  return normalizeDeploymentTarget(parsed);
}

export function serializeDeploymentTarget(options?: {
  provider?: DeploymentProviderRef;
  target?: DeploymentTarget;
}): {
  providerName: Deployment["provider_name"];
  targetJson: string;
  providerStateJson: string;
} {
  const target = options?.target;
  const raw: Record<string, unknown> = {};
  if (target?.route_ref) raw.route_ref = target.route_ref;
  if (target?.endpoint) raw.endpoint = target.endpoint;
  if (target?.artifact) {
    const artifactRaw: Record<string, unknown> = {};
    if (target.artifact.kind) artifactRaw.kind = target.artifact.kind;
    if (target.artifact.image_ref) {
      artifactRaw.image_ref = target.artifact.image_ref;
    }
    if (target.artifact.exposed_port != null) {
      artifactRaw.exposed_port = target.artifact.exposed_port;
    }
    if (target.artifact.health_path) {
      artifactRaw.health_path = target.artifact.health_path;
    }
    if (Object.keys(artifactRaw).length > 0) raw.artifact = artifactRaw;
  }
  // Worker readiness probe path (Track G).
  if (
    target?.readiness && typeof target.readiness.path === "string" &&
    target.readiness.path.length > 0
  ) {
    raw.readiness = { path: target.readiness.path };
  }

  const normalized = normalizeDeploymentTarget(raw);
  return {
    providerName: options?.provider?.name ?? "workers-dispatch",
    targetJson: JSON.stringify(normalized),
    providerStateJson: "{}",
  };
}
