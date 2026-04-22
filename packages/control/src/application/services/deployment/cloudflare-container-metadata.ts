import type { WorkerBinding } from "../../../platform/backends/cloudflare/wfp.ts";
import type {
  AppCompute,
  CloudflareContainerConfig,
} from "../source/app-manifest-types.ts";
import type {
  DeploymentTargetCloudflareContainer,
  DeploymentTargetCloudflareMetadata,
  DeploymentTargetCloudflareMigration,
} from "./models.ts";
import { attachedContainerBindingName } from "./attached-container-bindings.ts";

type AppWorker = AppCompute & { kind: "worker" };
type AppContainer = AppCompute & { kind: "attached-container" };

export function isNativeCloudflareContainer(
  compute: AppCompute | undefined,
): compute is AppContainer & {
  cloudflare: { container: CloudflareContainerConfig };
} {
  return compute?.kind === "attached-container" &&
    !!compute.cloudflare?.container;
}

function resolveNativeContainerBindingName(
  childName: string,
  config: CloudflareContainerConfig,
): string {
  return config.binding ?? attachedContainerBindingName(childName);
}

export function buildNativeCloudflareContainerBindings(
  workerSpec: AppWorker,
): WorkerBinding[] {
  const bindings: WorkerBinding[] = [];
  for (
    const [childName, child] of Object.entries(workerSpec.containers ?? {})
  ) {
    if (!isNativeCloudflareContainer(child)) continue;
    const container = child.cloudflare.container;
    bindings.push({
      type: "durable_object_namespace",
      name: resolveNativeContainerBindingName(childName, container),
      class_name: container.className,
    });
  }
  return bindings;
}

function buildContainerMetadata(
  spec: AppContainer,
): DeploymentTargetCloudflareContainer | null {
  const container = spec.cloudflare?.container;
  if (!container || !spec.image) return null;
  return {
    class_name: container.className,
    image: spec.image,
    ...(container.instanceType
      ? { instance_type: container.instanceType }
      : {}),
    ...(container.maxInstances != null
      ? { max_instances: container.maxInstances }
      : {}),
    ...(container.name ? { name: container.name } : {}),
    ...(container.imageBuildContext
      ? { image_build_context: container.imageBuildContext }
      : {}),
    ...(container.imageVars ? { image_vars: container.imageVars } : {}),
    ...(container.rolloutActiveGracePeriod != null
      ? { rollout_active_grace_period: container.rolloutActiveGracePeriod }
      : {}),
    ...(container.rolloutStepPercentage != null
      ? { rollout_step_percentage: container.rolloutStepPercentage }
      : {}),
  };
}

function addMigrationClass(
  byTag: Map<string, DeploymentTargetCloudflareMigration>,
  config: CloudflareContainerConfig,
): void {
  const tag = config.migrationTag?.trim() || "v1";
  const migration = byTag.get(tag) ?? { tag };
  const field = config.sqlite === false ? "new_classes" : "new_sqlite_classes";
  const list = migration[field] ?? [];
  if (!list.includes(config.className)) list.push(config.className);
  migration[field] = list;
  byTag.set(tag, migration);
}

export function buildNativeCloudflareWorkerMetadata(
  workerSpec: AppWorker,
): DeploymentTargetCloudflareMetadata | undefined {
  const containers: DeploymentTargetCloudflareContainer[] = [];
  const migrationsByTag = new Map<
    string,
    DeploymentTargetCloudflareMigration
  >();

  for (const child of Object.values(workerSpec.containers ?? {})) {
    if (!isNativeCloudflareContainer(child)) continue;
    const metadata = buildContainerMetadata(child);
    if (metadata) containers.push(metadata);
    addMigrationClass(migrationsByTag, child.cloudflare.container);
  }

  const migrations = Array.from(migrationsByTag.values());
  const result: DeploymentTargetCloudflareMetadata = {
    ...(containers.length > 0 ? { containers } : {}),
    ...(migrations.length > 0 ? { migrations } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

export function mergeNativeCloudflareContainerBindings(input: {
  existing: WorkerBinding[];
  nativeBindings: WorkerBinding[];
}): WorkerBinding[] {
  if (input.nativeBindings.length === 0) return input.existing;
  const existingNames = new Set(input.existing.map((binding) => binding.name));
  for (const binding of input.nativeBindings) {
    if (existingNames.has(binding.name)) {
      throw new Error(
        `Cloudflare container binding '${binding.name}' conflicts with an existing worker binding`,
      );
    }
    existingNames.add(binding.name);
  }
  return [...input.existing, ...input.nativeBindings];
}
