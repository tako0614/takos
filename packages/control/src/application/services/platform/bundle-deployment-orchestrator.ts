import { getDb } from '../../../infra/db';
/** Safely retrieve a value from a Map, throwing a descriptive error if the key is missing. */
function getOrThrow<K, V>(map: Map<K, V>, key: K, msg: string): V {
  const v = map.get(key);
  if (v === undefined) throw new Error(msg);
  return v;
}
import {
  bundleDeployments,
  bundleDeploymentEvents,
  resources,
  shortcutGroups,
  shortcutGroupItems,
  uiExtensions,
  fileHandlers,
  mcpServers,
  repositories,
  repoReleases,
  repoReleaseAssets,
  deployments,
  serviceDeployments,
} from '../../../infra/db/schema';
import { services, serviceBindings } from '../../../infra/db/schema-services';
import { eq, and, inArray, notInArray, lt, desc, like } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { nanoid } from 'nanoid';
import { deleteClient } from '../oauth/client';
import { WFPService } from '../../../platform/providers/cloudflare/wfp.ts';
import { CloudflareResourceService } from '../../../platform/providers/cloudflare/resources.ts';
import { safeJsonParseOrDefault } from '../../../shared/utils';
import { checkRepoAccess } from '../source/repos';
import { deleteHostnameRouting } from '../routing';
import { InfraService } from './infra';
import { CommonEnvService, TAKOS_ACCESS_TOKEN_ENV_NAME } from '../common-env';
import { deleteManagedMcpServersByBundleDeployment } from '../platform/mcp';
import { listWorkspaceServiceRouteCleanupRecords } from './workers';
import { toReleaseAssets } from '../source/repo-release-assets';

import type {
  TakopackManifest,
  InstallResult,
  GitInstallOptions,
  ReleaseAsset,
  ResourceProvisionResult,
  WorkerDeploymentResult,
  TakopackApplyReportEntry,
  ManifestResources,
} from '../takopack/types';
import { parsePackage } from '../takopack/manifest';
import { compareSemver, parseSemver, parseSemverRange, satisfiesSemverRange } from '../takopack/semver';
import { TakopackResourceService } from '../takopack/resources';
import { TakopackWorkerService } from '../takopack/workers';
import { BundleManagedMcpService } from '../takopack/tools';
import { BundleShortcutGroupService, buildProvisionedResourceReferenceMaps } from '../takopack/groups';
import {
  CompensationTracker,
  bestEffort,
  deleteCfResource,
  cleanupProvisionedResources,
  cleanupDeployedWorkers,
} from '../takopack/compensation';
import {
  normalizeDependencies,
  validateManifestForInstall,
} from '../takopack/validator';
import { provisionOAuthClient } from '../takopack/provisioner';
import { DependencyResolver, type InstalledTakopack } from '../takopack/dependency-resolver';
import {
  buildDefaultBundleHostname,
  hasBundleSourceChanged,
  toBundleDeploymentListItem,
  type D1BundleDeploymentListRow,
  type BundleDeploymentListRecord,
} from '../takopack/bundle-deployment-utils';
import { executeBundleInstallPipeline } from '../takopack/bundle-install-pipeline';

export type { TakopackManifest, InstallResult, GitInstallOptions };

type BundleDeploymentListRow = {
  id: string;
  name: string;
  appId: string;
  version: string;
  description: string | null;
  icon: string | null;
  deployedAt: string;
  versionMajor: number;
  versionMinor: number;
  versionPatch: number;
  sourceType: string | null;
  sourceRepoId: string | null;
  sourceTag: string | null;
  sourceAssetId: string | null;
  isLocked: boolean;
  lockedAt: string | null;
  lockedByAccountId: string | null;
};

function toLegacyBundleDeploymentListRecord(row: BundleDeploymentListRow): BundleDeploymentListRecord {
  return {
    id: row.id,
    name: row.name,
    appId: row.appId,
    version: row.version,
    description: row.description,
    icon: row.icon,
    installedAt: row.deployedAt,
    versionMajor: row.versionMajor,
    versionMinor: row.versionMinor,
    versionPatch: row.versionPatch,
    sourceType: row.sourceType,
    sourceRepoId: row.sourceRepoId,
    sourceTag: row.sourceTag,
    sourceAssetId: row.sourceAssetId,
    isPinned: row.isLocked,
    pinnedAt: row.lockedAt,
    pinnedByPrincipalId: row.lockedByAccountId,
  };
}

