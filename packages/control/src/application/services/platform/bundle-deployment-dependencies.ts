import { getDb } from '../../../infra/db';
import {
  bundleDeployments,
  repositories,
  repoReleases,
  repoReleaseAssets,
} from '../../../infra/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { safeJsonParseOrDefault } from '../../../shared/utils';
import { checkRepoAccess } from '../source/repos';

import type {
  TakopackManifest,
  InstallResult,
  GitInstallOptions,
  ReleaseAsset,
} from '../takopack/types';
import {
  normalizeDependencies,
} from '../takopack/validator';
import { DependencyResolver, type InstalledTakopack } from '../takopack/dependency-resolver';
import { satisfiesSemverRange, parseSemverRange } from '../takopack/semver';
import { toReleaseAssets } from '../source/repo-release-assets';
import { getOrThrow, toInstalledTakopack } from './bundle-deployment-types';

/**
 * Resolve and install transitive dependencies declared by a root manifest.
 */
export async function resolveAndInstallDependencies(
  env: Env,
  installFromGitFn: (spaceId: string, userId: string, options: GitInstallOptions) => Promise<InstallResult>,
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

  const db = getDb(env.DB);

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

  const resolver = new DependencyResolver(db, env, userId, installedGitByRepoId);

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

    await installFromGitFn(spaceId, userId, {
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

/**
 * Install a takopack from a Git repository release.
 * Resolves the repository, finds the release asset, downloads, and delegates to the install function.
 */
export async function installFromGitSource(
  env: Env,
  installBundleFn: (
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
    },
  ) => Promise<InstallResult>,
  spaceId: string,
  userId: string,
  options: GitInstallOptions
): Promise<InstallResult> {
  const db = getDb(env.DB);

  const repoAccess = await checkRepoAccess(env, options.repoId, userId);
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

  if (!env.GIT_OBJECTS) {
    throw new Error('Storage not configured');
  }

  const object = await env.GIT_OBJECTS.get(takopackAsset.r2_key);
  if (!object) {
    throw new Error('Asset file not found in storage');
  }

  const takopackData = await object.arrayBuffer();

  return installBundleFn(spaceId, userId, takopackData, {
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

/**
 * Install from a stored package (R2 bucket).
 */
export async function installFromStoredPackage(
  env: Env,
  installFn: (
    spaceId: string,
    userId: string,
    takopackData: ArrayBuffer,
    options?: {
      replaceBundleDeploymentId?: string;
      installAction?: 'install' | 'update' | 'rollback';
      requireAutoEnvApproval?: boolean;
      oauthAutoEnvApproved?: boolean;
      takosBaseUrl?: string;
      source?: {
        type: 'git' | 'upload';
        repoId?: string;
        tag?: string;
        assetId?: string;
      };
    },
  ) => Promise<InstallResult>,
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
  const bucket = env.WORKER_BUNDLES || env.GIT_OBJECTS || null;
  if (!bucket) {
    throw new Error('Package storage is not configured');
  }

  const r2Key = storedAssetRef.replace(/^internal:/, '');
  const object = await bucket.get(r2Key);
  if (!object) {
    throw new Error(`Stored package not found: ${storedAssetRef}`);
  }

  const takopackData = await object.arrayBuffer();
  return installFn(spaceId, userId, takopackData, {
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
