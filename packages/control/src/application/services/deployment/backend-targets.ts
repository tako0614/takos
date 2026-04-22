import type {
  ArtifactKind,
  Deployment,
  DeploymentBackendRef,
  DeploymentTarget,
  DeploymentTargetArtifact,
  DeploymentTargetCloudflareContainer,
  DeploymentTargetCloudflareMetadata,
  DeploymentTargetCloudflareMigration,
  DeploymentTargetEndpoint,
  DeploymentTargetQueueConsumer,
  DeploymentTargetReadiness,
} from "./models.ts";
import { normalizeDeploymentBackendName } from "./models.ts";
import type { PersistedDeploymentBackendContract } from "./backend-contracts.ts";
import { BadRequestError } from "takos-common/errors";

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
    if (
      typeof parsed.health_interval === "number" &&
      Number.isFinite(parsed.health_interval)
    ) {
      normalized.health_interval = parsed.health_interval;
    }
    if (
      typeof parsed.health_timeout === "number" &&
      Number.isFinite(parsed.health_timeout)
    ) {
      normalized.health_timeout = parsed.health_timeout;
    }
    if (
      typeof parsed.health_unhealthy_threshold === "number" &&
      Number.isFinite(parsed.health_unhealthy_threshold)
    ) {
      normalized.health_unhealthy_threshold = parsed.health_unhealthy_threshold;
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

function normalizeFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : undefined;
}

function normalizeQueueConsumer(
  raw: unknown,
): DeploymentTargetQueueConsumer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const parsed = raw as Record<string, unknown>;
  const binding =
    typeof parsed.binding === "string" && parsed.binding.length > 0
      ? parsed.binding
      : undefined;
  const queue = typeof parsed.queue === "string" && parsed.queue.length > 0
    ? parsed.queue
    : undefined;
  if (!binding && !queue) return null;
  const settingsRaw = parsed.settings && typeof parsed.settings === "object" &&
      !Array.isArray(parsed.settings)
    ? parsed.settings as Record<string, unknown>
    : {};
  const settings = {
    batch_size: normalizeFiniteNumber(settingsRaw.batch_size),
    max_concurrency: normalizeFiniteNumber(settingsRaw.max_concurrency),
    max_retries: normalizeFiniteNumber(settingsRaw.max_retries),
    max_wait_time_ms: normalizeFiniteNumber(settingsRaw.max_wait_time_ms),
    retry_delay: normalizeFiniteNumber(settingsRaw.retry_delay),
  };
  const filteredSettings = Object.fromEntries(
    Object.entries(settings).filter(([, value]) => value != null),
  ) as DeploymentTargetQueueConsumer["settings"];
  const deadLetterQueue = typeof parsed.dead_letter_queue === "string" &&
      parsed.dead_letter_queue.length > 0
    ? parsed.dead_letter_queue
    : undefined;
  return {
    ...(binding ? { binding } : {}),
    ...(queue ? { queue } : {}),
    ...(deadLetterQueue ? { dead_letter_queue: deadLetterQueue } : {}),
    ...(filteredSettings && Object.keys(filteredSettings).length > 0
      ? { settings: filteredSettings }
      : {}),
  };
}

function normalizeQueueConsumers(
  raw: Record<string, unknown>,
): DeploymentTargetQueueConsumer[] | undefined {
  if (!Array.isArray(raw.queue_consumers)) return undefined;
  const consumers = raw.queue_consumers
    .map((entry) => normalizeQueueConsumer(entry))
    .filter((entry): entry is DeploymentTargetQueueConsumer => entry !== null);
  return consumers.length > 0 ? consumers : undefined;
}

function normalizeStringRecord(
  value: unknown,
): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .filter((entry): entry is string =>
      typeof entry === "string" && entry.length > 0
    );
  return result.length > 0 ? result : undefined;
}

function normalizeCloudflareContainer(
  raw: unknown,
): DeploymentTargetCloudflareContainer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const parsed = raw as Record<string, unknown>;
  if (
    typeof parsed.class_name !== "string" || parsed.class_name.length === 0 ||
    typeof parsed.image !== "string" || parsed.image.length === 0
  ) {
    return null;
  }
  const maxInstances = normalizeFiniteNumber(parsed.max_instances);
  const rolloutActiveGracePeriod = normalizeFiniteNumber(
    parsed.rollout_active_grace_period,
  );
  const rolloutStepPercentage = Array.isArray(parsed.rollout_step_percentage)
    ? parsed.rollout_step_percentage
      .map((entry) => normalizeFiniteNumber(entry))
      .filter((entry): entry is number => entry != null)
    : normalizeFiniteNumber(parsed.rollout_step_percentage);
  const hasRolloutStepPercentage = Array.isArray(rolloutStepPercentage)
    ? rolloutStepPercentage.length > 0
    : rolloutStepPercentage != null;
  const imageVars = normalizeStringRecord(parsed.image_vars);
  return {
    class_name: parsed.class_name,
    image: parsed.image,
    ...(typeof parsed.instance_type === "string"
      ? { instance_type: parsed.instance_type }
      : {}),
    ...(maxInstances != null ? { max_instances: maxInstances } : {}),
    ...(typeof parsed.name === "string" && parsed.name.length > 0
      ? { name: parsed.name }
      : {}),
    ...(typeof parsed.image_build_context === "string" &&
        parsed.image_build_context.length > 0
      ? { image_build_context: parsed.image_build_context }
      : {}),
    ...(imageVars ? { image_vars: imageVars } : {}),
    ...(rolloutActiveGracePeriod != null
      ? { rollout_active_grace_period: rolloutActiveGracePeriod }
      : {}),
    ...(hasRolloutStepPercentage
      ? { rollout_step_percentage: rolloutStepPercentage }
      : {}),
  };
}