function toInstalledTakopack(row: {
  id: string;
  name: string;
  appId: string;
  bundleKey: string;
  version: string;
  isLocked: boolean;
  sourceType: string | null;
  sourceRepoId: string | null;
  manifestJson: string;
}): InstalledTakopack {
  return {
    id: row.id,
    name: row.name,
    appId: row.appId,
    installKey: row.bundleKey,
    version: row.version,
    isPinned: row.isLocked,
    sourceType: row.sourceType,
    sourceRepoId: row.sourceRepoId,
    manifestJson: row.manifestJson,
  };
}

export class BundleDeploymentOrchestrator {
  private resourceService: TakopackResourceService;
  private workerService: TakopackWorkerService;
  private toolService: BundleManagedMcpService;
  private groupService: BundleShortcutGroupService;
  private commonEnvService: CommonEnvService;
  private infraService: InfraService;

  constructor(private env: Env) {
    this.resourceService = new TakopackResourceService(env);
    this.workerService = new TakopackWorkerService(env);
    this.toolService = new BundleManagedMcpService(env);
    this.groupService = new BundleShortcutGroupService(env);
    this.commonEnvService = new CommonEnvService(env);
    this.infraService = new InfraService(env);
  }

  private getStoredPackageBucket() {
    return this.env.WORKER_BUNDLES || this.env.GIT_OBJECTS || null;
  }

  private async installFromStoredPackage(
    spaceId: string,
    userId: string,
    storedAssetRef: string,
    options?: {
      replaceBundleDeploymentId?: string;
      installAction?: 'install' | 'update' | 'rollback';
      requireAutoEnvApproval?: boolean;
      oauthAutoEnvApproved?: boolean;
      takosBaseUrl?: string;
      sourceRepoId?: string | null;
      sourceRef?: string | null;
    },
  ) {
    const bucket = this.getStoredPackageBucket();
    if (!bucket) {
      throw new Error('Package storage is not configured');
    }

    const r2Key = storedAssetRef.replace(/^internal:/, '');
    const object = await bucket.get(r2Key);
    if (!object) {
      throw new Error(`Stored package not found: ${storedAssetRef}`);
    }

    const takopackData = await object.arrayBuffer();
    return this.install(spaceId, userId, takopackData, {
      replaceBundleDeploymentId: options?.replaceBundleDeploymentId,
      installAction: options?.installAction,
      requireAutoEnvApproval: options?.requireAutoEnvApproval,
      oauthAutoEnvApproved: options?.oauthAutoEnvApproved,
      takosBaseUrl: options?.takosBaseUrl,
      source: {
        type: 'upload',
        repoId: options?.sourceRepoId || undefined,
        tag: options?.sourceRef || undefined,
        assetId: storedAssetRef,
      },
    });
  }

