/**
 * Group Deploy — container deployment phase.
 *
 * Handles Step 2a (standalone containers) and Step 2a-2 (services).
 */
import type {
  GroupDeployOptions,
  GroupDeployResult,
  ManifestContainerDef,
  ManifestServiceDef,
  ProvisionedResource,
} from '../deploy-models.js';
import { deployContainerWithWrangler } from '../container.js';

// ── Step 2a: Standalone containers (CF Containers not referenced by any worker) ──

export async function deployStandaloneContainers(
  containers: Record<string, ManifestContainerDef>,
  options: GroupDeployOptions,
  result: GroupDeployResult,
  provisioned: Map<string, ProvisionedResource>,
  workerReferencedContainers: Set<string>,
  effectiveFilter: string[] | undefined,
): Promise<void> {
  for (const [containerName, container] of Object.entries(containers)) {
    if (workerReferencedContainers.has(containerName)) continue;
    if (effectiveFilter && effectiveFilter.length > 0 && !effectiveFilter.includes(containerName)) continue;

    const legacyService = {
      type: 'container' as const,
      container: {
        dockerfile: container.dockerfile,
        port: container.port || 8080,
        instanceType: container.instanceType,
        maxInstances: container.maxInstances,
      },
      env: container.env,
    };

    const deployResult = await deployContainerWithWrangler(containerName, legacyService, options, provisioned);
    result.services.push(deployResult);
  }
}

// ── Step 2a-2: Services (常設コンテナ — Docker build + deploy) ──

export async function deployServices(
  services: Record<string, ManifestServiceDef>,
  options: GroupDeployOptions,
  result: GroupDeployResult,
  provisioned: Map<string, ProvisionedResource>,
  effectiveFilter: string[] | undefined,
): Promise<void> {
  for (const [serviceName, service] of Object.entries(services)) {
    if (effectiveFilter && effectiveFilter.length > 0 && !effectiveFilter.includes(serviceName)) continue;

    const legacyService = {
      type: 'container' as const,
      container: {
        dockerfile: service.dockerfile,
        port: service.port || 3000,
        instanceType: service.instanceType,
        maxInstances: service.maxInstances,
      },
      env: service.env,
    };

    const deployResult = await deployContainerWithWrangler(serviceName, legacyService, options, provisioned);
    // Override type to 'service' for template context
    result.services.push({ ...deployResult, type: 'service' });
  }
}
