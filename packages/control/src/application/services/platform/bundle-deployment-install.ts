import { getDb } from '../../../infra/db';
import {
  bundleDeployments,
  resources,
} from '../../../infra/db/schema';
import { eq, and, like } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { nanoid } from 'nanoid';
import { safeJsonParseOrDefault } from '../../../shared/utils';
import { services } from '../../../infra/db/schema-services';
import { CommonEnvService } from '../common-env';
import { InfraService } from './infra';
import { TakopackResourceService } from '../takopack/resources';
import { TakopackWorkerService } from '../takopack/workers';
import { BundleManagedMcpService } from '../takopack/tools';
import { BundleShortcutGroupService } from '../takopack/groups';

import type {
  TakopackManifest,
  InstallResult,
  GitInstallOptions,
  TakopackApplyReportEntry,
} from '../takopack/types';
import { parsePackage } from '../takopack/manifest';
import { parseSemver } from '../takopack/semver';
import {
  CompensationTracker,
} from '../takopack/compensation';
import {
  validateManifestForInstall,
} from '../takopack/validator';
import {
  buildDefaultBundleHostname,
  hasBundleSourceChanged,
} from '../takopack/bundle-deployment-utils';
import { executeBundleInstallPipeline } from '../takopack/bundle-install-pipeline';
import type { BundleDeploymentUninstaller } from './bundle-deployment-uninstall';
import { resolveAndInstallDependencies } from './bundle-deployment-dependencies';

export type BundleInstallOptions = {
  replaceBundleDeploymentId?: string;
  approveSourceChange?: boolean;
  takosBaseUrl?: string;
  hostname?: string;
  installAction?: 'install' | 'update' | 'rollback';
  skipDependencyResolution?: boolean;
  source?: {
    type: 'git' | 'upload';
    repoId?: string;
    tag?: string;
    assetId?: string;
  };
  requireAutoEnvApproval?: boolean;
  oauthAutoEnvApproved?: boolean;
  envOverrides?: Record<string, string>;
  serviceBindingOverrides?: Record<string, string>;
};

export interface BundleDeploymentInstallServices {
  env: Env;
  resourceService: TakopackResourceService;
  workerService: TakopackWorkerService;
  toolService: BundleManagedMcpService;
  groupService: BundleShortcutGroupService;
  commonEnvService: CommonEnvService;
  infraService: InfraService;
}

export async function getBundleWorkerHostnames(
  env: Env,
  spaceId: string,
  bundleDeploymentId: string,
): Promise<string[]> {
  const db = getDb(env.DB);
  const allServices = await db.select({
    hostname: services.hostname,
    config: services.config,
  }).from(services).where(eq(services.accountId, spaceId)).all();

  return allServices
    .filter((serviceRecord) => {
      const config = safeJsonParseOrDefault<{
        source?: string;
        bundle_deployment_id?: string;
        takopack_id?: string;
      }>(serviceRecord.config, {});
      return (config.source === 'bundle_deployment' && config.bundle_deployment_id === bundleDeploymentId)
        || (config.source === 'takopack' && config.takopack_id === bundleDeploymentId);
    })
    .map((serviceRecord) => String(serviceRecord.hostname || '').trim().toLowerCase())
    .filter(Boolean);
}

export async function installBundle(
  svc: BundleDeploymentInstallServices,
  uninstaller: BundleDeploymentUninstaller,
  installFromGitFn: (spaceId: string, userId: string, options: GitInstallOptions) => Promise<InstallResult>,
  spaceId: string,
  userId: string,
  takopackData: ArrayBuffer,
  options?: BundleInstallOptions,
): Promise<InstallResult> {
  const { manifest, files, applyReport: normalizedApplyReport } = await parsePackage(takopackData);
  return installResolvedPackage(svc, uninstaller, installFromGitFn, spaceId, userId, {
    manifest,
    files,
    normalizedApplyReport,
    options,
  });
}

