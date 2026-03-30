/**
 * Resource entity operations for the control plane.
 *
 * Provisions / deletes managed resources (Cloudflare-native or local portability
 * backends) and records the result in the canonical resources table.
 *
 * Runs inside Cloudflare Workers -- no subprocess / wrangler CLI available.
 */

import { eq, and, ne } from 'drizzle-orm';
import { getDb } from '../../../infra/db/client.ts';
import { groups } from '../../../infra/db/schema-groups.ts';
import { resources } from '../../../infra/db/schema-platform-resources.ts';
import type { Env } from '../../../shared/types/env.ts';
import { resolveResourceDriver } from '../resources/capabilities.ts';
import { inferCanonicalResourceDescriptor } from '../deployment/canonical-model.ts';
import { deleteManagedResource, provisionManagedResource } from '../resources/lifecycle.ts';

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
  providerResourceId?: string | null;
  providerResourceName?: string | null;
  semanticType?: string | null;
  driver?: string | null;
  providerName?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ResourceConfig {
  type: string;
  manifestType?: string;
  resourceClass?: string;
  backing?: string;
  binding: string;
  bindingName?: string;
  bindingType?: string;
  providerResourceId?: string;
  providerResourceName?: string;
  specFingerprint?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resourceProviderName(groupName: string, envName: string, resourceName: string): string {
  return `${groupName}-${envName}-${resourceName}`;
}

function generateResourceId(): string {
  return crypto.randomUUID();
}

async function resolveSpaceId(
  env: Env,
  groupId: string,
  explicitSpaceId?: string,
): Promise<string> {
  if (explicitSpaceId) return explicitSpaceId;

  const db = getDb(env.DB);
  const group = await db.select({ spaceId: groups.spaceId })
    .from(groups)
    .where(eq(groups.id, groupId))
    .get();

  if (!group) {
    throw new Error(`Group "${groupId}" not found`);
  }

  return group.spaceId;
}

export async function createResource(
  env: Env,
  groupId: string,
  name: string,
  opts: {
    type: string;
    binding?: string;
    groupName?: string;
    envName?: string;
    spaceId?: string;
    providerName?: string;
    specFingerprint?: string;
  },
): Promise<EntityResult> {
  const descriptor = inferCanonicalResourceDescriptor(opts.type);
  if (!descriptor) {
    throw new Error(`Unsupported resource type: ${opts.type}`);
  }
  const binding = opts.binding || name.toUpperCase().replace(/-/g, '_');
  const providerResourceName = resourceProviderName(opts.groupName ?? groupId, opts.envName ?? 'default', name);
  const spaceId = await resolveSpaceId(env, groupId, opts.spaceId);
  const providerName = opts.providerName ?? 'cloudflare';
  const provisioned = await provisionManagedResource(env, {
    ownerId: spaceId,
    spaceId,
    groupId,
    name,
    type: opts.type,
    publicType: opts.type as never,
    semanticType: descriptor.resourceClass,
    providerName,
    persist: false,
    providerResourceName,
    config: {},
  });

  const config: ResourceConfig = {
    type: opts.type,
    manifestType: opts.type,
    resourceClass: descriptor.resourceClass,
    backing: descriptor.backing,
    binding,
    bindingName: binding,
    bindingType: descriptor.bindingType,
    providerResourceId: provisioned.providerResourceId ?? undefined,
    providerResourceName: provisioned.providerResourceName,
    ...(opts.specFingerprint ? { specFingerprint: opts.specFingerprint } : {}),
  };

  const db = getDb(env.DB);
  const existing = await db.select()
    .from(resources)
    .where(and(
      eq(resources.groupId, groupId),
      eq(resources.name, name),
      ne(resources.status, 'deleted'),
    ))
    .get();

  if (existing) {
    await db.update(resources)
      .set({
        ownerAccountId: spaceId,
        accountId: spaceId,
        groupId,
        type: opts.type,
        semanticType: descriptor.resourceClass,
        driver: resolveResourceDriver(descriptor.resourceClass, providerName),
        providerName,
        status: 'active',
        providerResourceId: provisioned.providerResourceId,
        providerResourceName: provisioned.providerResourceName,
        config: JSON.stringify(config),
        manifestKey: name,
        orphanedAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(resources.id, existing.id))
      .run();
  } else {
    await db.insert(resources).values({
      id: generateResourceId(),
      ownerAccountId: spaceId,
      accountId: spaceId,
      groupId,
      name,
      type: opts.type,
      semanticType: descriptor.resourceClass,
      driver: resolveResourceDriver(descriptor.resourceClass, providerName),
      providerName,
      status: 'active',
      providerResourceId: provisioned.providerResourceId,
      providerResourceName: provisioned.providerResourceName,
      config: JSON.stringify(config),
      metadata: '{}',
      manifestKey: name,
    }).run();
  }

  return {
    name,
    category: 'resource',
    type: opts.type,
    id: provisioned.providerResourceId ?? provisioned.id,
    binding,
  };
}

export async function updateManagedResource(
  env: Env,
  groupId: string,
  name: string,
  updates: {
    binding?: string;
    specFingerprint?: string;
  },
): Promise<void> {
  const db = getDb(env.DB);
  const row = await db.select()
    .from(resources)
    .where(and(
      eq(resources.groupId, groupId),
      eq(resources.name, name),
      ne(resources.status, 'deleted'),
    ))
    .get();

  if (!row) {
    throw new Error(`Resource "${name}" not found in group ${groupId}`);
  }

  const current = JSON.parse(row.config) as ResourceConfig;
  const next: ResourceConfig = {
    ...current,
    ...(updates.binding ? { binding: updates.binding } : {}),
    ...(updates.specFingerprint ? { specFingerprint: updates.specFingerprint } : {}),
  };

  await db.update(resources)
    .set({
      config: JSON.stringify(next),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(resources.id, row.id))
    .run();
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

  const row = await db
    .select()
    .from(resources)
    .where(and(
      eq(resources.groupId, groupId),
      eq(resources.name, name),
      ne(resources.status, 'deleted'),
    ))
    .get();

  if (!row) {
    throw new Error(`Resource entity "${name}" not found in group ${groupId}`);
  }

  const config = JSON.parse(row.config) as ResourceConfig;

  // Delete the real provider resource
  try {
    await deleteManagedResource(env, {
      type: config.type,
      providerName: row.providerName,
      providerResourceId: config.providerResourceId,
      providerResourceName: config.providerResourceName,
    });
  } catch (error) {
    // Log but still remove from DB so state is consistent.
    // The real resource may already have been deleted externally.
    console.warn(`Failed to delete managed resource for "${name}":`, error);
  }

  // Remove from DB
  await db
    .delete(resources)
    .where(eq(resources.id, row.id))
    .run();
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
    .from(resources)
    .where(and(
      eq(resources.groupId, groupId),
      ne(resources.status, 'deleted'),
    ));

  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId ?? groupId,
    name: row.name,
    category: 'resource',
    config: JSON.parse(row.config) as ResourceConfig,
    providerResourceId: row.providerResourceId,
    providerResourceName: row.providerResourceName,
    semanticType: row.semanticType,
    driver: row.driver,
    providerName: row.providerName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}
