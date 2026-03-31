/**
 * Group Deploy — worker deployment phase.
 *
 * Handles Step 2b: deploying workers (with referenced containers included in
 * wrangler config).
 */
import type {
  ContainerWranglerConfig,
  GroupDeployOptions,
  GroupDeployResult,
  ManifestContainerDef,
  ManifestWorkerDef,
  ProvisionedResource,
  WranglerConfig,
  WorkerContainerSpec,
  WorkerServiceDef,
} from '../deploy-models.ts';
import { generateWranglerConfig, serializeWranglerToml } from '../wrangler-config.ts';
import { serializeContainerWranglerToml } from '../container.ts';
import { deployWorkerWithWrangler } from '../deploy-worker.ts';
import { collectWorkerBindingResults } from '../bindings.ts';

interface WorkerPhaseContext {
  groupName: string;
  env: string;
  namespace?: string;
  accountId: string;
  apiToken: string;
  dryRun: boolean;
  compatibilityDate?: string;
}

export async function deployWorkers(
  workers: Record<string, ManifestWorkerDef>,
  containers: Record<string, ManifestContainerDef>,
  options: GroupDeployOptions,
  result: GroupDeployResult,
  provisioned: Map<string, ProvisionedResource>,
  effectiveFilter: string[] | undefined,
  ctx: WorkerPhaseContext,
): Promise<void> {
  const { groupName, env, namespace, accountId, apiToken, dryRun, compatibilityDate } = ctx;

  for (const [workerName, worker] of Object.entries(workers)) {
    if (effectiveFilter && effectiveFilter.length > 0 && !effectiveFilter.includes(workerName)) continue;

    try {
      const resolvedContainers: WorkerContainerSpec[] = (worker.containers || []).map((cRef) => {
        const cDef = containers[cRef];
        if (!cDef) {
          throw new Error(`Worker '${workerName}' references unknown container '${cRef}'`);
        }
        return {
          name: cRef,
          dockerfile: cDef.dockerfile,
          port: cDef.port || 8080,
          instanceType: cDef.instanceType,
          maxInstances: cDef.maxInstances,
        };
      });

      const legacyService = {
        type: 'worker' as const,
        build: worker.build,
        env: worker.env,
        bindings: worker.bindings,
        containers: resolvedContainers.length > 0 ? resolvedContainers : undefined,
      };

      const wranglerConfig = generateWranglerConfig(
        legacyService as WorkerServiceDef,
        workerName,
        { groupName, env, namespace, resources: provisioned, compatibilityDate, manifestDir: options.manifestDir },
      );

      if (dryRun) {
        const dryRunInfo = resolvedContainers.length > 0
          ? ` (with ${resolvedContainers.length} CF container(s): ${resolvedContainers.map(c => c.name).join(', ')})`
          : '';
        result.services.push({
          name: workerName,
          type: 'worker',
          status: 'deployed',
          scriptName: wranglerConfig.name,
          ...(dryRunInfo ? { error: `[dry-run] would deploy worker${dryRunInfo}` } : {}),
        });
        result.bindings.push(...collectWorkerBindingResults(workerName, worker, 'bound'));
        continue;
      }

      const serviceSecrets = new Map<string, string>();
      for (const [, resource] of provisioned) {
        if (resource.type === 'secretRef') {
          serviceSecrets.set(resource.binding, resource.id);
        }
      }

      const isContainerConfig = 'containers' in wranglerConfig && Array.isArray((wranglerConfig as ContainerWranglerConfig).containers);
      const toml = isContainerConfig
        ? serializeContainerWranglerToml(wranglerConfig as ContainerWranglerConfig)
        : serializeWranglerToml(wranglerConfig as WranglerConfig);

      const wranglerResult = await deployWorkerWithWrangler(toml, {
        accountId,
        apiToken,
        secrets: serviceSecrets.size > 0 ? serviceSecrets : undefined,
        scriptName: wranglerConfig.name,
      });

      if (wranglerResult.success) {
        result.services.push({ name: workerName, type: 'worker', status: 'deployed', scriptName: wranglerConfig.name });
        result.bindings.push(...collectWorkerBindingResults(workerName, worker, 'bound'));
      } else {
        result.services.push({ name: workerName, type: 'worker', status: 'failed', scriptName: wranglerConfig.name, error: wranglerResult.error });
        result.bindings.push(...collectWorkerBindingResults(workerName, worker, 'failed'));
      }
    } catch (error) {
      result.services.push({
        name: workerName,
        type: 'worker',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
