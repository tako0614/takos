import { nanoid } from 'nanoid';
import type { Database } from '../../../infra/db';
import {
  bundleDeployments,
  bundleDeploymentEvents,
  deployments,
  shortcutGroups,
  shortcutGroupItems,
  fileHandlers,
  fileHandlerMatchers,
} from '../../../infra/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { now } from '../../../shared/utils';
import { deleteManagedMcpServersByBundleDeployment } from '../platform/mcp';
import { upsertHostnameRouting } from '../routing';
import { bestEffort, CompensationTracker, cleanupDeployedWorkers, cleanupProvisionedResources } from './compensation';
import { buildProvisionedResourceReferenceMaps, type BundleShortcutGroupService } from './groups';
import type { BundleManagedMcpService } from './tools';
import type {
  InstallResult,
  ResourceProvisionResult,
  TakopackApplyReportEntry,
  TakopackManifest,
  WorkerDeploymentResult,
} from './types';
import { provisionOAuthClient } from './provisioner';
import type { TakopackResourceService } from './resources';
import type { CommonEnvService } from '../common-env';
import { TAKOS_ACCESS_TOKEN_ENV_NAME } from '../common-env';
import type { InfraService } from '../platform/infra';
import type { TakopackWorkerService } from './workers';
import { buildNamespacedInfraName, getUserPrincipalId } from './bundle-deployment-utils';

type InstallPipelineOptions = {
  replaceBundleDeploymentId?: string;
  takosBaseUrl?: string;
  hostname?: string;
  installAction?: 'install' | 'update' | 'rollback';
  source?: {
    type: 'git' | 'upload';
    repoId?: string;
    tag?: string;
    assetId?: string;
  };
  envOverrides?: Record<string, string>;
  serviceBindingOverrides?: Record<string, string>;
};

export type BundleInstallPipelineParams = {
  env: Env;
  db: Database;
  resourceService: TakopackResourceService;
  workerService: TakopackWorkerService;
  toolService: BundleManagedMcpService;
  groupService: BundleShortcutGroupService;
  commonEnvService: CommonEnvService;
  infraService: InfraService;
  spaceId: string;
  userId: string;
  bundleDeploymentId: string;
  installKey: string;
  manifest: TakopackManifest;
  semver: { major: number; minor: number; patch: number };
  files: Map<string, ArrayBuffer>;
  normalizedApplyReport: TakopackApplyReportEntry[];
  replacedBundleDeploymentId: string | null;
  requiredEnvKeys: string[];
  appBaseUrlForAutoEnv: string | null;
  tracker: CompensationTracker;
  hostname: string;
  options?: InstallPipelineOptions;
};

