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
import type { AppResource } from '../source/app-manifest-types.ts';
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
  [key: string]: unknown;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sanitizeBindingName(name: string): string {
  return name.toUpperCase().replace(/-/g, '_');
}

function pickResourceSpecDetails(spec?: AppResource): Record<string, unknown> {
  if (!spec) return {};

  const details: Record<string, unknown> = {};
  const specRecord = spec as unknown as Record<string, unknown>;

  for (const key of [
    'generate',
    'limits',
    'migrations',
    'queue',
    'vectorize',
    'vectorIndex',
    'analyticsEngine',
    'analyticsStore',
    'workflow',
    'workflowRuntime',
    'durableObject',
    'durableNamespace',
  ] as const) {
    if (key in specRecord && specRecord[key] !== undefined) {
      details[key] = specRecord[key];
    }
  }

  return details;
}

function resolveManagedProviderResourceName(defaultName: string, spec?: AppResource): string {
  const specRecord = asRecord(spec);
  const analyticsConfig = asRecord(specRecord?.analyticsEngine) ?? asRecord(specRecord?.analyticsStore);
  const dataset = typeof analyticsConfig?.dataset === 'string'
    ? analyticsConfig.dataset.trim()
    : '';
  return dataset || defaultName;
}

function buildProvisioningOptions(spec?: AppResource): Record<string, unknown> {
  if (!spec) return {};

  const specRecord = spec as unknown as Record<string, unknown>;
  const queueConfig = asRecord(specRecord.queue);
  const vectorConfig = asRecord(specRecord.vectorize) ?? asRecord(specRecord.vectorIndex);
  const analyticsConfig = asRecord(specRecord.analyticsEngine) ?? asRecord(specRecord.analyticsStore);
  const workflowConfig = asRecord(specRecord.workflow) ?? asRecord(specRecord.workflowRuntime);
  const durableConfig = asRecord(specRecord.durableObject) ?? asRecord(specRecord.durableNamespace);

  const out: Record<string, unknown> = {};

  if (typeof queueConfig?.deliveryDelaySeconds === 'number') {
    out.queue = { deliveryDelaySeconds: queueConfig.deliveryDelaySeconds };
  }

  if (
    typeof vectorConfig?.dimensions === 'number'
    && typeof vectorConfig?.metric === 'string'
  ) {
    out.vectorIndex = {
      dimensions: vectorConfig.dimensions,
      metric: vectorConfig.metric,
    };
  }

  if (typeof analyticsConfig?.dataset === 'string' && analyticsConfig.dataset.trim().length > 0) {
    out.analyticsStore = { dataset: analyticsConfig.dataset.trim() };
  }

  if (
    typeof workflowConfig?.service === 'string'
    && typeof workflowConfig?.export === 'string'
  ) {
    out.workflowRuntime = {
      service: workflowConfig.service,
      export: workflowConfig.export,
      ...(typeof workflowConfig.timeoutMs === 'number' ? { timeoutMs: workflowConfig.timeoutMs } : {}),
      ...(typeof workflowConfig.maxRetries === 'number' ? { maxRetries: workflowConfig.maxRetries } : {}),
    };
  }

  if (typeof durableConfig?.className === 'string') {
    out.durableNamespace = {
      className: durableConfig.className,
      ...(typeof durableConfig.scriptName === 'string' ? { scriptName: durableConfig.scriptName } : {}),
    };
  }

  return out;
}

function buildResourceConfig(params: {
  type: string;
  descriptor: NonNullable<ReturnType<typeof inferCanonicalResourceDescriptor>>;
  binding: string;
  providerResourceId?: string | null;
  providerResourceName?: string | null;
  specFingerprint?: string;
  spec?: AppResource;
}): ResourceConfig {
  return {
    type: params.type,
    manifestType: params.spec?.type ?? params.type,
    resourceClass: params.descriptor.resourceClass,
    backing: params.descriptor.backing,
    binding: params.binding,
    bindingName: params.binding,
    bindingType: params.descriptor.bindingType,
    ...(params.providerResourceId ? { providerResourceId: params.providerResourceId } : {}),
    ...(params.providerResourceName ? { providerResourceName: params.providerResourceName } : {}),
    ...(params.specFingerprint ? { specFingerprint: params.specFingerprint } : {}),
    ...pickResourceSpecDetails(params.spec),
  };
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
    spec?: AppResource;
  },
): Promise<EntityResult> {
  const descriptor = inferCanonicalResourceDescriptor(opts.type);
  if (!descriptor) {
    throw new Error(`Unsupported resource type: ${opts.type}`);
  }
  const binding = opts.binding || sanitizeBindingName(name);
  const providerResourceName = resolveManagedProviderResourceName(
    resourceProviderName(opts.groupName ?? groupId, opts.envName ?? 'default', name),
    opts.spec,
  );
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
    config: pickResourceSpecDetails(opts.spec),
    ...buildProvisioningOptions(opts.spec),
  });

  const config = buildResourceConfig({
    type: opts.type,
    descriptor,
    binding,
    providerResourceId: provisioned.providerResourceId,
    providerResourceName: provisioned.providerResourceName,
    specFingerprint: opts.specFingerprint,
    spec: opts.spec,
  });

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
    spec?: AppResource;
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
  const descriptor = inferCanonicalResourceDescriptor(current.manifestType ?? current.type ?? row.type);
  if (!descriptor) {
    throw new Error(`Unsupported resource type: ${current.manifestType ?? current.type ?? row.type}`);
  }

  const binding = updates.binding ?? current.bindingName ?? current.binding ?? sanitizeBindingName(name);
  const providerResourceName = resolveManagedProviderResourceName(
    row.providerResourceName ?? current.providerResourceName ?? resourceProviderName(groupId, 'default', name),
    updates.spec,
  );
  const next = buildResourceConfig({
    type: current.type ?? row.type,
    descriptor,
    binding,
    providerResourceId: row.providerResourceId ?? current.providerResourceId ?? undefined,
    providerResourceName,
    specFingerprint: updates.specFingerprint ?? current.specFingerprint,
    spec: updates.spec,
  });

  await db.update(resources)
    .set({
      providerResourceName,
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
