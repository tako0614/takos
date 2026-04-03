import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import type {
  InsertOf,
  SelectOf,
} from "../../../shared/types/drizzle-utils.ts";
import {
  deploymentEvents,
  deployments,
  getDb,
  serviceCustomDomains,
  serviceDeployments,
  services,
} from "../../../infra/db/index.ts";
import { and, asc, desc, eq, inArray, isNotNull, lt, max } from "drizzle-orm";
import type { ArtifactKind, Deployment, DeploymentEvent } from "./models.ts";
import { textDateNullable } from "../../../shared/utils/db-guards.ts";

type DeploymentInsert = InsertOf<typeof deployments>;
type DeploymentUpdate = Partial<InsertOf<typeof deployments>>;

export type DeploymentRow = SelectOf<typeof deployments>;

export const deploymentStoreDeps = {
  getDb,
};

export function toApiDeployment(d: DeploymentRow): Deployment {
  return {
    id: d.id,
    service_id: d.serviceId,
    space_id: d.accountId,
    version: d.version,
    artifact_ref: d.artifactRef,
    artifact_kind: (d.artifactKind || "worker-bundle") as ArtifactKind,
    bundle_r2_key: d.bundleR2Key,
    bundle_hash: d.bundleHash,
    bundle_size: d.bundleSize,
    wasm_r2_key: d.wasmR2Key,
    wasm_hash: d.wasmHash,
    assets_manifest: d.assetsManifest,
    runtime_config_snapshot_json: d.runtimeConfigSnapshotJson,
    bindings_snapshot_encrypted: d.bindingsSnapshotEncrypted,
    env_vars_snapshot_encrypted: d.envVarsSnapshotEncrypted,
    deploy_state: d.deployState as Deployment["deploy_state"],
    current_step: d.currentStep,
    step_error: d.stepError,
    status: d.status as Deployment["status"],
    routing_status: d.routingStatus as Deployment["routing_status"],
    routing_weight: d.routingWeight,
    deployed_by: d.deployedBy,
    deploy_message: d.deployMessage,
    provider_name: d.providerName as Deployment["provider_name"],
    target_json: d.targetJson,
    provider_state_json: d.providerStateJson,
    idempotency_key: d.idempotencyKey,
    is_rollback: d.isRollback,
    rollback_from_version: d.rollbackFromVersion,
    rolled_back_at: textDateNullable(d.rolledBackAt),
    rolled_back_by: d.rolledBackBy,
    started_at: textDateNullable(d.startedAt),
    completed_at: textDateNullable(d.completedAt),
    created_at: textDateNullable(d.createdAt) || "",
    updated_at: textDateNullable(d.updatedAt) || "",
  };
}

export function getDeploymentServiceId(
  deployment: Pick<Deployment, "service_id" | "worker_id">,
): string {
  return deployment.service_id || deployment.worker_id || "";
}

export async function getLatestDeploymentVersion(
  db: SqlDatabaseBinding,
  serviceId: string,
): Promise<number> {
  const drizzle = deploymentStoreDeps.getDb(db);
  const result = await drizzle.select({ maxVersion: max(deployments.version) })
    .from(deployments)
    .where(eq(serviceDeployments.serviceId, serviceId))
    .get();
  return result?.maxVersion ?? 0;
}

const MAX_VERSION_RETRIES = 3;

export async function createDeploymentWithVersion(
  db: SqlDatabaseBinding,
  serviceId: string,
  buildData: (version: number) => DeploymentInsert,
): Promise<{ deployment: Deployment; version: number }> {
  const drizzle = deploymentStoreDeps.getDb(db);

  for (let attempt = 0; attempt < MAX_VERSION_RETRIES; attempt++) {
    const latestVersion = await getLatestDeploymentVersion(db, serviceId);
    const version = latestVersion + 1;

    try {
      const deployment = await drizzle.insert(deployments)
        .values(buildData(version))
        .returning()
        .get();
      return { deployment: toApiDeployment(deployment), version };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (
        message.includes("UNIQUE constraint failed") ||
        message.includes("unique constraint")
      ) {
        if (attempt < MAX_VERSION_RETRIES - 1) continue;
      }
      throw err;
    }
  }

  throw new Error(
    `Failed to allocate deployment version for service ${serviceId} after ${MAX_VERSION_RETRIES} attempts`,
  );
}

export async function updateDeploymentRecord(
  db: SqlDatabaseBinding,
  deploymentId: string,
  data: DeploymentUpdate,
): Promise<void> {
  const drizzle = deploymentStoreDeps.getDb(db);
  await drizzle.update(deployments)
    .set(data)
    .where(eq(deployments.id, deploymentId))
    .run();
}

