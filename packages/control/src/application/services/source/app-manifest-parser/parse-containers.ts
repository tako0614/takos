import type {
  AppContainer,
  HealthCheck,
  Volume,
} from '../app-manifest-types.ts';
import {
  asRecord,
  asRequiredString,
  asString,
  asStringArray,
  asStringMap,
  normalizeRepoPath,
} from '../app-manifest-utils.ts';

type ContainerProvider = 'oci' | 'ecs' | 'cloud-run' | 'k8s';

function parseContainerProvider(value: unknown): ContainerProvider | undefined {
  return value === 'oci' || value === 'ecs' || value === 'cloud-run' || value === 'k8s'
    ? value
    : undefined;
}

// ============================================================
// Health check parser
// ============================================================

export function parseHealthCheck(raw: unknown, prefix: string): HealthCheck | undefined {
  if (!raw) return undefined;
  const record = asRecord(raw);
  const type = asString(record.type, `${prefix}.healthCheck.type`);
  if (type && !['http', 'tcp', 'exec'].includes(type)) {
    throw new Error(`${prefix}.healthCheck.type must be http, tcp, or exec`);
  }
  return {
    ...(type ? { type: type as 'http' | 'tcp' | 'exec' } : {}),
    ...(record.path ? { path: String(record.path) } : {}),
    ...(record.port != null ? { port: Number(record.port) } : {}),
    ...(record.command ? { command: String(record.command) } : {}),
    ...(record.intervalSeconds != null ? { intervalSeconds: Number(record.intervalSeconds) } : {}),
    ...(record.timeoutSeconds != null ? { timeoutSeconds: Number(record.timeoutSeconds) } : {}),
    ...(record.unhealthyThreshold != null ? { unhealthyThreshold: Number(record.unhealthyThreshold) } : {}),
  };
}

// ============================================================
// Volume parser
// ============================================================

export function parseVolumes(raw: unknown, prefix: string): Volume[] | undefined {
  if (!raw || !Array.isArray(raw)) return undefined;
  return raw.map((entry, i) => {
    const v = asRecord(entry);
    return {
      name: asRequiredString(v.name, `${prefix}.volumes[${i}].name`),
      mountPath: asRequiredString(v.mountPath, `${prefix}.volumes[${i}].mountPath`),
      size: asRequiredString(v.size, `${prefix}.volumes[${i}].size`),
    };
  });
}

// ============================================================
// Containers parser
// ============================================================

export function parseContainers(specRecord: Record<string, unknown>): Record<string, AppContainer> {
  const containersRecord = asRecord(specRecord.containers);
  const containers: Record<string, AppContainer> = {};
  for (const [name, value] of Object.entries(containersRecord)) {
    const c = asRecord(value);
    const port = Number(c.port);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(`spec.containers.${name}.port must be a positive number`);
    }
    const containerVolumes = parseVolumes(c.volumes, `spec.containers.${name}`);
    const containerDependsOn = asStringArray(c.dependsOn, `spec.containers.${name}.dependsOn`);
    const dockerfile = asString(c.dockerfile, `spec.containers.${name}.dockerfile`);
    const imageRef = asString(c.imageRef, `spec.containers.${name}.imageRef`);
    const artifactRecord = asRecord(c.artifact);
    const artifactKind = asString(artifactRecord.kind, `spec.containers.${name}.artifact.kind`);
    const artifact = artifactKind === 'image'
      ? {
          kind: 'image' as const,
          imageRef: asRequiredString(artifactRecord.imageRef, `spec.containers.${name}.artifact.imageRef`),
          ...(parseContainerProvider(artifactRecord.provider) ? { provider: parseContainerProvider(artifactRecord.provider) }
            : {}),
        }
      : undefined;
    if (!dockerfile && !imageRef && !artifact) {
      throw new Error(`spec.containers.${name} must define dockerfile, imageRef, or artifact.kind=image`);
    }

    containers[name] = {
      port,
      ...(dockerfile ? { dockerfile: normalizeRepoPath(dockerfile) } : {}),
      ...(imageRef ? { imageRef } : {}),
      ...(artifact ? { artifact } : {}),
      ...(parseContainerProvider(c.provider)
        ? { provider: parseContainerProvider(c.provider) }
        : {}),
      ...(c.instanceType ? { instanceType: String(c.instanceType) } : {}),
      ...(c.maxInstances ? { maxInstances: Number(c.maxInstances) } : {}),
      ...(((): { env?: Record<string, string> } => { const v = asStringMap(c.env, `spec.containers.${name}.env`); return v ? { env: v } : {}; })()),
      ...(containerVolumes ? { volumes: containerVolumes } : {}),
      ...(containerDependsOn ? { dependsOn: containerDependsOn } : {}),
    };
  }
  return containers;
}
