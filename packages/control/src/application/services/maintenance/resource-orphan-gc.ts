import type { Env } from '../../../shared/types';
import { getDb } from '../../../infra/db';
import { resources } from '../../../infra/db/schema';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { CloudflareResourceService } from '../../../platform/providers/cloudflare/resources.ts';
import { logError, logWarn } from '../../../shared/utils/logger';

export interface ResourceOrphanGcSummary {
  deleted: number;
  failed: number;
  cutoffTime: string;
  gracePeriodDays: number;
}

/**
 * Garbage-collect orphaned app deployment resources.
 * Resources are marked as orphaned (orphaned_at set) when removed from a manifest during update.
 * After the grace period, this job permanently deletes the Cloudflare resource and DB record.
 */
export async function gcOrphanedResources(
  env: Pick<Env, 'DB' | 'CF_ACCOUNT_ID' | 'CF_API_TOKEN' | 'WFP_DISPATCH_NAMESPACE'>,
  options?: { gracePeriodDays?: number }
): Promise<ResourceOrphanGcSummary> {
  const gracePeriodDays = options?.gracePeriodDays ?? 7;
  const gracePeriodMs = gracePeriodDays * 24 * 60 * 60 * 1000;
  const cutoffTime = new Date(Date.now() - gracePeriodMs).toISOString();

  const db = getDb(env.DB);
  const provider = new CloudflareResourceService(env);

  const orphaned = await db.select({
    id: resources.id,
    type: resources.type,
    cfId: resources.cfId,
    cfName: resources.cfName,
  }).from(resources).where(
    and(
      isNotNull(resources.orphanedAt),
      lt(resources.orphanedAt, cutoffTime),
    )
  ).all();

  let deleted = 0;
  let failed = 0;

  for (const resource of orphaned) {
    try {
      await provider.deleteResource({
        type: resource.type,
        cfId: resource.cfId,
        cfName: resource.cfName,
      });
      await db.delete(resources).where(
        eq(resources.id, resource.id),
      );
      deleted++;
    } catch (error) {
      logError(`Failed to GC orphaned resource ${resource.id} (${resource.type})`, error, {
        module: 'maintenance/resource-orphan-gc',
      });
      failed++;
    }
  }

  return { deleted, failed, cutoffTime, gracePeriodDays };
}
