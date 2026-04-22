/**
 * Resource entity operations for the control plane.
 *
 * Provisions / deletes managed resources (backend-aware or local portability
 * backends) and records the result in the canonical resources table.
 *
 * Runs inside Cloudflare Workers -- no subprocess / wrangler CLI available.
 */

import { and, eq, ne } from "drizzle-orm";
import { getDb } from "../../../infra/db/client.ts";
import { groups } from "../../../infra/db/schema-groups.ts";
import { resources } from "../../../infra/db/schema-platform-resources.ts";
import { serviceBindings } from "../../../infra/db/schema-services.ts";
import type { Env } from "../../../shared/types/env.ts";
import {
  resolveResourceDriver,
  toPublicResourceType,
} from "../resources/capabilities.ts";
import {
  type CanonicalManifestResourceSpec,
  inferCanonicalResourceDescriptor,
} from "../deployment/canonical-model.ts";
import {
  deleteManagedResource,
  provisionManagedResource,
} from "../resources/lifecycle.ts";

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
  backingResourceId?: string | null;
  backingResourceName?: string | null;
  semanticType?: string | null;
  driver?: string | null;
  backendName?: string | null;
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
  backingResourceId?: string;
  backingResourceName?: string;
  specFingerprint?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resourceBackendName(
  groupName: string,
  envName: string,
  resourceName: string,
): string {
  return `${groupName}-${envName}-${resourceName}`;
}

