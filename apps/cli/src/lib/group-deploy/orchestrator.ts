/**
 * Group Deploy — main orchestrator.
 */
import type {
  GroupDeployOptions,
  GroupDeployResult,
} from './deploy-models.js';
import { provisionResources } from './provisioner.js';
import { deployStandaloneContainers, deployServices } from './phases/container-phase.js';
import { deployWorkers } from './phases/worker-phase.js';
import { resolveAndInjectTemplates } from './phases/template-phase.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface DeployContext {
  groupName: string;
  env: string;
  namespace?: string;
  accountId: string;
  apiToken: string;
  dryRun: boolean;
  compatibilityDate?: string;
}

// ── Main orchestrator ────────────────────────────────────────────────────────

export async function deployGroup(options: GroupDeployOptions): Promise<GroupDeployResult> {
  const {
    manifest,
    env,
    namespace,
    accountId,
    apiToken,
    dryRun = false,
    compatibilityDate,
    serviceFilter,
    workerFilter,
    containerFilter,
  } = options;

  const groupName = options.groupName || manifest.metadata.name;

  const result: GroupDeployResult = {
    groupName,
    env,
    namespace,
    dryRun,
    services: [],
    resources: [],
    bindings: [],
  };

  // Build a unified filter from serviceFilter + workerFilter + containerFilter
  const effectiveFilter: string[] | undefined = (() => {
    const parts: string[] = [];
    if (serviceFilter && serviceFilter.length > 0) parts.push(...serviceFilter);
    if (workerFilter && workerFilter.length > 0) parts.push(...workerFilter);
    if (containerFilter && containerFilter.length > 0) parts.push(...containerFilter);
    return parts.length > 0 ? parts : undefined;
  })();

  const ctx: DeployContext = { groupName, env, namespace, accountId, apiToken, dryRun, compatibilityDate };

  const workers = manifest.spec.workers || {};
  const containers = manifest.spec.containers || {};
  const services = manifest.spec.services || {};

  // Determine which containers are referenced by workers
  const workerReferencedContainers = new Set<string>();
  for (const w of Object.values(workers)) {
    for (const cRef of w.containers || []) {
      workerReferencedContainers.add(cRef);
    }
  }

  // Step 1: Provision resources
  let resourcesToProvision = manifest.spec.resources || {};
  if (effectiveFilter && effectiveFilter.length > 0) {
    const referencedResources = new Set<string>();
    for (const name of effectiveFilter) {
      const w = workers[name];
      if (w?.bindings) {
        for (const r of w.bindings.d1 || []) referencedResources.add(r);
        for (const r of w.bindings.r2 || []) referencedResources.add(r);
        for (const r of w.bindings.kv || []) referencedResources.add(r);
      }
    }
    const allResources = manifest.spec.resources || {};
    resourcesToProvision = Object.fromEntries(
      Object.entries(allResources).filter(([name]) => referencedResources.has(name)),
    );
  }
  const { provisioned, results: resourceResults } = await provisionResources(
    resourcesToProvision,
    { accountId, apiToken, groupName, env, dryRun },
  );
  result.resources = resourceResults;

  // Step 2a: Deploy standalone containers
  await deployStandaloneContainers(containers, options, result, provisioned, workerReferencedContainers, effectiveFilter);

  // Step 2a-2: Deploy services
  await deployServices(services, options, result, provisioned, effectiveFilter);

  // Step 2b: Deploy workers
  await deployWorkers(workers, containers, options, result, provisioned, effectiveFilter, ctx);

  // Step 3: Template context & env.inject resolution
  await resolveAndInjectTemplates(manifest, options, result, { accountId, apiToken, dryRun });

  return result;
}