function normalizeCloudflareMigration(
  raw: unknown,
): DeploymentTargetCloudflareMigration | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const parsed = raw as Record<string, unknown>;
  if (typeof parsed.tag !== "string" || parsed.tag.length === 0) return null;
  const newClasses = normalizeStringArray(parsed.new_classes);
  const newSqliteClasses = normalizeStringArray(parsed.new_sqlite_classes);
  return {
    tag: parsed.tag,
    ...(newClasses ? { new_classes: newClasses } : {}),
    ...(newSqliteClasses ? { new_sqlite_classes: newSqliteClasses } : {}),
  };
}

function normalizeCloudflareMetadata(
  raw: Record<string, unknown>,
): DeploymentTargetCloudflareMetadata | undefined {
  const cloudflare = raw.cloudflare;
  if (
    !cloudflare || typeof cloudflare !== "object" ||
    Array.isArray(cloudflare)
  ) {
    return undefined;
  }
  const parsed = cloudflare as Record<string, unknown>;
  const containers = Array.isArray(parsed.containers)
    ? parsed.containers
      .map((entry) => normalizeCloudflareContainer(entry))
      .filter((entry): entry is DeploymentTargetCloudflareContainer =>
        entry !== null
      )
    : [];
  const migrations = Array.isArray(parsed.migrations)
    ? parsed.migrations
      .map((entry) => normalizeCloudflareMigration(entry))
      .filter((entry): entry is DeploymentTargetCloudflareMigration =>
        entry !== null
      )
    : [];
  const normalized: DeploymentTargetCloudflareMetadata = {
    ...(containers.length > 0 ? { containers } : {}),
    ...(migrations.length > 0 ? { migrations } : {}),
  };
  return Object.keys(normalized).length > 0 ? normalized : undefined;
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
  const queueConsumers = normalizeQueueConsumers(raw);
  const cloudflare = normalizeCloudflareMetadata(raw);

  return {
    ...(routeRef ? { route_ref: routeRef } : {}),
    ...(endpoint ? { endpoint } : {}),
    ...(artifact ? { artifact } : {}),
    ...(readiness ? { readiness } : {}),
    ...(queueConsumers ? { queue_consumers: queueConsumers } : {}),
    ...(cloudflare ? { cloudflare } : {}),
  };
}

export function targetContainsContainerImage(
  target: DeploymentTarget,
): boolean {
  return target.artifact?.kind === "container-image" &&
    typeof target.artifact.image_ref === "string" &&
    target.artifact.image_ref.trim().length > 0;
}

export function parseDeploymentBackendConfig(
  deployment: PersistedDeploymentBackendContract,
): DeploymentTarget {
  const parsed = safeJsonParse<Record<string, unknown>>(
    deployment.target_json,
    {},
  );
  return normalizeDeploymentTarget(parsed);
}

export function serializeDeploymentBackendTarget(options?: {
  backend?: DeploymentBackendRef;
  target?: DeploymentTarget;
}): {
  backendName: Deployment["backend_name"];
  targetJson: string;
  backendStateJson: string;
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
    if (target.artifact.health_interval != null) {
      artifactRaw.health_interval = target.artifact.health_interval;
    }
    if (target.artifact.health_timeout != null) {
      artifactRaw.health_timeout = target.artifact.health_timeout;
    }
    if (target.artifact.health_unhealthy_threshold != null) {
      artifactRaw.health_unhealthy_threshold =
        target.artifact.health_unhealthy_threshold;
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
  if (target?.queue_consumers?.length) {
    raw.queue_consumers = target.queue_consumers;
  }
  if (target?.cloudflare) {
    raw.cloudflare = target.cloudflare;
  }

  const requestedBackendName = options?.backend?.name;
  const backendName = requestedBackendName == null
    ? "workers-dispatch"
    : normalizeDeploymentBackendName(requestedBackendName);
  if (!backendName) {
    throw new BadRequestError(
      `Unsupported deployment backend: ${requestedBackendName}`,
    );
  }

  const normalized = normalizeDeploymentTarget(raw);
  return {
    backendName,
    targetJson: JSON.stringify(normalized),
    backendStateJson: "{}",
  };
}