function generateResourceId(): string {
  return crypto.randomUUID();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sanitizeBindingName(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}

function pickResourceSpecDetails(
  spec?: CanonicalManifestResourceSpec,
): Record<string, unknown> {
  if (!spec) return {};

  const details: Record<string, unknown> = {};

  for (
    const key of [
      "generate",
      "limits",
      "migrations",
      "queue",
      "vectorize",
      "vectorIndex",
      "analyticsEngine",
      "analyticsStore",
      "workflow",
      "workflowRuntime",
      "durableObject",
      "durableNamespace",
    ] as const
  ) {
    const value = Reflect.get(spec, key);
    if (value !== undefined) {
      details[key] = value;
    }
  }

  return details;
}

function resolveManagedBackingResourceName(
  defaultName: string,
  spec?: CanonicalManifestResourceSpec,
): string {
  const specRecord = asRecord(spec);
  const analyticsConfig = asRecord(specRecord?.analyticsEngine) ??
    asRecord(specRecord?.analyticsStore);
  const dataset = typeof analyticsConfig?.dataset === "string"
    ? analyticsConfig.dataset.trim()
    : "";
  return dataset || defaultName;
}

function buildProvisioningOptions(
  spec?: CanonicalManifestResourceSpec,
): Record<string, unknown> {
  if (!spec) return {};

  const queueConfig = asRecord(Reflect.get(spec, "queue"));
  const vectorConfig = asRecord(Reflect.get(spec, "vectorize")) ??
    asRecord(Reflect.get(spec, "vectorIndex"));
  const analyticsConfig = asRecord(Reflect.get(spec, "analyticsEngine")) ??
    asRecord(Reflect.get(spec, "analyticsStore"));
  const workflowConfig = asRecord(Reflect.get(spec, "workflow")) ??
    asRecord(Reflect.get(spec, "workflowRuntime"));
  const durableConfig = asRecord(Reflect.get(spec, "durableObject")) ??
    asRecord(Reflect.get(spec, "durableNamespace"));

  const out: Record<string, unknown> = {};

  if (typeof queueConfig?.deliveryDelaySeconds === "number") {
    out.queue = { deliveryDelaySeconds: queueConfig.deliveryDelaySeconds };
  }

  if (
    typeof vectorConfig?.dimensions === "number" &&
    typeof vectorConfig?.metric === "string"
  ) {
    out.vectorIndex = {
      dimensions: vectorConfig.dimensions,
      metric: vectorConfig.metric,
    };
  }

  if (
    typeof analyticsConfig?.dataset === "string" &&
    analyticsConfig.dataset.trim().length > 0
  ) {
    out.analyticsStore = { dataset: analyticsConfig.dataset.trim() };
  }

  if (
    typeof workflowConfig?.service === "string" &&
    typeof workflowConfig?.export === "string"
  ) {
    out.workflowRuntime = {
      service: workflowConfig.service,
      export: workflowConfig.export,
      ...(typeof workflowConfig.timeoutMs === "number"
        ? { timeoutMs: workflowConfig.timeoutMs }
        : {}),
      ...(typeof workflowConfig.maxRetries === "number"
        ? { maxRetries: workflowConfig.maxRetries }
        : {}),
    };
  }

  if (typeof durableConfig?.className === "string") {
    out.durableNamespace = {
      className: durableConfig.className,
      ...(typeof durableConfig.scriptName === "string"
        ? { scriptName: durableConfig.scriptName }
        : {}),
    };
  }

  return out;
}

function buildResourceConfig(params: {
  type: string;
  descriptor: NonNullable<ReturnType<typeof inferCanonicalResourceDescriptor>>;
  binding: string;
  backingResourceId?: string | null;
  backingResourceName?: string | null;
  specFingerprint?: string;
  spec?: CanonicalManifestResourceSpec;
}): ResourceConfig {
  return {
    type: params.type,
    manifestType: params.spec?.type ?? params.type,
    resourceClass: params.descriptor.resourceClass,
    backing: params.descriptor.backing,
    binding: params.binding,
    bindingName: params.binding,
    bindingType: params.descriptor.bindingType,
    ...(params.backingResourceId
      ? { backingResourceId: params.backingResourceId }
      : {}),
    ...(params.backingResourceName
      ? { backingResourceName: params.backingResourceName }
      : {}),
    ...(params.specFingerprint
      ? { specFingerprint: params.specFingerprint }
      : {}),
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
    backendName?: string;
    specFingerprint?: string;
    spec?: CanonicalManifestResourceSpec;
  },
): Promise<EntityResult> {
  const descriptor = inferCanonicalResourceDescriptor(opts.type);
  if (!descriptor) {
    throw new Error(`Unsupported resource type: ${opts.type}`);
  }
  const publicType = toPublicResourceType(opts.type);
  if (!publicType) {
    throw new Error(`Unsupported public resource type: ${opts.type}`);
  }
  const binding = opts.binding || sanitizeBindingName(name);
  const backingResourceName = resolveManagedBackingResourceName(
    resourceBackendName(
      opts.groupName ?? groupId,
      opts.envName ?? "default",
      name,
    ),
    opts.spec,
  );
  const spaceId = await resolveSpaceId(env, groupId, opts.spaceId);
  const backendName = opts.backendName ?? "cloudflare";
  const provisioned = await provisionManagedResource(env, {
    ownerId: spaceId,
    spaceId,
    groupId,
    name,
    type: opts.type,
    publicType,
    semanticType: descriptor.resourceClass,
    backendName,
    persist: false,
    backingResourceName,
    config: pickResourceSpecDetails(opts.spec),
    ...buildProvisioningOptions(opts.spec),
  });

  const config = buildResourceConfig({
    type: opts.type,
    descriptor,
    binding,
    backingResourceId: provisioned.backingResourceId,
    backingResourceName: provisioned.backingResourceName,
    specFingerprint: opts.specFingerprint,
    spec: opts.spec,
  });

  const db = getDb(env.DB);
  const existing = await db.select()
    .from(resources)
    .where(and(
      eq(resources.groupId, groupId),
      eq(resources.name, name),
      ne(resources.status, "deleted"),
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
        driver: resolveResourceDriver(descriptor.resourceClass, backendName),
        backendName,
        status: "active",
        backingResourceId: provisioned.backingResourceId,
        backingResourceName: provisioned.backingResourceName,
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
      driver: resolveResourceDriver(descriptor.resourceClass, backendName),
      backendName,
      status: "active",
      backingResourceId: provisioned.backingResourceId,
      backingResourceName: provisioned.backingResourceName,
      config: JSON.stringify(config),
      metadata: "{}",
      manifestKey: name,
    }).run();
  }

  return {
    name,
    category: "resource",
    type: opts.type,
    id: provisioned.backingResourceId ?? provisioned.id,
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
    spec?: CanonicalManifestResourceSpec;
  },
): Promise<void> {
  const db = getDb(env.DB);
  const row = await db.select()
    .from(resources)
    .where(and(
      eq(resources.groupId, groupId),
      eq(resources.name, name),
      ne(resources.status, "deleted"),
    ))
    .get();

  if (!row) {
    throw new Error(`Resource "${name}" not found in group ${groupId}`);
  }

  const current = JSON.parse(row.config) as ResourceConfig;
  const descriptor = inferCanonicalResourceDescriptor(
    current.manifestType ?? current.type ?? row.type,
  );
  if (!descriptor) {
    throw new Error(
      `Unsupported resource type: ${
        current.manifestType ?? current.type ?? row.type
      }`,
    );
  }

  const binding = updates.binding ?? current.bindingName ?? current.binding ??
    sanitizeBindingName(name);
  const backingResourceName = resolveManagedBackingResourceName(
    row.backingResourceName ?? current.backingResourceName ??
      resourceBackendName(groupId, "default", name),
    updates.spec,
  );
  const next = buildResourceConfig({
    type: current.type ?? row.type,
    descriptor,
    binding,
    backingResourceId: row.backingResourceId ?? current.backingResourceId ??
      undefined,
    backingResourceName,
    specFingerprint: updates.specFingerprint ?? current.specFingerprint,
    spec: updates.spec,
  });

  await db.update(resources)
    .set({
      backingResourceName,
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
      ne(resources.status, "deleted"),
    ))
    .get();

  if (!row) {
    throw new Error(`Resource entity "${name}" not found in group ${groupId}`);
  }

  const config = JSON.parse(row.config) as ResourceConfig;

  // Delete the real backing resource
  try {
    await deleteManagedResource(env, {
      type: config.type,
      backendName: row.backendName,
      backingResourceId: config.backingResourceId,
      backingResourceName: config.backingResourceName,
    });
  } catch (error) {
    // Log but still remove from DB so state is consistent.
    // The real resource may already have been deleted externally.
    console.warn(`Failed to delete managed resource for "${name}":`, error);
  }

  await db
    .delete(serviceBindings)
    .where(eq(serviceBindings.resourceId, row.id))
    .run();

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
      ne(resources.status, "deleted"),
    ));

  return rows.map((row) => ({
    id: row.id,
    groupId: row.groupId ?? groupId,
    name: row.name,
    category: "resource",
    config: JSON.parse(row.config) as ResourceConfig,
    backingResourceId: row.backingResourceId,
    backingResourceName: row.backingResourceName,
    semanticType: row.semanticType,
    driver: row.driver,
    backendName: row.backendName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}