export async function executeBundleInstallPipeline(params: BundleInstallPipelineParams): Promise<InstallResult> {
  const {
    env,
    db,
    resourceService,
    workerService,
    toolService,
    groupService,
    commonEnvService,
    infraService,
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
    hostname,
  } = params;

  const userPrincipalId = await getUserPrincipalId(db, userId);

  const deployedAt = now();
  const deploymentRecord = {
    accountId: spaceId,
    name: manifest.meta.name,
    appId: manifest.meta.appId,
    bundleKey: installKey,
    version: manifest.meta.version,
    versionMajor: semver.major,
    versionMinor: semver.minor,
    versionPatch: semver.patch,
    description: manifest.meta.description,
    icon: manifest.meta.icon,
    manifestJson: JSON.stringify(manifest),
    deployedByAccountId: userPrincipalId,
    deployedAt,
    sourceType: options?.source?.type,
    sourceRepoId: options?.source?.repoId,
    sourceTag: options?.source?.tag,
    sourceAssetId: options?.source?.assetId,
  };

  const isReplacingCurrentDeployment = replacedBundleDeploymentId === bundleDeploymentId;
  if (isReplacingCurrentDeployment) {
    const previousDeployment = await db.select({
      accountId: bundleDeployments.accountId,
      name: bundleDeployments.name,
      appId: bundleDeployments.appId,
      bundleKey: bundleDeployments.bundleKey,
      version: bundleDeployments.version,
      versionMajor: bundleDeployments.versionMajor,
      versionMinor: bundleDeployments.versionMinor,
      versionPatch: bundleDeployments.versionPatch,
      description: bundleDeployments.description,
      icon: bundleDeployments.icon,
      manifestJson: bundleDeployments.manifestJson,
      deployedByAccountId: bundleDeployments.deployedByAccountId,
      deployedAt: bundleDeployments.deployedAt,
      sourceType: bundleDeployments.sourceType,
      sourceRepoId: bundleDeployments.sourceRepoId,
      sourceTag: bundleDeployments.sourceTag,
      sourceAssetId: bundleDeployments.sourceAssetId,
      oauthClientId: bundleDeployments.oauthClientId,
      isLocked: bundleDeployments.isLocked,
      lockedAt: bundleDeployments.lockedAt,
      lockedByAccountId: bundleDeployments.lockedByAccountId,
    }).from(bundleDeployments).where(eq(bundleDeployments.id, bundleDeploymentId)).get();
    if (!previousDeployment) {
      throw new Error('Bundle deployment not found for replacement');
    }
    await db.update(bundleDeployments).set(deploymentRecord).where(eq(bundleDeployments.id, bundleDeploymentId));
    tracker.add('restore previous bundle deployment record', async () => {
      await bestEffort(
        () => db.update(bundleDeployments).set(previousDeployment).where(eq(bundleDeployments.id, bundleDeploymentId)),
        '[BundleDeploymentOrchestrator] compensation failed: restore previous bundle deployment record',
      );
    });
  } else {
    await db.insert(bundleDeployments).values({
      id: bundleDeploymentId,
      ...deploymentRecord,
    });
    tracker.add('delete bundle deployment record', async () => {
      await bestEffort(
        () => db.delete(bundleDeployments).where(eq(bundleDeployments.id, bundleDeploymentId)),
        '[BundleDeploymentOrchestrator] compensation failed: delete bundle deployment record',
      );
    });
  }

  const installationId = nanoid();
  const installAction = options?.installAction ?? (replacedBundleDeploymentId ? 'update' : 'install');
  await db.insert(bundleDeploymentEvents).values({
    id: installationId,
    accountId: spaceId,
    bundleDeploymentId: bundleDeploymentId,
    name: manifest.meta.name,
    appId: manifest.meta.appId,
    bundleKey: installKey,
    version: manifest.meta.version,
    deployAction: installAction,
    deployedAt,
    deployedByAccountId: userPrincipalId,
    sourceType: options?.source?.type,
    sourceRepoId: options?.source?.repoId,
    sourceTag: options?.source?.tag,
    sourceAssetId: options?.source?.assetId,
    replacedBundleDeploymentId: replacedBundleDeploymentId,
  });
  tracker.add('delete bundle deployment event', async () => {
    await bestEffort(
      () => db.delete(bundleDeploymentEvents).where(eq(bundleDeploymentEvents.id, installationId)),
      '[BundleDeploymentOrchestrator] compensation failed: delete bundle deployment event',
    );
  });

  let groupsCreated = 0;
  let toolsCreated = 0;
  let resourcesCreated = { d1: 0, r2: 0, kv: 0 };
  const appliedEntries: TakopackApplyReportEntry[] = normalizedApplyReport
    .filter((entry) => entry.phase === 'planned')
    .map((entry) => ({
      objectName: entry.objectName,
      kind: entry.kind,
      phase: 'applied' as const,
      status: 'success' as const,
      message: entry.message,
    }));
  const deployedWorkerIdByRef = new Map<string, string>();

  let provisionedResources: ResourceProvisionResult | undefined;
  if (manifest.resources) {
    provisionedResources = await resourceService.provisionOrAdoptResources(
      spaceId,
      userId,
      manifest.meta.name,
      installKey,
      bundleDeploymentId,
      manifest.resources,
      files,
    );
    resourcesCreated = {
      d1: provisionedResources.d1.length,
      r2: provisionedResources.r2.length,
      kv: provisionedResources.kv.length,
    };
    tracker.add('cleanup provisioned resources', async () => {
      await cleanupProvisionedResources(env, provisionedResources!);
    });
  }

  const oauthResult = await provisionOAuthClient({
    env,
    manifest,
    spaceId,
    userId,
    hostname,
    bundleDeploymentId,
    appBaseUrlForAutoEnv,
    tracker,
  });
  const oauthClientId = oauthResult.clientId;

  let deployedWorkers: WorkerDeploymentResult[] = [];
  if (manifest.workers?.length) {
    const sharedEnv = { ...(options?.envOverrides || {}) };

    deployedWorkers = await workerService.deployManifestWorkers({
      spaceId,
      takopackId: bundleDeploymentId,
      packageName: manifest.meta.name,
      capabilities: manifest.capabilities || [],
      workers: manifest.workers,
      files,
      sharedEnv,
      provisionedResources,
      oauthClientId: manifest.oauth?.autoEnv ? oauthClientId : undefined,
      oauthClientSecret: manifest.oauth?.autoEnv ? oauthResult.clientSecret : undefined,
      hostnameHint: hostname,
      serviceBindingOverrides: options?.serviceBindingOverrides,
    });

    for (const deployed of deployedWorkers) {
      deployedWorkerIdByRef.set(deployed.manifestWorkerName, deployed.workerId);
      deployedWorkerIdByRef.set(deployed.workerName, deployed.workerId);
      deployedWorkerIdByRef.set(deployed.slug, deployed.workerId);
      deployedWorkerIdByRef.set(deployed.workerId, deployed.workerId);
    }

    tracker.add('cleanup deployed workers', async () => {
      await cleanupDeployedWorkers(env, deployedWorkers);
    });

    if (requiredEnvKeys.length > 0) {
      const deployedWorkerIds = deployedWorkers.map((worker) => worker.workerId);
      await commonEnvService.ensureRequiredLinks({
        spaceId,
        workerIds: deployedWorkerIds,
        keys: requiredEnvKeys,
        actor: {
          type: 'user',
          userId,
        },
      });
      if (
        requiredEnvKeys.includes(TAKOS_ACCESS_TOKEN_ENV_NAME)
        && manifest.takos?.scopes?.length
      ) {
        for (const workerId of deployedWorkerIds) {
          await commonEnvService.upsertWorkerTakosAccessTokenConfig({
            spaceId,
            workerId,
            scopes: manifest.takos.scopes,
          });
        }
      }
      await commonEnvService.reconcileWorkers({
        spaceId,
        workerIds: deployedWorkerIds,
        keys: requiredEnvKeys,
      });
    }
  }

  for (const deployedWorker of deployedWorkers) {
    await infraService.upsertWorker({
      spaceId,
      bundleDeploymentId,
      name: buildNamespacedInfraName(deployedWorker.manifestWorkerName, installKey),
      runtime: 'cloudflare.worker',
      cloudflareServiceRef: deployedWorker.artifactRef,
    });
  }

  if (manifest.endpoints?.length) {
    for (const endpoint of manifest.endpoints) {
      await infraService.upsertEndpoint({
        spaceId,
        bundleDeploymentId,
        name: buildNamespacedInfraName(endpoint.name, installKey),
        protocol: endpoint.protocol,
        targetServiceRef: buildNamespacedInfraName(endpoint.targetRef, installKey),
        routes: endpoint.routes,
        timeoutMs: endpoint.timeoutMs,
      });
    }

    const routingTarget = await infraService.buildRoutingTarget(spaceId, bundleDeploymentId);
    if (routingTarget) {
      await upsertHostnameRouting({
        env,
        hostname: hostname.toLowerCase(),
        target: routingTarget,
      });
    }
  }

  const provisionedResourceRefs = buildProvisionedResourceReferenceMaps(provisionedResources);
  if (manifest.group) {
    const groupId = await groupService.createShortcutGroup(
      spaceId,
      bundleDeploymentId,
      manifest,
      {
        workers: deployedWorkerIdByRef,
        resources: provisionedResourceRefs,
      },
    );
    groupsCreated = 1;
    tracker.add('delete shortcut group', async () => {
      await bestEffort(
        () => db.delete(shortcutGroupItems).where(eq(shortcutGroupItems.groupId, groupId)),
        '[BundleDeploymentOrchestrator] compensation failed: delete shortcut group items',
      );
      await bestEffort(
        () => db.delete(shortcutGroups).where(eq(shortcutGroups.id, groupId)),
        '[BundleDeploymentOrchestrator] compensation failed: delete shortcut group',
      );
    });
  }

  if (manifest.mcpServers) {
    for (const server of manifest.mcpServers) {
      await toolService.registerManagedMcpServer(
        spaceId,
        bundleDeploymentId,
        installKey,
        server,
        deployedWorkerIdByRef,
      );
      toolsCreated++;
    }
    tracker.add('delete managed MCP servers', async () => {
      await bestEffort(
        () => deleteManagedMcpServersByBundleDeployment(env.DB, spaceId, bundleDeploymentId),
        '[BundleDeploymentOrchestrator] compensation failed: delete managed MCP servers',
      );
    });
  }

  if (manifest.fileHandlers?.length && deployedWorkers.length > 0) {
    const primaryWorker = deployedWorkers[0];
    const registeredHandlerIds: string[] = [];
    for (const handler of manifest.fileHandlers) {
      const handlerId = nanoid();
      await db.insert(fileHandlers).values({
        id: handlerId,
        accountId: spaceId,
        bundleDeploymentId: bundleDeploymentId,
        serviceHostname: primaryWorker.hostname,
        name: handler.name,
        openPath: handler.openPath,
        createdAt: now(),
      });

      const matcherValues = [
        ...(handler.mimeTypes || []).map((value) => ({ fileHandlerId: handlerId, kind: 'mime', value })),
        ...(handler.extensions || []).map((value) => ({ fileHandlerId: handlerId, kind: 'extension', value })),
      ];
      if (matcherValues.length > 0) {
        await db.insert(fileHandlerMatchers).values(matcherValues);
      }

      registeredHandlerIds.push(handlerId);
    }
    tracker.add('delete file handlers', async () => {
      for (const handlerId of registeredHandlerIds) {
        await bestEffort(
          () => db.delete(fileHandlers).where(eq(fileHandlers.id, handlerId)),
          `[BundleDeploymentOrchestrator] compensation failed: delete file handler ${handlerId}`,
        );
      }
    });
  }

  // Initiate staged rollout if manifest declares one
  let rolloutInitiated = false;
  if (manifest.rollout?.strategy === 'staged' && deployedWorkers.length > 0) {
    const { RolloutService } = await import('../platform/rollout');
    const rollout = new RolloutService(env);

    // Find the active deployment for this service to get the old artifact ref
    const primaryWorker = deployedWorkers[0];
    const activeDeployment = await db.select({
      id: deployments.id,
      artifactRef: deployments.artifactRef,
    }).from(deployments).where(
      and(
        eq(deployments.serviceId, primaryWorker.workerId),
        eq(deployments.routingStatus, 'active'),
      )
    ).get();

    if (activeDeployment?.artifactRef) {
      await rollout.initiateRollout({
        bundleDeploymentId,
        rolloutSpec: manifest.rollout,
        deploymentId: activeDeployment.id,
        serviceId: primaryWorker.workerId,
        hostname,
        activeDeploymentArtifactRef: activeDeployment.artifactRef,
        newDeploymentArtifactRef: primaryWorker.artifactRef,
      });
      rolloutInitiated = true;
    }
  }

  return {
    bundleDeploymentId,
    appId: manifest.meta.appId,
    name: manifest.meta.name,
    version: manifest.meta.version,
    groupsCreated,
    toolsCreated,
    resourcesCreated,
    rolloutInitiated,
    applyReport: [
      ...normalizedApplyReport,
      ...appliedEntries,
    ],
    oauthClientId,
    sourceType: options?.source?.type,
    sourceRepoId: options?.source?.repoId,
    sourceTag: options?.source?.tag,
    sourceAssetId: options?.source?.assetId,
  };
}
