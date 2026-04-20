/**
 * Worker entity operations for the control plane.
 *
 * Records worker deployment intent in the canonical services table and deletes
 * Cloudflare Worker scripts when removing managed worker entities.
 *
 * Runs inside Cloudflare Workers -- no subprocess / wrangler CLI available.
 */

import { createCloudflareApiClient } from "../cloudflare/api-client.ts";
import type { Env } from "../../../shared/types/env.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import {
  buildManagedRouteRef,
  deleteGroupManagedService,
  findGroupManagedService,
  listGroupManagedServices,
  parseManagedServiceConfig,
  upsertGroupManagedService,
} from "./group-managed-services.ts";
import { recordGroupManagedDeployment } from "./group-managed-deployments.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WorkerEntityResult {
  name: string;
  scriptName: string;
  deployedAt: string;
  codeHash: string;
}

export interface WorkerEntityInfo {
  id: string;
  groupId: string;
  name: string;
  category: string;
  config: WorkerConfig;
  createdAt: string;
  updatedAt: string;
}

interface WorkerConfig {
  scriptName: string;
  deployedAt: string;
  codeHash: string;
  dispatchNamespace?: string;
  specFingerprint?: string;
}

// ---------------------------------------------------------------------------
// Worker deployment intent
// ---------------------------------------------------------------------------

async function deleteWorkerScript(
  client: {
    accountDelete(subpath: string): Promise<unknown>;
  },
  scriptName: string,
  dispatchNamespace?: string,
): Promise<void> {
  const subpath = dispatchNamespace
    ? `/workers/dispatch/namespaces/${dispatchNamespace}/scripts/${scriptName}`
    : `/workers/scripts/${scriptName}`;

  await client.accountDelete(subpath);
}

// ---------------------------------------------------------------------------
// deployWorker
// ---------------------------------------------------------------------------

export async function deployWorker(
  env: Env,
  groupId: string,
  name: string,
  opts: {
    spaceId: string;
    groupName?: string;
    envName?: string;
    codeHash?: string;
    dispatchNamespace?: string;
    specFingerprint?: string;
    desiredSpec?: Record<string, unknown>;
    routeNames?: string[];
    dependsOn?: string[];
    /** If true, skip the actual CF API call (for when the upload is done elsewhere). */
    skipUpload?: boolean;
  },
): Promise<WorkerEntityResult> {
  const envName = opts.envName ?? "default";
  const existing = await findGroupManagedService(env, groupId, name, "worker");
  const scriptName = existing?.row.routeRef ??
    buildManagedRouteRef(groupId, envName, "worker", name);
  const now = new Date().toISOString();
  const codeHash = opts.codeHash ?? "";

  if (!opts.skipUpload) {
    throw new Error(
      "Worker entity deploy requires a real worker artifact from the deployment pipeline or pass skipUpload",
    );
  }

  const record = await upsertGroupManagedService(env, {
    groupId,
    spaceId: opts.spaceId,
    envName,
    componentKind: "worker",
    manifestName: name,
    status: "deployed",
    serviceType: "app",
    workloadKind: "worker-bundle",
    specFingerprint: opts.specFingerprint ?? "",
    desiredSpec: opts.desiredSpec ?? {},
    routeNames: opts.routeNames,
    dependsOn: opts.dependsOn,
    deployedAt: now,
    codeHash,
    dispatchNamespace: opts.dispatchNamespace,
  });

  await recordGroupManagedDeployment(env, {
    serviceId: record.row.id,
    spaceId: opts.spaceId,
    backendName: "workers-dispatch",
    artifactKind: "worker-bundle",
    routeRef: record.row.routeRef,
    specFingerprint: opts.specFingerprint,
    codeHash,
  });

  return { name, scriptName, deployedAt: now, codeHash };
}

// ---------------------------------------------------------------------------
// deleteWorker
// ---------------------------------------------------------------------------

export async function deleteWorker(
  env: Env,
  groupId: string,
  name: string,
): Promise<void> {
  const record = await findGroupManagedService(env, groupId, name, "worker");
  if (!record) {
    throw new Error(`Worker entity "${name}" not found in group ${groupId}`);
  }

  const config = parseManagedServiceConfig(record.row.config) as WorkerConfig;

  try {
    const client = createCloudflareApiClient(env);
    if (client) {
      await deleteWorkerScript(
        client,
        record.row.routeRef ?? config.scriptName,
        config.dispatchNamespace,
      );
    }
  } catch (error) {
    logWarn("Failed to delete CF worker script", {
      module: "worker-ops",
      scriptName: record.row.routeRef ?? config.scriptName,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await deleteGroupManagedService(env, groupId, name, "worker");
}

// ---------------------------------------------------------------------------
// listWorkers
// ---------------------------------------------------------------------------

export async function listWorkers(
  env: Env,
  groupId: string,
): Promise<WorkerEntityInfo[]> {
  const records = await listGroupManagedServices(env, groupId);
  return records
    .filter((record) => record.config.componentKind === "worker")
    .map((record) => ({
      id: record.row.id,
      groupId: record.row.groupId ?? groupId,
      name: record.config.manifestName ?? record.row.slug ?? record.row.id,
      category: "worker",
      config: {
        scriptName: record.row.routeRef ?? "",
        deployedAt: record.config.deployedAt ?? record.row.updatedAt,
        codeHash: record.config.codeHash ?? "",
        ...(record.config.dispatchNamespace
          ? { dispatchNamespace: record.config.dispatchNamespace }
          : {}),
        ...(record.config.specFingerprint
          ? { specFingerprint: record.config.specFingerprint }
          : {}),
      },
      createdAt: record.row.createdAt,
      updatedAt: record.row.updatedAt,
    }));
}
