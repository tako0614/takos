import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { D1Database, Fetcher, R2Bucket } from '../shared/types/bindings.ts';
import type { WorkerBinding } from '../application/services/wfp/index.ts';
import { deployments, getDb } from '../infra/db/index.ts';
import { services } from '../infra/db/schema-services';
import { decrypt, decryptEnvVars, type EncryptedData } from '../shared/utils/crypto.ts';
import type { ServiceTargetMap } from './url-registry.ts';

export type FetcherLike = Fetcher;

export type LocalTenantWorkerRegistryOptions = {
  db: D1Database;
  workerBundles?: R2Bucket;
  encryptionKey?: string;
  bundleCacheRoot?: string | null;
  persistRoot?: string | null;
  serviceTargets?: ServiceTargetMap;
  /** PostgreSQL pool for pgvector-backed Vectorize bindings. */
  pgPool?: { query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }> };
  /** OpenAI API key for AI bindings. */
  openAiApiKey?: string;
  /** OpenAI-compatible base URL for AI bindings. */
  openAiBaseUrl?: string;
  /** OTEL collector endpoint for Analytics Engine bindings. */
  otelEndpoint?: string;
};

export type DeploymentRuntimeRecord = {
  id: string;
  serviceId: string;
  routeRef: string;
  artifactRef: string;
  bundleR2Key: string;
  wasmR2Key: string | null;
  runtimeConfigSnapshotJson: string;
  bindingsSnapshotEncrypted: string | null;
  envVarsSnapshotEncrypted: string | null;
};

export type WorkerRuntimeConfigSnapshot = {
  compatibility_date?: string;
  compatibility_flags?: string[];
};

export type PreparedBundle = {
  bundleContent: string;
  workerDir: string;
  scriptPath: string;
};

const LOCAL_ROUTING_STATUSES = ['active', 'canary', 'rollback'] as const;

export function resolveRoot(explicit: string | null | undefined, suffix: string): string {
  return explicit && explicit.trim()
    ? path.resolve(explicit)
    : path.resolve(os.tmpdir(), 'takos-miniflare', suffix);
}

export function sanitizeWorkerRef(workerRef: string): string {
  return workerRef.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function parseRuntimeConfig(raw: string | null | undefined): WorkerRuntimeConfigSnapshot {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      compatibility_date: typeof parsed.compatibility_date === 'string' ? parsed.compatibility_date : undefined,
      compatibility_flags: Array.isArray(parsed.compatibility_flags)
        ? parsed.compatibility_flags.filter((value): value is string => typeof value === 'string')
        : undefined,
    };
  } catch {
    return {};
  }
}

function deploymentMatchesWorkerRef(deployment: DeploymentRuntimeRecord, workerRef: string): boolean {
  return deployment.routeRef === workerRef || deployment.artifactRef === workerRef;
}

