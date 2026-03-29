/**
 * Resource entity operations for the control plane.
 *
 * Provisions / deletes Cloudflare resources (D1, R2, KV, etc.) via the
 * CF Management API and records the result in the group_entities table.
 *
 * Runs inside Cloudflare Workers -- no subprocess / wrangler CLI available.
 */

import { eq, and } from 'drizzle-orm';
import { getDb } from '../../../infra/db/client.ts';
import { groupEntities } from '../../../infra/db/schema-groups.ts';
import {
  createCloudflareApiClient,
  type CloudflareApiClient,
} from '../cloudflare/api-client.ts';
import { generateId } from '../../../shared/utils/index.ts';
import type { Env } from '../../../shared/types/env.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EntityResult {
  name: string;
  category: string;
  type: string;
  id: string;
  binding: string;
}

export interface EntityInfo {
  id: string;
  groupId: string;
  name: string;
  category: string;
  config: ResourceConfig;
  createdAt: string;
  updatedAt: string;
}

interface ResourceConfig {
  type: string;
  cfResourceId: string;
  binding: string;
  cfName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resourceCfName(groupName: string, envName: string, resourceName: string): string {
  return `${groupName}-${envName}-${resourceName}`;
}

function requireCfClient(env: Env): CloudflareApiClient {
  const client = createCloudflareApiClient(env);
  if (!client) {
    throw new Error('CF_ACCOUNT_ID and CF_API_TOKEN are required for resource provisioning');
  }
  return client;
}

/**
 * Generate a cryptographically random hex token (for secretRef).
 * Uses the Web Crypto API available in Workers.
 */
function generateSecretToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// CF resource provisioning via API
// ---------------------------------------------------------------------------

async function provisionD1(client: CloudflareApiClient, cfName: string): Promise<string> {
  const result = await client.accountPost<{ uuid: string }>('/d1/database', { name: cfName });
  return result.uuid;
}

async function provisionR2(client: CloudflareApiClient, cfName: string): Promise<string> {
  await client.accountPost('/r2/buckets', { name: cfName });
  return cfName; // R2 bucket name is the ID
}

async function provisionKV(client: CloudflareApiClient, cfName: string): Promise<string> {
  const result = await client.accountPost<{ id: string }>('/storage/kv/namespaces', { title: cfName });
  return result.id;
}

async function provisionQueue(client: CloudflareApiClient, cfName: string): Promise<string> {
  const result = await client.accountPost<{ queue_id: string }>('/queues', { queue_name: cfName });
  return result.queue_id;
}

// ---------------------------------------------------------------------------
// CF resource deletion via API
// ---------------------------------------------------------------------------

async function deleteD1(client: CloudflareApiClient, cfResourceId: string): Promise<void> {
  await client.accountDelete(`/d1/database/${cfResourceId}`);
}

async function deleteR2(client: CloudflareApiClient, cfName: string): Promise<void> {
  await client.accountDelete(`/r2/buckets/${cfName}`);
}

async function deleteKV(client: CloudflareApiClient, cfResourceId: string): Promise<void> {
  await client.accountDelete(`/storage/kv/namespaces/${cfResourceId}`);
}

async function deleteQueue(client: CloudflareApiClient, cfResourceId: string): Promise<void> {
  await client.accountDelete(`/queues/${cfResourceId}`);
}

// ---------------------------------------------------------------------------
// createResource
// ---------------------------------------------------------------------------

export async function createResource(
  env: Env,
  groupId: string,
  name: string,
  opts: {
    type: string;
    binding?: string;
    groupName?: string;
    envName?: string;
  },
): Promise<EntityResult> {
  const binding = opts.binding || name.toUpperCase().replace(/-/g, '_');
  const cfName = resourceCfName(opts.groupName ?? groupId, opts.envName ?? 'default', name);

  let cfResourceId: string;

  switch (opts.type) {
    case 'd1': {
      const client = requireCfClient(env);
      cfResourceId = await provisionD1(client, cfName);
      break;
    }
    case 'r2': {
      const client = requireCfClient(env);
      cfResourceId = await provisionR2(client, cfName);
      break;
    }
    case 'kv': {
      const client = requireCfClient(env);
      cfResourceId = await provisionKV(client, cfName);
      break;
    }
    case 'queue': {
      const client = requireCfClient(env);
      cfResourceId = await provisionQueue(client, cfName);
      break;
    }
    case 'secretRef': {
      cfResourceId = generateSecretToken();
      break;
    }
    case 'vectorize':
    case 'analyticsEngine':
    case 'workflow':
    case 'durableObject': {
      // These resource types are auto-configured during worker deploy.
      // Record them in the entity table but skip API provisioning.
      cfResourceId = name;
      break;
    }
    default:
      throw new Error(`Unsupported resource type: ${opts.type}`);
  }

  const config: ResourceConfig = {
    type: opts.type,
    cfResourceId,
    binding,
    cfName,
  };

  const entityId = generateId();
  const db = getDb(env.DB);

  await db.insert(groupEntities).values({
    id: entityId,
    groupId,
    category: 'resource',
    name,
    config: JSON.stringify(config),
  });

  return {
    name,
    category: 'resource',
    type: opts.type,
    id: cfResourceId,
    binding,
  };
}

// ---------------------------------------------------------------------------
// deleteResource
// ---------------------------------------------------------------------------

export async function deleteResource(
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
        eq(groupEntities.category, 'resource'),
        eq(groupEntities.name, name),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    throw new Error(`Resource entity "${name}" not found in group ${groupId}`);
  }

  const row = rows[0];
  const config = JSON.parse(row.config) as ResourceConfig;

  // Delete the real CF resource
  try {
    const client = createCloudflareApiClient(env);
    if (client) {
      switch (config.type) {
        case 'd1':
          await deleteD1(client, config.cfResourceId);
          break;
        case 'r2':
          await deleteR2(client, config.cfName);
          break;
        case 'kv':
          await deleteKV(client, config.cfResourceId);
          break;
        case 'queue':
          await deleteQueue(client, config.cfResourceId);
          break;
        // secretRef, vectorize, analyticsEngine, workflow, durableObject:
        // no external resource to delete
      }
    }
  } catch (error) {
    // Log but still remove from DB so state is consistent.
    // The real resource may already have been deleted externally.
    console.warn(`Failed to delete CF resource for "${name}":`, error);
  }

  // Remove from DB
  await db
    .delete(groupEntities)
    .where(eq(groupEntities.id, row.id));
}

// ---------------------------------------------------------------------------
// listResources
// ---------------------------------------------------------------------------

export async function listResources(
  env: Env,
  groupId: string,
): Promise<EntityInfo[]> {
  const db = getDb(env.DB);

  const rows = await db
    .select()
    .from(groupEntities)
    .where(
      and(
        eq(groupEntities.groupId, groupId),
        eq(groupEntities.category, 'resource'),
      ),
    );

  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId,
    name: row.name,
    category: row.category,
    config: JSON.parse(row.config) as ResourceConfig,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}
