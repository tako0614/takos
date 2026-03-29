/**
 * Container entity operations for the control plane.
 *
 * Manages Cloudflare Containers (or external container services)
 * and records state in group_entities.
 *
 * Runs inside Cloudflare Workers -- delegates to CF API or external
 * OCI orchestrator URL for container lifecycle management.
 */

import { eq, and } from 'drizzle-orm';
import { getDb } from '../../../infra/db/client.ts';
import { groupEntities } from '../../../infra/db/schema-groups.ts';
import { generateId } from '../../../shared/utils/index.ts';
import type { Env } from '../../../shared/types/env.ts';

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
    imageRef?: string;
    port?: number;
    imageHash?: string;
  },
): Promise<ContainerEntityResult> {
  const now = new Date().toISOString();

  let imageHash = opts.imageHash ?? '';

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
  };

  const db = getDb(env.DB);

  // Upsert
  const existing = await db
    .select()
    .from(groupEntities)
    .where(
      and(
        eq(groupEntities.groupId, groupId),
        eq(groupEntities.category, 'container'),
        eq(groupEntities.name, name),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(groupEntities)
      .set({ config: JSON.stringify(config) })
      .where(eq(groupEntities.id, existing[0].id));
  } else {
    await db.insert(groupEntities).values({
      id: generateId(),
      groupId,
      category: 'container',
      name,
      config: JSON.stringify(config),
    });
  }

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
  const db = getDb(env.DB);

  const rows = await db
    .select()
    .from(groupEntities)
    .where(
      and(
        eq(groupEntities.groupId, groupId),
        eq(groupEntities.category, 'container'),
        eq(groupEntities.name, name),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    throw new Error(`Container entity "${name}" not found in group ${groupId}`);
  }

  const row = rows[0];

  try {
    await deleteContainerImage(env, name);
  } catch (error) {
    console.warn(`Failed to delete container "${name}":`, error);
  }

  await db.delete(groupEntities).where(eq(groupEntities.id, row.id));
}

// ---------------------------------------------------------------------------
// listContainers
// ---------------------------------------------------------------------------

export async function listContainers(
  env: Env,
  groupId: string,
): Promise<ContainerEntityInfo[]> {
  const db = getDb(env.DB);

  const rows = await db
    .select()
    .from(groupEntities)
    .where(
      and(
        eq(groupEntities.groupId, groupId),
        eq(groupEntities.category, 'container'),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    category: row.category,
    config: JSON.parse(row.config) as ContainerConfig,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}