function parseDeploymentRouteRef(targetJson: string | null | undefined): string | null {
  if (!targetJson) return null;
  try {
    const parsed = JSON.parse(targetJson) as Record<string, unknown>;
    if (typeof parsed.route_ref === 'string' && parsed.route_ref.trim()) {
      return parsed.route_ref.trim();
    }
    const endpoint = parsed.endpoint;
    if (endpoint && typeof endpoint === 'object') {
      const endpointRecord = endpoint as Record<string, unknown>;
      if (endpointRecord.kind === 'service-ref' && typeof endpointRecord.ref === 'string' && endpointRecord.ref.trim()) {
        return endpointRecord.ref.trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function decryptBindingsSnapshot(
  deployment: DeploymentRuntimeRecord,
  encryptionKey: string | undefined,
): Promise<WorkerBinding[]> {
  if (!deployment.bindingsSnapshotEncrypted) return [];
  if (!encryptionKey) {
    throw new Error(`ENCRYPTION_KEY is required to load bindings for ${deployment.artifactRef}`);
  }

  const encryptedParsed = JSON.parse(deployment.bindingsSnapshotEncrypted) as EncryptedData;
  const decrypted = await decrypt(encryptedParsed, encryptionKey, deployment.id);
  const bindings = JSON.parse(decrypted) as unknown;
  if (!Array.isArray(bindings)) {
    throw new Error(`Invalid bindings snapshot for ${deployment.artifactRef}`);
  }
  return bindings as WorkerBinding[];
}

export async function decryptEnvVarSnapshot(
  deployment: DeploymentRuntimeRecord,
  encryptionKey: string | undefined,
): Promise<Record<string, string>> {
  if (!deployment.envVarsSnapshotEncrypted) return {};
  if (!encryptionKey) {
    throw new Error(`ENCRYPTION_KEY is required to load env vars for ${deployment.artifactRef}`);
  }
  return decryptEnvVars(deployment.envVarsSnapshotEncrypted, encryptionKey, deployment.id);
}

export async function resolveDeploymentRuntime(
  dbBinding: D1Database,
  workerRef: string,
  options?: { deploymentId?: string },
): Promise<DeploymentRuntimeRecord | null> {
  const db = getDb(dbBinding);
  if (options?.deploymentId) {
    const byDeploymentId = await db.select({
      id: deployments.id,
      serviceId: deployments.serviceId,
      routeRef: services.routeRef,
      artifactRef: deployments.artifactRef,
      bundleR2Key: deployments.bundleR2Key,
      wasmR2Key: deployments.wasmR2Key,
      runtimeConfigSnapshotJson: deployments.runtimeConfigSnapshotJson,
      bindingsSnapshotEncrypted: deployments.bindingsSnapshotEncrypted,
      envVarsSnapshotEncrypted: deployments.envVarsSnapshotEncrypted,
    })
      .from(deployments)
      .innerJoin(services, eq(services.id, deployments.serviceId))
      .where(and(
        eq(deployments.id, options.deploymentId),
        inArray(deployments.routingStatus, LOCAL_ROUTING_STATUSES),
      ))
      .get();

    if (byDeploymentId?.artifactRef && byDeploymentId.bundleR2Key) {
      const resolvedDeployment = {
        id: byDeploymentId.id,
        serviceId: byDeploymentId.serviceId,
        routeRef: byDeploymentId.routeRef ?? workerRef,
        artifactRef: byDeploymentId.artifactRef,
        bundleR2Key: byDeploymentId.bundleR2Key,
        wasmR2Key: byDeploymentId.wasmR2Key,
        runtimeConfigSnapshotJson: byDeploymentId.runtimeConfigSnapshotJson,
        bindingsSnapshotEncrypted: byDeploymentId.bindingsSnapshotEncrypted,
        envVarsSnapshotEncrypted: byDeploymentId.envVarsSnapshotEncrypted,
      };

      if (!deploymentMatchesWorkerRef(resolvedDeployment, workerRef)) {
        throw new Error(
          `Deployment ${options.deploymentId} does not belong to local tenant worker ${workerRef}`,
        );
      }

      return resolvedDeployment;
    }

    return null;
  }

  const byArtifact = await db.select({
    id: deployments.id,
    serviceId: deployments.serviceId,
    routeRef: services.routeRef,
    artifactRef: deployments.artifactRef,
    bundleR2Key: deployments.bundleR2Key,
    wasmR2Key: deployments.wasmR2Key,
    runtimeConfigSnapshotJson: deployments.runtimeConfigSnapshotJson,
    bindingsSnapshotEncrypted: deployments.bindingsSnapshotEncrypted,
    envVarsSnapshotEncrypted: deployments.envVarsSnapshotEncrypted,
  })
    .from(deployments)
    .innerJoin(services, eq(services.id, deployments.serviceId))
    .where(and(
      eq(deployments.artifactRef, workerRef),
      inArray(deployments.routingStatus, LOCAL_ROUTING_STATUSES),
    ))
    .orderBy(desc(deployments.version))
    .get();

  if (byArtifact?.artifactRef && byArtifact.bundleR2Key) {
    return {
      id: byArtifact.id,
      serviceId: byArtifact.serviceId,
      routeRef: byArtifact.routeRef ?? workerRef,
      artifactRef: byArtifact.artifactRef,
      bundleR2Key: byArtifact.bundleR2Key,
      wasmR2Key: byArtifact.wasmR2Key,
      runtimeConfigSnapshotJson: byArtifact.runtimeConfigSnapshotJson,
      bindingsSnapshotEncrypted: byArtifact.bindingsSnapshotEncrypted,
      envVarsSnapshotEncrypted: byArtifact.envVarsSnapshotEncrypted,
    };
  }

  const byWorker = await db.select({
    id: deployments.id,
    serviceId: deployments.serviceId,
    routeRef: services.routeRef,
    artifactRef: deployments.artifactRef,
    bundleR2Key: deployments.bundleR2Key,
    wasmR2Key: deployments.wasmR2Key,
    runtimeConfigSnapshotJson: deployments.runtimeConfigSnapshotJson,
    bindingsSnapshotEncrypted: deployments.bindingsSnapshotEncrypted,
    envVarsSnapshotEncrypted: deployments.envVarsSnapshotEncrypted,
  })
    .from(services)
    .innerJoin(deployments, eq(deployments.id, services.activeDeploymentId))
    .where(eq(services.routeRef, workerRef))
    .get();

  if (byWorker?.artifactRef && byWorker.bundleR2Key) {
    return {
      id: byWorker.id,
      serviceId: byWorker.serviceId,
      routeRef: byWorker.routeRef ?? workerRef,
      artifactRef: byWorker.artifactRef,
      bundleR2Key: byWorker.bundleR2Key,
      wasmR2Key: byWorker.wasmR2Key,
      runtimeConfigSnapshotJson: byWorker.runtimeConfigSnapshotJson,
      bindingsSnapshotEncrypted: byWorker.bindingsSnapshotEncrypted,
      envVarsSnapshotEncrypted: byWorker.envVarsSnapshotEncrypted,
    };
  }

  const candidateDeployments = await db.select({
    id: deployments.id,
    serviceId: deployments.serviceId,
    serviceRouteRef: services.routeRef,
    artifactRef: deployments.artifactRef,
    bundleR2Key: deployments.bundleR2Key,
    wasmR2Key: deployments.wasmR2Key,
    runtimeConfigSnapshotJson: deployments.runtimeConfigSnapshotJson,
    bindingsSnapshotEncrypted: deployments.bindingsSnapshotEncrypted,
    envVarsSnapshotEncrypted: deployments.envVarsSnapshotEncrypted,
    targetJson: deployments.targetJson,
  })
    .from(deployments)
    .innerJoin(services, eq(services.id, deployments.serviceId))
    .where(inArray(deployments.routingStatus, LOCAL_ROUTING_STATUSES))
    .orderBy(desc(deployments.version))
    .all();

  const matchedDeployments = candidateDeployments.filter((deployment) => {
    const deploymentRouteRef = parseDeploymentRouteRef(deployment.targetJson);
    return deploymentRouteRef === workerRef;
  });

  if (matchedDeployments.length > 1) {
    throw new Error(`Ambiguous local tenant route ref: ${workerRef}`);
  }

  const matchedDeployment = matchedDeployments[0];

  if (!matchedDeployment?.artifactRef || !matchedDeployment.bundleR2Key) return null;
  return {
    id: matchedDeployment.id,
    serviceId: matchedDeployment.serviceId,
    routeRef: matchedDeployment.serviceRouteRef ?? workerRef,
    artifactRef: matchedDeployment.artifactRef,
    bundleR2Key: matchedDeployment.bundleR2Key,
    wasmR2Key: matchedDeployment.wasmR2Key,
    runtimeConfigSnapshotJson: matchedDeployment.runtimeConfigSnapshotJson,
    bindingsSnapshotEncrypted: matchedDeployment.bindingsSnapshotEncrypted,
    envVarsSnapshotEncrypted: matchedDeployment.envVarsSnapshotEncrypted,
  };
}

export async function loadBundleContent(
  workerBundles: R2Bucket,
  deployment: DeploymentRuntimeRecord,
  bundleCacheRoot: string,
): Promise<PreparedBundle> {
  const bundleObject = await workerBundles.get(deployment.bundleR2Key);
  if (!bundleObject) {
    throw new Error(`Bundle not found at ${deployment.bundleR2Key}`);
  }

  const bundleContent = await bundleObject.text();
  const workerDir = path.join(bundleCacheRoot, sanitizeWorkerRef(deployment.artifactRef));
  await mkdir(workerDir, { recursive: true });
  const scriptPath = path.join(workerDir, 'bundle.mjs');
  await writeFile(scriptPath, bundleContent, 'utf8');

  if (deployment.wasmR2Key) {
    const wasmObject = await workerBundles.get(deployment.wasmR2Key);
    if (wasmObject) {
      await writeFile(path.join(workerDir, 'module.wasm'), Buffer.from(await wasmObject.arrayBuffer()));
    }
  }

  return {
    bundleContent,
    workerDir,
    scriptPath,
  };
}

export function createMissingBindingFetcher(kind: string, name: string): Fetcher {
  return {
    async fetch(): Promise<Response> {
      return Response.json({
        error: `Local ${kind} target not configured`,
        target: name,
      }, { status: 503 });
    },
    connect(): never {
      throw new Error(`Local ${kind} target not configured: ${name}`);
    },
  } as unknown as Fetcher;
}

export function normalizeFetcherInput(
  input: RequestInfo | URL,
  init?: RequestInit,
): [string | URL, RequestInit | undefined] {
  if (input instanceof Request) {
    const body = input.method === 'GET' || input.method === 'HEAD'
      ? undefined
      : input.clone().body;
    return [input.url, {
      method: input.method,
      headers: input.headers,
      body,
      redirect: input.redirect,
    }];
  }

  return [input, init];
}
