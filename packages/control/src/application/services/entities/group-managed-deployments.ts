import { and, eq, inArray, ne } from 'drizzle-orm';
import { getDb } from '../../../infra/db/client.ts';
import { deployments, services } from '../../../infra/db/index.ts';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import { logDeploymentEvent, updateServiceDeploymentPointers } from '../deployment/store.ts';
import {
  buildDeploymentArtifactRef,
  resolveDeploymentArtifactBaseRef,
} from '../deployment/artifact-refs.ts';
import type {
  ArtifactKind,
  DeploymentProviderName,
  DeploymentTarget,
} from '../deployment/models.ts';

function generateManagedDeploymentId(): string {
  return crypto.randomUUID();
}

function buildManagedDeploymentTarget(input: {
  routeRef?: string | null;
  artifactKind: ArtifactKind;
  resolvedBaseUrl?: string;
  imageRef?: string;
  port?: number;
}): DeploymentTarget {
  const target: DeploymentTarget = {};
  const routeRef = input.routeRef?.trim();

  if (routeRef) {
    target.route_ref = routeRef;
  }

  if (input.artifactKind === 'worker-bundle' && routeRef) {
    target.endpoint = { kind: 'service-ref', ref: routeRef };
    target.artifact = { kind: 'worker-bundle' };
    return target;
  }

  if (input.resolvedBaseUrl) {
    target.endpoint = { kind: 'http-url', base_url: input.resolvedBaseUrl };
  }

  const artifact: NonNullable<DeploymentTarget['artifact']> = {
    kind: input.artifactKind,
  };

  if (input.imageRef) {
    artifact.image_ref = input.imageRef;
  }
  if (typeof input.port === 'number') {
    artifact.exposed_port = input.port;
  }

  if (Object.keys(artifact).length > 0) {
    target.artifact = artifact;
  }

  return target;
}

export async function recordGroupManagedDeployment(
  env: { DB: SqlDatabaseBinding },
  input: {
    serviceId: string;
    spaceId: string;
    providerName: DeploymentProviderName;
    artifactKind: ArtifactKind;
    routeRef?: string | null;
    specFingerprint?: string;
    codeHash?: string;
    imageHash?: string;
    imageRef?: string;
    port?: number;
    resolvedBaseUrl?: string;
  },
): Promise<{ deploymentId: string; version: number; artifactRef: string }> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();

  const service = await db.select({
    id: services.id,
    activeDeploymentId: services.activeDeploymentId,
    currentVersion: services.currentVersion,
  })
    .from(services)
    .where(eq(services.id, input.serviceId))
    .get();

  if (!service) {
    throw new Error(`Managed service "${input.serviceId}" not found`);
  }

  const version = (service.currentVersion ?? 0) + 1;
  const target = buildManagedDeploymentTarget({
    routeRef: input.routeRef,
    artifactKind: input.artifactKind,
    resolvedBaseUrl: input.resolvedBaseUrl,
    imageRef: input.imageRef,
    port: input.port,
  });
  const artifactRef = buildDeploymentArtifactRef(
    resolveDeploymentArtifactBaseRef(input.serviceId, target),
    version,
  );
  const deploymentId = generateManagedDeploymentId();
  const providerState = input.resolvedBaseUrl
    ? { resolved_endpoint: { kind: 'http-url', base_url: input.resolvedBaseUrl } }
    : {};

  await db.insert(deployments).values({
    id: deploymentId,
    serviceId: input.serviceId,
    accountId: input.spaceId,
    version,
    artifactRef,
    bundleR2Key: null,
    bundleHash: input.artifactKind === 'worker-bundle' ? (input.codeHash ?? input.specFingerprint ?? null) : null,
    bundleSize: null,
    wasmR2Key: null,
    wasmHash: null,
    assetsManifest: null,
    runtimeConfigSnapshotJson: '{}',
    bindingsSnapshotEncrypted: null,
    envVarsSnapshotEncrypted: null,
    deployState: 'completed',
    currentStep: null,
    stepError: null,
    status: 'success',
    routingStatus: 'active',
    routingWeight: 100,
    deployedBy: null,
    deployMessage: 'Applied via group reconciler',
    providerName: input.providerName,
    targetJson: JSON.stringify(target),
    providerStateJson: JSON.stringify(providerState),
    artifactKind: input.artifactKind,
    idempotencyKey: null,
    isRollback: false,
    rollbackFromVersion: null,
    rolledBackAt: null,
    rolledBackBy: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  }).run();

  await db.update(deployments)
    .set({
      routingStatus: 'archived',
      routingWeight: 0,
      updatedAt: now,
    })
    .where(and(
      eq(deployments.serviceId, input.serviceId),
      ne(deployments.id, deploymentId),
      inArray(deployments.routingStatus, ['active', 'canary', 'rollback']),
    ))
    .run();

  await updateServiceDeploymentPointers(env.DB, input.serviceId, {
    status: 'deployed',
    fallbackDeploymentId: service.activeDeploymentId ?? null,
    activeDeploymentId: deploymentId,
    activeDeploymentVersion: version,
    updatedAt: now,
  });

  await logDeploymentEvent(
    env.DB,
    deploymentId,
    'group_apply_deployed',
    null,
    'Deployment recorded by group reconciler',
    {
      details: {
        artifact_ref: artifactRef,
        artifact_kind: input.artifactKind,
        provider_name: input.providerName,
        route_ref: input.routeRef ?? null,
        resolved_base_url: input.resolvedBaseUrl ?? null,
        image_hash: input.imageHash ?? null,
        code_hash: input.codeHash ?? null,
      },
    },
  );

  return { deploymentId, version, artifactRef };
}
