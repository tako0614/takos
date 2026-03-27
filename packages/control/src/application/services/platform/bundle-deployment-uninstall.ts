import { getDb } from '../../../infra/db';
import {
  bundleDeployments,
  bundleDeploymentEvents,
  resources,
  shortcutGroups,
  shortcutGroupItems,
  uiExtensions,
  fileHandlers,
  deployments,
  serviceDeployments,
} from '../../../infra/db/schema';
import { services, serviceBindings } from '../../../infra/db/schema-services';
import { eq, and, inArray, notInArray } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { deleteClient } from '../oauth/client';
import { WFPService } from '../../../platform/providers/cloudflare/wfp.ts';
import { CloudflareResourceService } from '../../../platform/providers/cloudflare/resources.ts';
import { safeJsonParseOrDefault } from '../../../shared/utils';
import { deleteHostnameRouting } from '../routing/service';
import { CommonEnvService } from '../common-env';
import { InfraService } from './infra';
import { deleteManagedMcpServersByBundleDeployment } from '../platform/mcp';
import { listSpaceServiceRouteCleanupRecords } from './workers';
import {
  bestEffort,
  deleteCfResource,
} from '../takopack/compensation';

export interface BundleDeploymentUninstaller {
  uninstall(spaceId: string, bundleDeploymentId: string, options?: {
    deleteDeploymentRecord?: boolean;
    deleteResources?: boolean;
  }): Promise<void>;
}