  private async getBundleWorkerHostnames(
    spaceId: string,
    bundleDeploymentId: string,
  ): Promise<string[]> {
    const db = getDb(this.env.DB);
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

  private async resolveAndInstallDependencies(
    spaceId: string,
    userId: string,
    rootManifest: TakopackManifest,
    options?: {
      rootSourceRepoId?: string;
      requireAutoEnvApproval?: boolean;
      oauthAutoEnvApproved?: boolean;
      takosBaseUrl?: string;
    }
  ): Promise<void> {
    const rootDependencies = normalizeDependencies(rootManifest.dependencies);
    if (rootDependencies.length === 0) return;

    const db = getDb(this.env.DB);

    const installedTakopacks = await db.select({
      id: bundleDeployments.id,
      name: bundleDeployments.name,
      appId: bundleDeployments.appId,
      bundleKey: bundleDeployments.bundleKey,
      version: bundleDeployments.version,
      isLocked: bundleDeployments.isLocked,
      sourceType: bundleDeployments.sourceType,
      sourceRepoId: bundleDeployments.sourceRepoId,
      manifestJson: bundleDeployments.manifestJson,
    }).from(bundleDeployments).where(eq(bundleDeployments.accountId, spaceId)).orderBy(desc(bundleDeployments.deployedAt)).all();

    const installedGitByRepoId = new Map<string, InstalledTakopack>();
    for (const t of installedTakopacks.map(toInstalledTakopack)) {
      if (t.sourceType === 'git' && t.sourceRepoId) {
        if (!installedGitByRepoId.has(t.sourceRepoId)) {
          installedGitByRepoId.set(t.sourceRepoId, t);
        }
      }
    }

    const resolver = new DependencyResolver(db, this.env, userId, installedGitByRepoId);

    await resolver.seedRootDependencies(rootDependencies);
    await resolver.resolve();

    const selected = resolver.getSelected();
    const order = resolver.getInstallOrder();

    const selectedRepoIdByAppId = new Map<string, string>();
    for (const depRepoId of order) {
      const cand = getOrThrow(selected, depRepoId, `Selected dependency not found for repo ${depRepoId}`);
      const existingSelectedRepoId = selectedRepoIdByAppId.get(cand.appId);
      if (existingSelectedRepoId && existingSelectedRepoId !== depRepoId) {
        const existingSelected = selected.get(existingSelectedRepoId);
        throw new Error(
          `Dependency appId conflict: "${cand.appId}" is provided by multiple selected dependencies (` +
          `${existingSelected?.repoRef || existingSelectedRepoId}, ${cand.repoRef})`
        );
      }
      selectedRepoIdByAppId.set(cand.appId, depRepoId);

      if (cand.appId === rootManifest.meta.appId) {
        if (!options?.rootSourceRepoId || options.rootSourceRepoId !== depRepoId) {
          throw new Error(`Dependency appId conflict: "${cand.appId}" conflicts with the package being installed`);
        }
      }
    }

    const affectedRepoIds = new Set<string>();
    const finalVersionByRepoId = new Map<string, string>();

    for (const [repoId, cand] of selected.entries()) {
      finalVersionByRepoId.set(repoId, cand.version);
      const installed = installedGitByRepoId.get(repoId);
      if (!installed || installed.version !== cand.version) {
        affectedRepoIds.add(repoId);
      }
    }
    if (options?.rootSourceRepoId) {
      affectedRepoIds.add(options.rootSourceRepoId);
      finalVersionByRepoId.set(options.rootSourceRepoId, rootManifest.meta.version);
    }

    for (const t of installedTakopacks) {
      const parsed = safeJsonParseOrDefault<TakopackManifest | null>(t.manifestJson, null);
      const deps = normalizeDependencies(parsed?.dependencies);
      for (const dep of deps) {
        const depRepo = await resolver.resolveRepoRef(dep.repo);
        if (!affectedRepoIds.has(depRepo.id)) continue;
        const parsedRange = parseSemverRange(dep.version);
        const finalV = finalVersionByRepoId.get(depRepo.id);
        if (!finalV) continue;
        if (!satisfiesSemverRange(finalV, parsedRange)) {
          throw new Error(
            `Dependency conflict: installing/updating dependencies would break "${t.name}" (requires ${dep.repo} ${dep.version}, but would be ${finalV})`
          );
        }
      }
    }

    for (const depRepoId of order) {
      const cand = getOrThrow(selected, depRepoId, `Selected dependency not found for repo ${depRepoId}`);
      if (cand.source === 'installed') continue;

      const installed = installedGitByRepoId.get(depRepoId);
      const installAction: GitInstallOptions['installAction'] = installed ? 'update' : 'install';

      await this.installFromGit(spaceId, userId, {
        repoId: depRepoId,
        releaseTag: cand.releaseTag!,
        assetId: cand.assetId!,
        replaceBundleDeploymentId: installed?.id,
        installAction,
        skipDependencyResolution: true,
        requireAutoEnvApproval: options?.requireAutoEnvApproval,
        oauthAutoEnvApproved: options?.oauthAutoEnvApproved,
        takosBaseUrl: options?.takosBaseUrl,
      });
    }
  }

  async install(
    spaceId: string,
    userId: string,
    takopackData: ArrayBuffer,
    options?: {
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
    }
  ): Promise<InstallResult> {
    const { manifest, files, applyReport: normalizedApplyReport } = await parsePackage(takopackData);
    return this.installResolvedPackage(spaceId, userId, {
      manifest,
      files,
      normalizedApplyReport,
      options,
    });
  }

  async installResolvedPackage(
    spaceId: string,
    userId: string,
    input: {
      manifest: TakopackManifest;
      files: Map<string, ArrayBuffer>;
      normalizedApplyReport: TakopackApplyReportEntry[];
      options?: {
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
    },
  ): Promise<InstallResult> {
    const db = getDb(this.env.DB);
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
      env: this.env,
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
      await this.resolveAndInstallDependencies(spaceId, userId, manifest, {
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
        const existingHostnames = await this.getBundleWorkerHostnames(
          spaceId,
          options.replaceBundleDeploymentId,
        );
        installHostname = existingHostnames[0];
      }
      await this.uninstall(spaceId, options.replaceBundleDeploymentId, {
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
        String(this.env.TENANT_BASE_DOMAIN || 'app.takos.jp'),
      );

    try {
      const result = await executeBundleInstallPipeline({
        env: this.env,
        db,
        resourceService: this.resourceService,
        workerService: this.workerService,
        toolService: this.toolService,
        groupService: this.groupService,
        commonEnvService: this.commonEnvService,
        infraService: this.infraService,
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
        await this.markOrphanedResources(spaceId, installKey, manifest.resources);
      }

      return result;
    } catch (error) {
      await tracker.rollback();
      throw error;
    }
  }

  async installFromGit(
    spaceId: string,
    userId: string,
    options: GitInstallOptions
  ): Promise<InstallResult> {
    const db = getDb(this.env.DB);

    const repoAccess = await checkRepoAccess(this.env, options.repoId, userId);
    if (!repoAccess) {
      const sourceRepo = await db.select({ visibility: repositories.visibility }).from(repositories).where(eq(repositories.id, options.repoId)).get();
      if (!sourceRepo || sourceRepo.visibility !== 'public') {
        throw new Error('Repository not found');
      }
    }

    const release = await db.select().from(repoReleases).where(
      and(
        eq(repoReleases.repoId, options.repoId),
        eq(repoReleases.tag, options.releaseTag),
        eq(repoReleases.isDraft, false),
      )
    ).get();

    if (!release) {
      throw new Error('Release not found');
    }

    const releaseAssetRows = await db.select().from(repoReleaseAssets).where(
      eq(repoReleaseAssets.releaseId, release.id)
    ).orderBy(repoReleaseAssets.createdAt).all();

    const assets: ReleaseAsset[] = toReleaseAssets(releaseAssetRows);

    const takopackAsset = options.assetId
      ? assets.find((a) => a.id === options.assetId && a.bundle_format === 'takopack')
      : assets.find((a) => a.bundle_format === 'takopack');

    if (!takopackAsset) {
      throw new Error('No takopack asset found in release');
    }

    if (!this.env.GIT_OBJECTS) {
      throw new Error('Storage not configured');
    }

    const object = await this.env.GIT_OBJECTS.get(takopackAsset.r2_key);
    if (!object) {
      throw new Error('Asset file not found in storage');
    }

    const takopackData = await object.arrayBuffer();

    return this.install(spaceId, userId, takopackData, {
      replaceBundleDeploymentId: options.replaceBundleDeploymentId,
      approveSourceChange: options.approveSourceChange,
      installAction: options.installAction,
      skipDependencyResolution: options.skipDependencyResolution,
      source: {
        type: 'git',
        repoId: options.repoId,
        tag: options.releaseTag,
        assetId: takopackAsset.id,
      },
      requireAutoEnvApproval: options.requireAutoEnvApproval,
      oauthAutoEnvApproved: options.oauthAutoEnvApproved,
      takosBaseUrl: options.takosBaseUrl,
    });
  }

  async list(spaceId: string) {
    const db = getDb(this.env.DB);
    const rows = await db.select({
      id: bundleDeployments.id,
      name: bundleDeployments.name,
      appId: bundleDeployments.appId,
      version: bundleDeployments.version,
      description: bundleDeployments.description,
      icon: bundleDeployments.icon,
      deployedAt: bundleDeployments.deployedAt,
      versionMajor: bundleDeployments.versionMajor,
      versionMinor: bundleDeployments.versionMinor,
      versionPatch: bundleDeployments.versionPatch,
      sourceType: bundleDeployments.sourceType,
      sourceRepoId: bundleDeployments.sourceRepoId,
      sourceTag: bundleDeployments.sourceTag,
      sourceAssetId: bundleDeployments.sourceAssetId,
      isLocked: bundleDeployments.isLocked,
      lockedAt: bundleDeployments.lockedAt,
      lockedByAccountId: bundleDeployments.lockedByAccountId,
    }).from(bundleDeployments).where(eq(bundleDeployments.accountId, spaceId)).orderBy(desc(bundleDeployments.deployedAt)).all();

    return rows.map((deployment) => toBundleDeploymentListItem(toLegacyBundleDeploymentListRecord(deployment)));
  }

  async get(spaceId: string, bundleDeploymentId: string) {
    const db = getDb(this.env.DB);

    const bundleDeployment = await db.select().from(bundleDeployments).where(
      and(
        eq(bundleDeployments.id, bundleDeploymentId),
        eq(bundleDeployments.accountId, spaceId),
      )
    ).get();

    if (!bundleDeployment) return null;

    const groups = await db.select().from(shortcutGroups).where(eq(shortcutGroups.bundleDeploymentId, bundleDeploymentId)).all();
    const uiExts = await db.select().from(uiExtensions).where(eq(uiExtensions.bundleDeploymentId, bundleDeploymentId)).all();
    const mcpServerRows = await db.select().from(mcpServers).where(eq(mcpServers.bundleDeploymentId, bundleDeploymentId)).all();
    const hostnames = await this.getBundleWorkerHostnames(spaceId, bundleDeploymentId);

    return {
      ...toLegacyBundleDeploymentListRecord(bundleDeployment),
      manifestJson: bundleDeployment.manifestJson,
      hostnames,
      groups,
      uiExtensions: uiExts,
      mcpServers: mcpServerRows,
    };
  }

  async rollbackToPrevious(
    spaceId: string,
    userId: string,
    bundleDeploymentId: string,
    options?: {
      requireAutoEnvApproval?: boolean;
      oauthAutoEnvApproved?: boolean;
      takosBaseUrl?: string;
    },
  ): Promise<{ previousVersion: string; targetVersion: string; installed: InstallResult }> {
    const db = getDb(this.env.DB);
    const bundleDeployment = await db.select({
      id: bundleDeployments.id,
      bundleKey: bundleDeployments.bundleKey,
      version: bundleDeployments.version,
    }).from(bundleDeployments).where(
      and(
        eq(bundleDeployments.id, bundleDeploymentId),
        eq(bundleDeployments.accountId, spaceId),
      )
    ).get();
    if (!bundleDeployment) {
      throw new Error('Bundle deployment not found');
    }

    const current = await db.select().from(bundleDeploymentEvents).where(
      and(
        eq(bundleDeploymentEvents.accountId, spaceId),
        eq(bundleDeploymentEvents.bundleDeploymentId, bundleDeployment.id),
      )
    ).orderBy(desc(bundleDeploymentEvents.deployedAt)).get();
    if (!current) {
      throw new Error('Bundle deployment history not found');
    }

    const prev = await db.select().from(bundleDeploymentEvents).where(
      and(
        eq(bundleDeploymentEvents.accountId, spaceId),
        eq(bundleDeploymentEvents.bundleKey, bundleDeployment.bundleKey),
        lt(bundleDeploymentEvents.deployedAt, current.deployedAt),
      )
    ).orderBy(desc(bundleDeploymentEvents.deployedAt)).get();
    if (!prev) {
      throw new Error('No previous version found to rollback to');
    }
    let installed: InstallResult;
    if (prev.sourceAssetId?.startsWith('internal:')) {
      installed = await this.installFromStoredPackage(spaceId, userId, prev.sourceAssetId, {
        replaceBundleDeploymentId: bundleDeployment.id,
        installAction: 'rollback',
        requireAutoEnvApproval: options?.requireAutoEnvApproval,
        oauthAutoEnvApproved: options?.oauthAutoEnvApproved,
        takosBaseUrl: options?.takosBaseUrl,
        sourceRepoId: prev.sourceRepoId,
        sourceRef: prev.sourceTag,
      });
    } else if (prev.sourceType === 'git' && prev.sourceRepoId && prev.sourceTag) {
      installed = await this.installFromGit(spaceId, userId, {
        repoId: prev.sourceRepoId,
        releaseTag: prev.sourceTag,
        assetId: prev.sourceAssetId || undefined,
        replaceBundleDeploymentId: bundleDeployment.id,
        installAction: 'rollback',
        requireAutoEnvApproval: options?.requireAutoEnvApproval,
        oauthAutoEnvApproved: options?.oauthAutoEnvApproved,
        takosBaseUrl: options?.takosBaseUrl,
      });
    } else {
      throw new Error('Previous version is not rollbackable');
    }

    return {
      previousVersion: bundleDeployment.version,
      targetVersion: prev.version,
      installed,
    };
  }

  /**
   * Mark resources that are no longer referenced by the current manifest as orphaned.
   * Orphaned resources are not deleted immediately — a maintenance GC job handles cleanup
   * after a grace period.
   */
  private async markOrphanedResources(
    spaceId: string,
    bundleKey: string,
    currentResources?: ManifestResources,
  ): Promise<void> {
    const db = getDb(this.env.DB);
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

  /**
   * Tear down a bundle deployment. Two modes:
   * - `deleteResources: false` (update path): keep D1/R2/KV, only remove ephemeral artifacts
   * - `deleteResources: true`  (full uninstall): delete everything including CF resources
   */
  async uninstall(spaceId: string, bundleDeploymentId: string, options?: {
    deleteDeploymentRecord?: boolean;
    deleteResources?: boolean;
  }): Promise<void> {
    const db = getDb(this.env.DB);
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

    const wfp = new WFPService(this.env);
    const allServices = await listWorkspaceServiceRouteCleanupRecords(this.env.DB, spaceId);

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

    await this.commonEnvService.deleteWorkerTakosAccessTokenConfigs({ spaceId, workerIds: bundleWorkerIds });

    // Phase A: hostname routing + WFP artifacts (best-effort)
    for (const service of bundleServices) {
      if (service.hostname) {
        await bestEffort(
          () => deleteHostnameRouting({ env: this.env, hostname: service.hostname!.toLowerCase() }),
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
        const cloudflare = new CloudflareResourceService(this.env);
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
        () => deleteClient(this.env.DB, bundleDeployment.oauthClientId!),
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
      () => deleteManagedMcpServersByBundleDeployment(this.env.DB, spaceId, bundleDeploymentId),
      'Failed to delete managed MCP servers');
    await bestEffort(
      () => db.delete(uiExtensions).where(eq(uiExtensions.bundleDeploymentId, bundleDeploymentId)),
      'Failed to delete UI extensions');
    await bestEffort(
      () => db.delete(fileHandlers).where(eq(fileHandlers.bundleDeploymentId, bundleDeploymentId)),
      'Failed to delete file handlers');
    await bestEffort(
      () => this.infraService.deleteByBundleDeployment(spaceId, bundleDeploymentId),
      'Failed to delete infra workers/endpoints');

    if (options?.deleteDeploymentRecord !== false) {
      await db.update(bundleDeploymentEvents).set({ bundleDeploymentId: null }).where(eq(bundleDeploymentEvents.bundleDeploymentId, bundleDeploymentId));
      await db.delete(bundleDeployments).where(eq(bundleDeployments.id, bundleDeploymentId));
    }
  }
}

export function createBundleDeploymentOrchestrator(env: Env): BundleDeploymentOrchestrator {
  return new BundleDeploymentOrchestrator(env);
}