export async function updateServiceDeploymentPointers(
  db: SqlDatabaseBinding,
  serviceId: string,
  input: {
    activeDeploymentId: string | null;
    fallbackDeploymentId: string | null;
    activeDeploymentVersion: number | null;
    updatedAt: string;
    status?: string;
  },
): Promise<void> {
  const drizzle = deploymentStoreDeps.getDb(db);
  await drizzle.update(services)
    .set({
      ...(input.status ? { status: input.status } : {}),
      fallbackDeploymentId: input.fallbackDeploymentId,
      activeDeploymentId: input.activeDeploymentId,
      ...(input.activeDeploymentVersion === null
        ? {}
        : { currentVersion: input.activeDeploymentVersion }),
      updatedAt: input.updatedAt,
    })
    .where(eq(services.id, serviceId))
    .run();
}

export async function getDeploymentById(
  db: SqlDatabaseBinding,
  deploymentId: string,
): Promise<Deployment | null> {
  const drizzle = deploymentStoreDeps.getDb(db);
  const deployment = await drizzle.select()
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .get();
  if (!deployment) return null;
  return toApiDeployment(deployment);
}

export async function findDeploymentByArtifactRef(
  db: SqlDatabaseBinding,
  artifactRef: string,
): Promise<Deployment | null> {
  const normalized = String(artifactRef || "").trim();
  if (!normalized) return null;

  const drizzle = deploymentStoreDeps.getDb(db);
  const deployment = await drizzle.select()
    .from(deployments)
    .where(
      and(
        eq(deployments.artifactRef, normalized),
        isNotNull(deployments.bundleR2Key),
        inArray(deployments.status, ["success", "rolled_back"]),
      ),
    )
    .orderBy(desc(deployments.createdAt))
    .get();
  if (!deployment) return null;
  return toApiDeployment(deployment);
}

export async function getDeploymentByIdempotencyKey(
  db: SqlDatabaseBinding,
  serviceId: string,
  idempotencyKey: string,
): Promise<Deployment | null> {
  const drizzle = deploymentStoreDeps.getDb(db);
  const deployment = await drizzle.select()
    .from(deployments)
    .where(
      and(
        eq(serviceDeployments.serviceId, serviceId),
        eq(deployments.idempotencyKey, idempotencyKey),
      ),
    )
    .get();
  if (!deployment) return null;
  return toApiDeployment(deployment);
}

export type ServiceDeploymentBasics = {
  exists: boolean;
  id: string;
  hostname: string | null;
  activeDeploymentId: string | null;
  fallbackDeploymentId: string | null;
  activeDeploymentVersion: number | null;
  workloadKind: string | null;
};

export async function getServiceDeploymentBasics(
  db: SqlDatabaseBinding,
  serviceId: string,
): Promise<ServiceDeploymentBasics> {
  const drizzle = deploymentStoreDeps.getDb(db);
  const service = await drizzle.select({
    id: services.id,
    hostname: services.hostname,
    activeDeploymentId: services.activeDeploymentId,
    fallbackDeploymentId: services.fallbackDeploymentId,
    activeDeploymentVersion: services.currentVersion,
    workloadKind: services.workloadKind,
  })
    .from(services)
    .where(eq(services.id, serviceId))
    .get();

  return service ? { exists: true, ...service } : {
    exists: false,
    id: serviceId,
    hostname: null,
    activeDeploymentId: null,
    fallbackDeploymentId: null,
    activeDeploymentVersion: null,
    workloadKind: null,
  };
}

export type ServiceRollbackInfo = ServiceDeploymentBasics;

export async function getServiceRollbackInfo(
  db: SqlDatabaseBinding,
  serviceId: string,
): Promise<ServiceRollbackInfo | null> {
  const service = await getServiceDeploymentBasics(db, serviceId);
  return service.exists ? service : null;
}

export async function findDeploymentByServiceVersion(
  db: SqlDatabaseBinding,
  serviceId: string,
  version: number,
): Promise<Deployment | null> {
  const drizzle = deploymentStoreDeps.getDb(db);
  const deployment = await drizzle.select()
    .from(deployments)
    .where(
      and(
        eq(serviceDeployments.serviceId, serviceId),
        eq(deployments.version, version),
      ),
    )
    .get();
  if (!deployment) return null;
  return toApiDeployment(deployment);
}

export async function getDeploymentHistory(
  db: SqlDatabaseBinding,
  serviceId: string,
  limit: number,
): Promise<Deployment[]> {
  const drizzle = deploymentStoreDeps.getDb(db);
  const results = await drizzle.select()
    .from(deployments)
    .where(eq(serviceDeployments.serviceId, serviceId))
    .orderBy(desc(deployments.version))
    .limit(limit)
    .all();
  return results.map((deployment) => toApiDeployment(deployment));
}