export async function uninstallBundleDeployment(
  env: Env,
  commonEnvService: CommonEnvService,
  infraService: InfraService,
  spaceId: string,
  bundleDeploymentId: string,
  options?: {
    deleteDeploymentRecord?: boolean;
    deleteResources?: boolean;
  },
): Promise<void> {
  const db = getDb(env.DB);
  const deleteResources = options?.deleteResources ?? true;

  const bundleDeployment = await db.select({
    id: bundleDeployments.id,
    oauthClientId: bundleDeployments.oauthClientId,
  }).from(bundleDeployments).where(
    and(
      eq(bundleDeployments.id, bundleDeploymentId),
      eq(bundleDeployments.accountId, spaceId),
    )
  ).get();

  if (!bundleDeployment) return;

  const wfp = new WFPService(env);
  const allServices = await listSpaceServiceRouteCleanupRecords(env.DB, spaceId);

  const bundleServices = allServices.filter((service) => {
    const config = safeJsonParseOrDefault<{
      source?: string;
      bundle_deployment_id?: string;
      takopack_id?: string;
    }>(service.config, {});
    return (config.source === 'bundle_deployment' && config.bundle_deployment_id === bundleDeploymentId)
      || (config.source === 'takopack' && config.takopack_id === bundleDeploymentId);
  });

  const bundleWorkerIds = bundleServices.map((s) => s.id);

  // Collect resource IDs before deleting bindings (needed for resource cleanup)
  const workerResourceIds = new Set<string>();
  if (deleteResources && bundleWorkerIds.length > 0) {
    const allBindings = await db.select({ resourceId: serviceBindings.resourceId })
      .from(serviceBindings).where(inArray(serviceBindings.serviceId, bundleWorkerIds)).all();
    for (const b of allBindings) {
      if (b.resourceId) workerResourceIds.add(b.resourceId);
    }
  }

  // Collect deployment artifacts for WFP cleanup
  const workerDeploymentArtifacts = new Map<string, string[]>();
  if (bundleWorkerIds.length > 0) {
    for (const workerId of bundleWorkerIds) {
      const workerDeploys = await db
        .select({ artifactRef: deployments.artifactRef })
        .from(deployments)
        .where(eq(serviceDeployments.serviceId, workerId))
        .all();
      workerDeploymentArtifacts.set(workerId, workerDeploys.map(d => d.artifactRef).filter(Boolean) as string[]);
    }
  }

  await commonEnvService.deleteWorkerTakosAccessTokenConfigs({ spaceId, workerIds: bundleWorkerIds });

  // Phase A: hostname routing + WFP artifacts (best-effort)
  for (const service of bundleServices) {
    if (service.hostname) {
      await bestEffort(
        () => deleteHostnameRouting({ env, hostname: service.hostname!.toLowerCase() }),
        `Failed to delete hostname routing for ${service.hostname}`);
    }
    const artifactRefs = new Set<string>();
    if (service.routeRef) artifactRefs.add(service.routeRef);
    for (const ref of workerDeploymentArtifacts.get(service.id) || []) artifactRefs.add(ref);
    for (const ref of artifactRefs) {
      await bestEffort(() => wfp.deleteWorker(ref), `Failed to delete WFP worker ${ref}`);
    }
  }

  // Phase B: service DB records
  if (bundleWorkerIds.length > 0) {
    await bestEffort(async () => {
      await db.delete(serviceBindings).where(inArray(serviceBindings.serviceId, bundleWorkerIds));
      await db.delete(services).where(inArray(services.id, bundleWorkerIds));
    }, 'Failed to delete service DB records');
  }

  // Phase C: CF resources (only on full uninstall)
  if (deleteResources && workerResourceIds.size > 0) {
    const resourceIdsToCheck = [...workerResourceIds];
    const externalBindings = await db.select({ resourceId: serviceBindings.resourceId })
      .from(serviceBindings).where(
        and(inArray(serviceBindings.resourceId, resourceIdsToCheck), notInArray(serviceBindings.serviceId, bundleWorkerIds))
      ).all();
    const sharedResourceIds = new Set(externalBindings.map(b => b.resourceId).filter(Boolean));
    const exclusiveResourceIds = resourceIdsToCheck.filter(id => !sharedResourceIds.has(id));

    if (exclusiveResourceIds.length > 0) {
      const cloudflare = new CloudflareResourceService(env);
      const candidateResources = await db.select({
        id: resources.id,
        type: resources.type,
        cfId: resources.cfId,
        cfName: resources.cfName,
        manifestKey: resources.manifestKey,
      }).from(resources).where(inArray(resources.id, exclusiveResourceIds)).all();

      for (const resource of candidateResources) {
        if (!resource.manifestKey?.startsWith('takopack:')) continue;
        await bestEffort(
          () => deleteCfResource(cloudflare, resource.type, resource.cfId || undefined, resource.cfName || undefined),
          `Failed to delete CF resource ${resource.id} (${resource.type})`);
        await bestEffort(
          () => db.delete(resources).where(eq(resources.id, resource.id)),
          `Failed to delete resource record ${resource.id}`);
      }
    }
  }

  // Phase D: app-specific records
  if (bundleDeployment.oauthClientId) {
    await bestEffort(
      () => deleteClient(env.DB, bundleDeployment.oauthClientId!),
      `Failed to revoke OAuth client ${bundleDeployment.oauthClientId}`);
  }

  await bestEffort(async () => {
    const groups = await db.select({ id: shortcutGroups.id }).from(shortcutGroups)
      .where(eq(shortcutGroups.bundleDeploymentId, bundleDeploymentId)).all();
    if (groups.length > 0) {
      await db.delete(shortcutGroupItems).where(inArray(shortcutGroupItems.groupId, groups.map(g => g.id)));
    }
    await db.delete(shortcutGroups).where(eq(shortcutGroups.bundleDeploymentId, bundleDeploymentId));
  }, 'Failed to delete shortcut groups');

  await bestEffort(
    () => deleteManagedMcpServersByBundleDeployment(env.DB, spaceId, bundleDeploymentId),
    'Failed to delete managed MCP servers');
  await bestEffort(
    () => db.delete(uiExtensions).where(eq(uiExtensions.bundleDeploymentId, bundleDeploymentId)),
    'Failed to delete UI extensions');
  await bestEffort(
    () => db.delete(fileHandlers).where(eq(fileHandlers.bundleDeploymentId, bundleDeploymentId)),
    'Failed to delete file handlers');
  await bestEffort(
    () => infraService.deleteByBundleDeployment(spaceId, bundleDeploymentId),
    'Failed to delete infra workers/endpoints');

  if (options?.deleteDeploymentRecord !== false) {
    await db.update(bundleDeploymentEvents).set({ bundleDeploymentId: null }).where(eq(bundleDeploymentEvents.bundleDeploymentId, bundleDeploymentId));
    await db.delete(bundleDeployments).where(eq(bundleDeployments.id, bundleDeploymentId));
  }
}
