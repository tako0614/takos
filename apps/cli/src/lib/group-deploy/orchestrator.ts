/**
 * Group Deploy — main orchestrator.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  ContainerWranglerConfig,
  GroupDeployOptions,
  GroupDeployResult,
  ProvisionedResource,
  WranglerConfig,
  WorkerContainerSpec,
  WorkerServiceDef,
} from './deploy-models.js';
import { execCommand } from './cloudflare-helpers.js';
import { provisionResources } from './provisioner.js';
import { generateWranglerConfig, serializeWranglerToml } from './wrangler-config.js';
import { deployContainerWithWrangler, serializeContainerWranglerToml } from './container.js';
import { deployWorkerWithWrangler } from './deploy-worker.js';
import { collectWorkerBindingResults } from './bindings.js';
import {
  buildTemplateContext,
  resolveTemplateString,
} from './template.js';

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

  return deployNewFormat(
    manifest, options, result, effectiveFilter,
    { groupName, env, namespace, accountId, apiToken, dryRun, compatibilityDate },
  );
}

interface DeployContext {
  groupName: string;
  env: string;
  namespace?: string;
  accountId: string;
  apiToken: string;
  dryRun: boolean;
  compatibilityDate?: string;
}

// ── New-format deploy (workers/containers top-level) ─────────────────────────

async function deployNewFormat(
  manifest: GroupDeployOptions['manifest'],
  options: GroupDeployOptions,
  result: GroupDeployResult,
  effectiveFilter: string[] | undefined,
  ctx: DeployContext,
): Promise<GroupDeployResult> {
  const { groupName, env, namespace, accountId, apiToken, dryRun, compatibilityDate } = ctx;
  const workers = manifest.spec.workers || {};
  const containers = manifest.spec.containers || {};

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

  // Step 2a: Deploy standalone containers (not referenced by any worker)
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

  // Step 2b: Deploy workers (with referenced containers included in wrangler config)
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

  // Step 3: Template context & env.inject resolution
  if (manifest.spec.env?.inject) {
    const tmplCtx = buildTemplateContext(result, manifest, options);
    const resolvedEnv: Record<string, string> = {};
    for (const [key, template] of Object.entries(manifest.spec.env.inject)) {
      resolvedEnv[key] = resolveTemplateString(template, tmplCtx);
    }

    if (!dryRun && Object.keys(resolvedEnv).length > 0) {
      for (const svc of result.services) {
        if (svc.type !== 'worker' || svc.status !== 'deployed' || !svc.scriptName) continue;
        for (const [secretName, secretValue] of Object.entries(resolvedEnv)) {
          const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-inject-'));
          try {
            const wranglerEnv: NodeJS.ProcessEnv = {
              CLOUDFLARE_ACCOUNT_ID: accountId,
              CLOUDFLARE_API_TOKEN: apiToken,
            };
            await execCommand(
              'npx',
              ['wrangler', 'secret', 'put', secretName, '--name', svc.scriptName],
              { cwd: tmpDir, env: wranglerEnv, stdin: secretValue },
            );
          } finally {
            await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* cleanup: best-effort temp dir removal */ });
          }
        }
      }
    }
  }

  return result;
}

