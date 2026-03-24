import { getDb } from '../../../infra/db';
import { resources } from '../../../infra/db/schema';
import { services, serviceBindings } from '../../../infra/db/schema-services';
import { eq, inArray } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { logError, logWarn } from '../../../shared/utils/logger';
import { CloudflareResourceService } from '../../../platform/providers/cloudflare/resources.ts';
import { WFPService } from '../../../platform/providers/cloudflare/wfp.ts';
import { deleteHostnameRouting } from '../routing';
import type { ResourceProvisionResult, WorkerDeploymentResult } from './types';

export class CompensationTracker {
  private steps: Array<{ description: string; compensate: () => Promise<void> }> = [];

  add(description: string, compensate: () => Promise<void>): void {
    this.steps.push({ description, compensate });
  }

  async rollback(): Promise<void> {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      try {
        await this.steps[i].compensate();
      } catch (error) {
        logError(`Compensation failed for "${this.steps[i].description}"`, error, {
          action: 'compensation_rollback',
          step: this.steps[i].description,
        });
      }
    }
  }
}

export async function bestEffort(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
  } catch (e) {
    logWarn(`[BEST_EFFORT] ${label}`, {
      action: 'best_effort_cleanup',
      step: label,
      errorValue: e instanceof Error ? e.message : String(e),
      errorStack: e instanceof Error ? e.stack : undefined,
    });
  }
}

export async function deleteCfResource(
  provider: CloudflareResourceService,
  type: string,
  cfId?: string,
  cfName?: string
): Promise<void> {
  await provider.deleteResource({ type, cfId, cfName });
}

export async function cleanupProvisionedResources(
  env: Env,
  resourcesResult: ResourceProvisionResult
): Promise<void> {
  const provider = new CloudflareResourceService(env);
  const db = getDb(env.DB);

  const allResources = [
    ...resourcesResult.d1.map(r => ({ type: 'd1' as const, cfId: r.id, cfName: r.name, resourceId: r.resourceId, wasAdopted: r.wasAdopted })),
    ...resourcesResult.r2.map(r => ({ type: 'r2' as const, cfId: undefined, cfName: r.name, resourceId: r.resourceId, wasAdopted: r.wasAdopted })),
    ...resourcesResult.kv.map(r => ({ type: 'kv' as const, cfId: r.id, cfName: r.name, resourceId: r.resourceId, wasAdopted: r.wasAdopted })),
  ];

  for (const resource of allResources) {
    if (resource.wasAdopted) {
      // Adopted resources must not be deleted on compensation — they existed before this deployment
      continue;
    }
    await bestEffort(() => deleteCfResource(provider, resource.type, resource.cfId, resource.cfName),
      `Failed to cleanup CF resource ${resource.resourceId} (${resource.type})`);
    await bestEffort(() => db.delete(resources).where(eq(resources.id, resource.resourceId)),
      `Failed to cleanup resource record ${resource.resourceId}`);
  }
}

export async function cleanupDeployedWorkers(
  env: Env,
  deployedWorkers: WorkerDeploymentResult[]
): Promise<void> {
  const wfp = new WFPService(env);
  const db = getDb(env.DB);

  for (const worker of deployedWorkers) {
    await bestEffort(
      () => deleteHostnameRouting({ env, hostname: worker.hostname.toLowerCase() }),
      `Failed to cleanup hostname routing for ${worker.hostname}`);
    await bestEffort(
      () => wfp.deleteWorker(worker.artifactRef),
      `Failed to cleanup WFP worker artifact ${worker.artifactRef}`);
    await bestEffort(
      () => wfp.deleteWorker(worker.workerName),
      `Failed to cleanup legacy WFP worker ${worker.workerName}`);
    await bestEffort(
      () => db.delete(serviceBindings).where(eq(serviceBindings.serviceId, worker.workerId)),
      `Failed to cleanup worker bindings for ${worker.workerId}`);
    await bestEffort(
      () => db.delete(services).where(eq(services.id, worker.workerId)),
      `Failed to cleanup worker record ${worker.workerId}`);
  }
}
