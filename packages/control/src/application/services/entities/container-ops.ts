/**
 * Container entity operations for the control plane.
 *
 * Manages Cloudflare Containers (or external container services)
 * and records state in the canonical services table.
 *
 * Runs inside Cloudflare Workers -- delegates to CF API or external
 * OCI orchestrator URL for container lifecycle management.
 */

import type { Env } from '../../../shared/types/env.ts';
import {
  deleteGroupManagedService,
  findGroupManagedService,
  listGroupManagedServices,
  upsertGroupManagedService,
} from './group-managed-services.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ContainerEntityResult {
  name: string;
  deployedAt: string;
  imageHash: string;
}

export interface ContainerEntityInfo {
  id: string;
  groupId: string;
  name: string;
  category: string;
  config: ContainerConfig;
  createdAt: string;
  updatedAt: string;
}

interface ContainerConfig {
  deployedAt: string;
  imageHash: string;
  /** OCI image reference if applicable */
  imageRef?: string;
  port?: number;
  resolvedBaseUrl?: string;
  specFingerprint?: string;
}

// ---------------------------------------------------------------------------
// Container deployment via OCI orchestrator (or CF Containers API)
// ---------------------------------------------------------------------------

/**
 * Deploy a container via the OCI orchestrator endpoint.
 *
 * The OCI orchestrator is an external service that handles container
 * image builds and deployments. When env.OCI_ORCHESTRATOR_URL is set,
 * we POST the container spec to it. Otherwise this is a no-op stub.
 *
 * TODO: Implement CF Containers API when it becomes generally available.
 * TODO: Add AWS ECS / GCP Cloud Run providers.
 */
async function deployContainerImage(
  env: Env,
  containerName: string,
  _opts: {
    imageRef?: string;
    port?: number;
  },
): Promise<{ imageHash: string }> {
  if (env.OCI_ORCHESTRATOR_URL) {
    const response = await fetch(`${env.OCI_ORCHESTRATOR_URL}/containers/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.OCI_ORCHESTRATOR_TOKEN
          ? { Authorization: `Bearer ${env.OCI_ORCHESTRATOR_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        name: containerName,
        imageRef: _opts.imageRef,
        port: _opts.port,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Container deploy failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { imageHash?: string };
    return { imageHash: data.imageHash ?? '' };
  }

  // Stub: no orchestrator configured. Record intent only.
  return { imageHash: '' };
}

async function deleteContainerImage(
  env: Env,
  containerName: string,
): Promise<void> {
  if (env.OCI_ORCHESTRATOR_URL) {
    const response = await fetch(`${env.OCI_ORCHESTRATOR_URL}/containers/${encodeURIComponent(containerName)}`, {
      method: 'DELETE',
      headers: {
        ...(env.OCI_ORCHESTRATOR_TOKEN
          ? { Authorization: `Bearer ${env.OCI_ORCHESTRATOR_TOKEN}` }
          : {}),
      },
    });

    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => '');
      throw new Error(`Container delete failed (${response.status}): ${text}`);
    }
  }
}

// ---------------------------------------------------------------------------
// deployContainer
// ---------------------------------------------------------------------------

export async function deployContainer(
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
): Promise<ContainerEntityResult> {
  const now = new Date().toISOString();

  let imageHash = opts.imageHash ?? '';
  let resolvedBaseUrl: string | undefined;

  if (!imageHash) {
    const result = await deployContainerImage(env, name, {
      imageRef: opts.imageRef,
      port: opts.port,
    });
    imageHash = result.imageHash;
  }

  const config: ContainerConfig = {
    deployedAt: now,
    imageHash,
    ...(opts.imageRef ? { imageRef: opts.imageRef } : {}),
    ...(opts.port ? { port: opts.port } : {}),
    ...(resolvedBaseUrl ? { resolvedBaseUrl } : {}),
    ...(opts.specFingerprint ? { specFingerprint: opts.specFingerprint } : {}),
  };
  await upsertGroupManagedService(env, {
    groupId,
    spaceId: opts.spaceId,
    envName: opts.envName,
    componentKind: 'container',
    manifestName: name,
    status: 'deployed',
    serviceType: 'service',
    workloadKind: 'container-image',
    specFingerprint: opts.specFingerprint ?? '',
    desiredSpec: opts.desiredSpec ?? {},
    routeNames: opts.routeNames,
    dependsOn: opts.dependsOn,
    deployedAt: now,
    imageHash,
    imageRef: opts.imageRef,
    port: opts.port,
    resolvedBaseUrl,
  });

  return { name, deployedAt: now, imageHash };
}

// ---------------------------------------------------------------------------
// deleteContainer
// ---------------------------------------------------------------------------

export async function deleteContainer(
  env: Env,
  groupId: string,
  name: string,
): Promise<void> {
  const record = await findGroupManagedService(env, groupId, name, 'container');
  if (!record) {
    throw new Error(`Container entity "${name}" not found in group ${groupId}`);
  }

  try {
    await deleteContainerImage(env, name);
  } catch (error) {
    console.warn(`Failed to delete container "${name}":`, error);
  }

  await deleteGroupManagedService(env, groupId, name, 'container');
}

// ---------------------------------------------------------------------------
// listContainers
// ---------------------------------------------------------------------------

export async function listContainers(
  env: Env,
  groupId: string,
): Promise<ContainerEntityInfo[]> {
  const records = await listGroupManagedServices(env, groupId);
  return records
    .filter((record) => record.config.componentKind === 'container')
    .map((record) => ({
      id: record.row.id,
      groupId: record.row.groupId ?? groupId,
      name: record.config.manifestName ?? record.row.slug ?? record.row.id,
      category: 'container',
      config: {
        deployedAt: record.config.deployedAt ?? record.row.updatedAt,
        imageHash: record.config.imageHash ?? '',
        ...(record.config.imageRef ? { imageRef: record.config.imageRef } : {}),
        ...(typeof record.config.port === 'number' ? { port: record.config.port } : {}),
        ...(record.config.resolvedBaseUrl ? { resolvedBaseUrl: record.config.resolvedBaseUrl } : {}),
        ...(record.config.specFingerprint ? { specFingerprint: record.config.specFingerprint } : {}),
      },
      createdAt: record.row.createdAt,
      updatedAt: record.row.updatedAt,
    }));
}
