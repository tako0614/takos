import { getDb } from '../../../infra/db';
import {
  bundleDeployments,
  bundleDeploymentEvents,
  shortcutGroups,
  uiExtensions,
  mcpServers,
} from '../../../infra/db/schema';
import { eq, and, lt, desc } from 'drizzle-orm';
import type { Env } from '../../../shared/types';

import type {
  InstallResult,
  GitInstallOptions,
} from '../takopack/types';
import { decodeSourceRef } from './app-deployments';
import { toBundleDeploymentListItem } from '../takopack/bundle-deployment-utils';
import { getBundleWorkerHostnames } from './bundle-deployment-install';
import { toLegacyBundleDeploymentListRecord } from './bundle-deployment-types';

export async function listBundleDeployments(env: Env, spaceId: string) {
  const db = getDb(env.DB);
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

export async function getBundleDeployment(env: Env, spaceId: string, bundleDeploymentId: string) {
  const db = getDb(env.DB);

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
  const hostnames = await getBundleWorkerHostnames(env, spaceId, bundleDeploymentId);

  return {
    ...toLegacyBundleDeploymentListRecord(bundleDeployment),
    manifestJson: bundleDeployment.manifestJson,
    hostnames,
    groups,
    uiExtensions: uiExts,
    mcpServers: mcpServerRows,
  };
}

export async function rollbackToPrevious(
  env: Env,
  installFromStoredPackageFn: (
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
  ) => Promise<InstallResult>,
  installFromGitFn: (
    spaceId: string,
    userId: string,
    options: GitInstallOptions,
  ) => Promise<InstallResult>,
  spaceId: string,
  userId: string,
  bundleDeploymentId: string,
  options?: {
    requireAutoEnvApproval?: boolean;
    oauthAutoEnvApproved?: boolean;
    takosBaseUrl?: string;
  },
): Promise<{ previousVersion: string; targetVersion: string; installed: InstallResult }> {
  const db = getDb(env.DB);
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
  const prevSourceRef = decodeSourceRef(prev.sourceTag);
  if (prev.sourceType === 'git' && prev.sourceRepoId && prevSourceRef.commit_sha) {
    // Re-deploy from the pinned commit SHA (no stored ZIP needed)
    const { AppDeploymentService } = await import('./app-deployments');
    const appDeployService = new AppDeploymentService(env);
    const deployResult = await appDeployService.deployFromRepoRef(spaceId, userId, {
      repoId: prev.sourceRepoId,
      ref: prevSourceRef.commit_sha,
      refType: 'commit',
    });
    installed = {
      bundleDeploymentId: deployResult.app_deployment_id,
      appId: deployResult.app_id,
      name: deployResult.name,
      version: deployResult.version,
      applyReport: deployResult.apply_report,
      resourcesCreated: deployResult.resources_created,
      groupsCreated: 0,
      toolsCreated: 0,
    };
  } else if (prev.sourceAssetId?.startsWith('internal:')) {
    // Legacy path: stored ZIP in R2
    installed = await installFromStoredPackageFn(spaceId, userId, prev.sourceAssetId, {
      replaceBundleDeploymentId: bundleDeployment.id,
      installAction: 'rollback',
      requireAutoEnvApproval: options?.requireAutoEnvApproval,
      oauthAutoEnvApproved: options?.oauthAutoEnvApproved,
      takosBaseUrl: options?.takosBaseUrl,
      sourceRepoId: prev.sourceRepoId,
      sourceRef: prev.sourceTag,
    });
  } else if (prev.sourceType === 'git' && prev.sourceRepoId && prev.sourceTag) {
    installed = await installFromGitFn(spaceId, userId, {
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
