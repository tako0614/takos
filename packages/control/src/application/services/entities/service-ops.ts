/**
 * Service entity operations for the control plane.
 *
 * Manages long-running service records in the canonical services table.
 *
 * The actual deployment-backend selection lives in the deployment pipeline;
 * this wrapper only persists lifecycle intent and optional OCI-orchestrator
 * side effects when configured.
 *
 * Runs inside Cloudflare Workers -- delegates to external runtime backends
 * via fetch. Backend-specific execution is handled by the deployment pipeline
 * and the OCI orchestrator backends.
 */

import type { Env } from "../../../shared/types/env.ts";
import {
  deleteGroupManagedService,
  findGroupManagedService,
  listGroupManagedServices,
  upsertGroupManagedService,
} from "./group-managed-services.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ServiceEntityResult {
  name: string;
  deployedAt: string;
  imageHash: string;
  ipv4?: string;
}

export interface ServiceEntityInfo {
  id: string;
  groupId: string;
  name: string;
  category: string;
  config: ServiceConfig;
  createdAt: string;
  updatedAt: string;
}

interface ServiceConfig {
  deployedAt: string;
  imageHash: string;
  imageRef?: string;
  port?: number;
  ipv4?: string;
  resolvedBaseUrl?: string;
  specFingerprint?: string;
}

// ---------------------------------------------------------------------------
// Service deployment
// ---------------------------------------------------------------------------

/**
 * Deploy a service via the optional OCI orchestrator endpoint.
 *
 * Similar to container-ops but for long-running services that expose
 * a persistent endpoint (e.g. a database proxy, a queue consumer).
 */
async function deployServiceImage(
  env: Env,
  serviceName: string,
  _opts: {
    imageRef?: string;
    port?: number;
  },
): Promise<{ imageHash: string; ipv4?: string }> {
  if (env.OCI_ORCHESTRATOR_URL) {
    const response = await fetch(
      `${env.OCI_ORCHESTRATOR_URL}/services/deploy`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(env.OCI_ORCHESTRATOR_TOKEN
            ? { Authorization: `Bearer ${env.OCI_ORCHESTRATOR_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({
          name: serviceName,
          imageRef: _opts.imageRef,
          port: _opts.port,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Service deploy failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      imageHash?: string;
      ipv4?: string;
    };
    return { imageHash: data.imageHash ?? "", ipv4: data.ipv4 };
  }

  // Stub: no orchestrator configured. Record intent only.
  return { imageHash: "" };
}

async function deleteServiceRuntime(
  env: Env,
  routeRef: string,
  spaceId: string,
): Promise<void> {
  if (env.OCI_ORCHESTRATOR_URL) {
    const response = await fetch(
      `${env.OCI_ORCHESTRATOR_URL}/services/${
        encodeURIComponent(routeRef)
      }/remove?space_id=${encodeURIComponent(spaceId)}`,
      {
        method: "POST",
        headers: {
          ...(env.OCI_ORCHESTRATOR_TOKEN
            ? { Authorization: `Bearer ${env.OCI_ORCHESTRATOR_TOKEN}` }
            : {}),
        },
      },
    );

    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => "");
      throw new Error(`Service cleanup failed (${response.status}): ${text}`);
    }
  }
}

// ---------------------------------------------------------------------------
// deployService
// ---------------------------------------------------------------------------

export async function deployService(
  env: Env,
  groupId: string,
  name: string,
  opts: {
    spaceId: string;
    envName: string;
    imageRef?: string;
    port?: number;
    imageHash?: string;
    specFingerprint?: string;
    desiredSpec?: Record<string, unknown>;
    routeNames?: string[];
    dependsOn?: string[];
  },
): Promise<ServiceEntityResult> {
  const now = new Date().toISOString();

  let imageHash = opts.imageHash ?? "";
  let ipv4: string | undefined;

  if (!imageHash) {
    const result = await deployServiceImage(env, name, {
      imageRef: opts.imageRef,
      port: opts.port,
    });
    imageHash = result.imageHash;
    ipv4 = result.ipv4;
  }

  const resolvedBaseUrl = ipv4 && opts.port
    ? `http://${ipv4}:${opts.port}`
    : undefined;
  await upsertGroupManagedService(env, {
    groupId,
    spaceId: opts.spaceId,
    envName: opts.envName,
    componentKind: "service",
    manifestName: name,
    status: "deployed",
    serviceType: "service",
    workloadKind: "container-image",
    specFingerprint: opts.specFingerprint ?? "",
    desiredSpec: opts.desiredSpec ?? {},
    routeNames: opts.routeNames,
    dependsOn: opts.dependsOn,
    deployedAt: now,
    imageHash,
    imageRef: opts.imageRef,
    port: opts.port,
    ipv4,
    resolvedBaseUrl,
  });

  return { name, deployedAt: now, imageHash, ipv4 };
}

// ---------------------------------------------------------------------------
// deleteService
// ---------------------------------------------------------------------------

export async function deleteService(
  env: Env,
  groupId: string,
  name: string,
): Promise<void> {
  const record = await findGroupManagedService(env, groupId, name, "service");
  if (!record) {
    throw new Error(`Service entity "${name}" not found in group ${groupId}`);
  }

  const spaceId = record.row.accountId;
  if (!spaceId) {
    throw new Error(`Service entity "${name}" is missing its owning space id`);
  }

  await deleteServiceRuntime(env, record.row.routeRef ?? name, spaceId);

  await deleteGroupManagedService(env, groupId, name, "service");
}

// ---------------------------------------------------------------------------
// listServices
// ---------------------------------------------------------------------------

export async function listServices(
  env: Env,
  groupId: string,
): Promise<ServiceEntityInfo[]> {
  const records = await listGroupManagedServices(env, groupId);
  return records
    .filter((record) => record.config.componentKind === "service")
    .map((record) => ({
      id: record.row.id,
      groupId: record.row.groupId ?? groupId,
      name: record.config.manifestName ?? record.row.slug ?? record.row.id,
      category: "service",
      config: {
        deployedAt: record.config.deployedAt ?? record.row.updatedAt,
        imageHash: record.config.imageHash ?? "",
        ...(record.config.imageRef ? { imageRef: record.config.imageRef } : {}),
        ...(typeof record.config.port === "number"
          ? { port: record.config.port }
          : {}),
        ...(record.config.ipv4 ? { ipv4: record.config.ipv4 } : {}),
        ...(record.config.resolvedBaseUrl
          ? { resolvedBaseUrl: record.config.resolvedBaseUrl }
          : {}),
        ...(record.config.specFingerprint
          ? { specFingerprint: record.config.specFingerprint }
          : {}),
      },
      createdAt: record.row.createdAt,
      updatedAt: record.row.updatedAt,
    }));
}