export async function installResolvedPackage(
  svc: BundleDeploymentInstallServices,
  uninstaller: BundleDeploymentUninstaller,
  installFromGitFn: (spaceId: string, userId: string, options: GitInstallOptions) => Promise<InstallResult>,
  spaceId: string,
  userId: string,
  input: {
    manifest: TakopackManifest;
    files: Map<string, ArrayBuffer>;
    normalizedApplyReport: TakopackApplyReportEntry[];
    options?: BundleInstallOptions;
  },
): Promise<InstallResult> {
  const db = getDb(svc.env.DB);
  const { manifest, files, normalizedApplyReport, options } = input;
  const semver = parseSemver(manifest.meta.version);
  if (!semver) {
    throw new Error(`Invalid takopack version: ${manifest.meta.version} (expected semver like "1.0.0")`);
  }

  // Phase 1: Validate manifest, capabilities, and env requirements
  const {
    requiredEnvKeys,
    requestedCapabilities,
    appBaseUrlForAutoEnv,
  } = await validateManifestForInstall({
    env: svc.env,
    manifest,
    spaceId,
    userId,
    sourceRepoId: options?.source?.repoId,
    sourceType: options?.source?.type,
    requireAutoEnvApproval: options?.requireAutoEnvApproval,
    oauthAutoEnvApproved: options?.oauthAutoEnvApproved,
    takosBaseUrl: options?.takosBaseUrl,
  });

  manifest.capabilities = requestedCapabilities;

  // Phase 2: Resolve and install dependencies
  if (!options?.skipDependencyResolution) {
    await resolveAndInstallDependencies(svc.env, installFromGitFn, spaceId, userId, manifest, {
      rootSourceRepoId: options?.source?.type === 'git' ? (options.source.repoId || undefined) : undefined,
      requireAutoEnvApproval: options?.requireAutoEnvApproval,
      oauthAutoEnvApproved: options?.oauthAutoEnvApproved,
      takosBaseUrl: options?.takosBaseUrl,
    });
  }

  // Phase 3: Resolve explicit replacement target
  const installKey = options?.replaceBundleDeploymentId
    ? await (async () => {
        const target = await db.select({
          id: bundleDeployments.id,
          appId: bundleDeployments.appId,
          bundleKey: bundleDeployments.bundleKey,
          sourceType: bundleDeployments.sourceType,
          sourceRepoId: bundleDeployments.sourceRepoId,
        }).from(bundleDeployments).where(
          and(
            eq(bundleDeployments.id, options.replaceBundleDeploymentId!),
            eq(bundleDeployments.accountId, spaceId),
          )
        ).get();
        if (!target) {
          throw new Error('Replacement target bundle deployment not found');
        }
        if (target.appId !== manifest.meta.appId) {
          throw new Error(
            `Replacement target appId mismatch: expected ${target.appId}, received ${manifest.meta.appId}`
          );
        }
        if (hasBundleSourceChanged({
          previousSourceType: target.sourceType,
          previousSourceRepoId: target.sourceRepoId,
          nextSourceType: options?.source?.type,
          nextSourceRepoId: options?.source?.repoId,
        }) && !options?.approveSourceChange) {
          throw new Error(
            'Bundle deployment source change requires explicit approval. Set approve_source_change=true.'
          );
        }
        return target.bundleKey;
      })()
    : nanoid();

  let replacedBundleDeploymentId: string | null = null;
  let installHostname = options?.hostname;
  if (options?.replaceBundleDeploymentId) {
    replacedBundleDeploymentId = options.replaceBundleDeploymentId;
    if (!installHostname) {
      const existingHostnames = await getBundleWorkerHostnames(
        svc.env,
        spaceId,
        options.replaceBundleDeploymentId,
      );
      installHostname = existingHostnames[0];
    }
    await uninstaller.uninstall(spaceId, options.replaceBundleDeploymentId, {
      deleteDeploymentRecord: false,
      deleteResources: false,
    });
  }

  // Phase 4: Provision and deploy with compensation tracking
  const bundleDeploymentId = options?.replaceBundleDeploymentId || nanoid();
  const tracker = new CompensationTracker();
  const resolvedHostname = installHostname
    || buildDefaultBundleHostname(
      manifest.meta.appId,
      installKey,
      String(svc.env.TENANT_BASE_DOMAIN || 'app.takos.jp'),
    );

  try {
    const result = await executeBundleInstallPipeline({
      env: svc.env,
      db,
      resourceService: svc.resourceService,
      workerService: svc.workerService,
      toolService: svc.toolService,
      groupService: svc.groupService,
      commonEnvService: svc.commonEnvService,
      infraService: svc.infraService,
      spaceId,
      userId,
      bundleDeploymentId,
      installKey,
      manifest,
      semver,
      files,
      normalizedApplyReport,
      replacedBundleDeploymentId,
      requiredEnvKeys,
      appBaseUrlForAutoEnv,
      tracker,
      options,
      hostname: resolvedHostname,
    });

    // Mark resources no longer referenced by the new manifest as orphaned
    if (replacedBundleDeploymentId) {
      await markOrphanedResources(svc.env, installKey, manifest.resources);
    }

    return result;
  } catch (error) {
    await tracker.rollback();
    throw error;
  }
}

/**
 * Mark resources that are no longer referenced by the current manifest as orphaned.
 * Orphaned resources are not deleted immediately -- a maintenance GC job handles cleanup
 * after a grace period.
 */
async function markOrphanedResources(
  env: Env,
  bundleKey: string,
  currentResources?: TakopackManifest['resources'],
): Promise<void> {
  const db = getDb(env.DB);
  const prefix = `takopack:${bundleKey}:`;

  const currentBindings = new Set<string>();
  if (currentResources?.d1) {
    for (const r of currentResources.d1) currentBindings.add(r.binding);
  }
  if (currentResources?.r2) {
    for (const r of currentResources.r2) currentBindings.add(r.binding);
  }
  if (currentResources?.kv) {
    for (const r of currentResources.kv) currentBindings.add(r.binding);
  }

  const allBundleResources = await db.select({
    id: resources.id,
    manifestKey: resources.manifestKey,
  }).from(resources).where(
    like(resources.manifestKey, `${prefix}%`)
  ).all();

  const now = new Date().toISOString();
  for (const resource of allBundleResources) {
    if (!resource.manifestKey) continue;
    const binding = resource.manifestKey.slice(prefix.length);
    if (!currentBindings.has(binding)) {
      await db.update(resources).set({ orphanedAt: now }).where(eq(resources.id, resource.id));
    }
  }
}
