/**
 * Service entity operations for the control plane.
 *
 * Manages long-running services (e.g. background processes,
 * external service endpoints) and records state in group_entities.
 *
 * Runs inside Cloudflare Workers -- delegates to external providers
 * via fetch.
 *
 * TODO: Add AWS ECS / GCP Cloud Run / Kubernetes provider implementations.
 */

import { eq, and } from 'drizzle-orm';
import { getDb } from '../../../infra/db/client.ts';
import { groupEntities } from '../../../infra/db/schema-groups.ts';
import { generateId } from '../../../shared/utils/index.ts';
import type { Env } from '../../../shared/types/env.ts';

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
}

// ---------------------------------------------------------------------------
// Service deployment
// ---------------------------------------------------------------------------

/**
 * Deploy a service via the OCI orchestrator endpoint.
 *
 * Similar to container-ops but for long-running services that expose
 * a persistent endpoint (e.g. a database proxy, a queue consumer).
 *
 * TODO: Implement CF Workers for Platforms service binding.
 * TODO: Add AWS ECS / GCP Cloud Run providers.
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
    const response = await fetch(`${env.OCI_ORCHESTRATOR_URL}/services/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.OCI_ORCHESTRATOR_TOKEN
          ? { Authorization: `Bearer ${env.OCI_ORCHESTRATOR_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        name: serviceName,
        imageRef: _opts.imageRef,
        port: _opts.port,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Service deploy failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as { imageHash?: string; ipv4?: string };
    return { imageHash: data.imageHash ?? '', ipv4: data.ipv4 };
  }

  // Stub: no orchestrator configured. Record intent only.
  return { imageHash: '' };
}

async function deleteServiceImage(
  env: Env,
  serviceName: string,
): Promise<void> {
  if (env.OCI_ORCHESTRATOR_URL) {
    const response = await fetch(`${env.OCI_ORCHESTRATOR_URL}/services/${encodeURIComponent(serviceName)}`, {
      method: 'DELETE',
      headers: {
        ...(env.OCI_ORCHESTRATOR_TOKEN
          ? { Authorization: `Bearer ${env.OCI_ORCHESTRATOR_TOKEN}` }
          : {}),
      },
    });

    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => '');
      throw new Error(`Service delete failed (${response.status}): ${text}`);
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
    imageRef?: string;
    port?: number;
    imageHash?: string;
  },
): Promise<ServiceEntityResult> {
  const now = new Date().toISOString();

  let imageHash = opts.imageHash ?? '';
  let ipv4: string | undefined;

  if (!imageHash) {
    const result = await deployServiceImage(env, name, {
      imageRef: opts.imageRef,
      port: opts.port,
    });
    imageHash = result.imageHash;
    ipv4 = result.ipv4;
  }

  const config: ServiceConfig = {
    deployedAt: now,
    imageHash,
    ...(opts.imageRef ? { imageRef: opts.imageRef } : {}),
    ...(opts.port ? { port: opts.port } : {}),
    ...(ipv4 ? { ipv4 } : {}),
  };

  const db = getDb(env.DB);

  // Upsert
  const existing = await db
    .select()
    .from(groupEntities)
    .where(
      and(
        eq(groupEntities.groupId, groupId),
        eq(groupEntities.category, 'service'),
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
      category: 'service',
      name,
      config: JSON.stringify(config),
    });
  }

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
  const db = getDb(env.DB);

  const rows = await db
    .select()
    .from(groupEntities)
    .where(
      and(
        eq(groupEntities.groupId, groupId),
        eq(groupEntities.category, 'service'),
        eq(groupEntities.name, name),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    throw new Error(`Service entity "${name}" not found in group ${groupId}`);
  }

  const row = rows[0];

  try {
    await deleteServiceImage(env, name);
  } catch (error) {
    console.warn(`Failed to delete service "${name}":`, error);
  }

  await db.delete(groupEntities).where(eq(groupEntities.id, row.id));
}

// ---------------------------------------------------------------------------
// listServices
// ---------------------------------------------------------------------------

export async function listServices(
  env: Env,
  groupId: string,
): Promise<ServiceEntityInfo[]> {
  const db = getDb(env.DB);

  const rows = await db
    .select()
    .from(groupEntities)
    .where(
      and(
        eq(groupEntities.groupId, groupId),
        eq(groupEntities.category, 'service'),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    category: row.category,
    config: JSON.parse(row.config) as ServiceConfig,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}