export async function getDeploymentEvents(
  db: SqlDatabaseBinding,
  deploymentId: string,
): Promise<DeploymentEvent[]> {
  const drizzle = deploymentStoreDeps.getDb(db);
  const events = await drizzle.select()
    .from(deploymentEvents)
    .where(eq(deploymentEvents.deploymentId, deploymentId))
    .orderBy(asc(deploymentEvents.createdAt))
    .all();

  return events.map((e) => ({
    id: e.id,
    deployment_id: e.deploymentId,
    actor_user_id: e.actorAccountId ?? null,
    event_type: e.eventType,
    step_name: e.stepName,
    message: e.message,
    details: e.details,
    created_at: textDateNullable(e.createdAt) || "",
  }));
}

export async function logDeploymentEvent(
  db: SqlDatabaseBinding,
  deploymentId: string,
  eventType: string,
  stepName: string | null,
  message: string | null,
  options?: {
    actorAccountId?: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const drizzle = deploymentStoreDeps.getDb(db);
  await drizzle.insert(deploymentEvents)
    .values({
      deploymentId,
      actorAccountId: options?.actorAccountId ?? null,
      eventType,
      stepName,
      message,
      details: options?.details ? JSON.stringify(options.details) : null,
      createdAt: new Date().toISOString(),
    })
    .run();
}

export async function getStuckDeployments(
  db: SqlDatabaseBinding,
  cutoffIso: string,
): Promise<Deployment[]> {
  const drizzle = getDb(db);
  const results = await drizzle.select()
    .from(deployments)
    .where(
      and(
        eq(deployments.status, "in_progress"),
        isNotNull(deployments.currentStep),
        lt(deployments.updatedAt, cutoffIso),
      ),
    )
    .orderBy(asc(deployments.updatedAt))
    .limit(50)
    .all();
  return results.map((d) => toApiDeployment(d));
}

export type DeploymentRouteHead = {
  exists: boolean;
  id: string;
  hostname: string | null;
  activeDeploymentId: string | null;
};

export async function getDeploymentRouteHead(
  db: SqlDatabaseBinding,
  serviceId: string,
): Promise<DeploymentRouteHead> {
  const drizzle = getDb(db);
  const service = await drizzle.select({
    id: services.id,
    hostname: services.hostname,
    activeDeploymentId: services.activeDeploymentId,
  })
    .from(services)
    .where(eq(services.id, serviceId))
    .get();
  return service ? { exists: true, ...service } : {
    exists: false,
    id: serviceId,
    hostname: null,
    activeDeploymentId: null,
  };
}

export type DeploymentRollbackAnchor = {
  id: string;
  activeDeploymentId: string | null;
  fallbackDeploymentId: string | null;
  activeDeploymentVersion: number | null;
};

export async function getDeploymentRollbackAnchor(
  db: SqlDatabaseBinding,
  serviceId: string,
): Promise<DeploymentRollbackAnchor | null> {
  const drizzle = getDb(db);
  const service = await drizzle.select({
    id: services.id,
    activeDeploymentId: services.activeDeploymentId,
    fallbackDeploymentId: services.fallbackDeploymentId,
  })
    .from(services)
    .where(eq(services.id, serviceId))
    .get();

  if (!service) return null;

  let activeDeploymentVersion: number | null = null;
  if (service.activeDeploymentId) {
    const dep = await drizzle.select({ version: deployments.version })
      .from(deployments)
      .where(eq(deployments.id, service.activeDeploymentId))
      .get();
    activeDeploymentVersion = dep?.version ?? null;
  }

  return {
    id: service.id,
    activeDeploymentId: service.activeDeploymentId,
    fallbackDeploymentId: service.fallbackDeploymentId,
    activeDeploymentVersion,
  };
}

export type DeploymentRoutingServiceRecord = {
  id: string;
  hostname: string | null;
  activeDeploymentId: string | null;
  customDomains: Array<{ domain: string | null }>;
};

export async function getDeploymentRoutingServiceRecord(
  db: SqlDatabaseBinding,
  serviceId: string,
): Promise<DeploymentRoutingServiceRecord | null> {
  const drizzle = getDb(db);
  const service = await drizzle.select({
    id: services.id,
    hostname: services.hostname,
    activeDeploymentId: services.activeDeploymentId,
  })
    .from(services)
    .where(eq(services.id, serviceId))
    .get();

  if (!service) return null;

  const domains = await drizzle.select({ domain: serviceCustomDomains.domain })
    .from(serviceCustomDomains)
    .where(
      and(
        eq(serviceCustomDomains.serviceId, serviceId),
        inArray(serviceCustomDomains.status, ["active", "ssl_pending"]),
      ),
    )
    .all();

  return {
    ...service,
    customDomains: domains,
  };
}
