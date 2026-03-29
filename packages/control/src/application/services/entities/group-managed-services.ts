import { eq } from 'drizzle-orm';
import { getDb } from '../../../infra/db/client.ts';
import { deployments, serviceBindings, services } from '../../../infra/db/index.ts';
import type { SelectOf } from '../../../shared/types/drizzle-utils.ts';
import type { Env } from '../../../shared/types/env.ts';
import { safeJsonParseOrDefault } from '../../../shared/utils/logger.ts';

export type ManagedServiceComponentKind = 'worker' | 'container' | 'service';

export interface ManagedServiceConfig {
  managedBy?: 'group';
  manifestName?: string;
  componentKind?: ManagedServiceComponentKind;
  specFingerprint?: string;
  desiredSpec?: Record<string, unknown>;
  routeNames?: string[];
  dependsOn?: string[];
  deployedAt?: string;
  codeHash?: string;
  imageHash?: string;
  imageRef?: string;
  port?: number;
  ipv4?: string;
  dispatchNamespace?: string;
  resolvedBaseUrl?: string;
}

export interface ManagedServiceRecord {
  row: SelectOf<typeof services>;
  config: ManagedServiceConfig;
}

function generateManagedServiceId(): string {
  return crypto.randomUUID();
}

function slugifySegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildManagedSlug(groupId: string, envName: string, componentKind: ManagedServiceComponentKind, manifestName: string): string {
  const base = ['grp', groupId.slice(0, 8), envName, componentKind, manifestName]
    .map((part) => slugifySegment(part))
    .filter(Boolean)
    .join('-');
  const slug = base.slice(0, 48);
  return slug || `grp-${groupId.slice(0, 8)}`;
}

export function buildManagedRouteRef(
  groupId: string,
  envName: string,
  componentKind: ManagedServiceComponentKind,
  manifestName: string,
): string {
  const base = ['grp', groupId.slice(0, 8), envName, componentKind, manifestName]
    .map((part) => slugifySegment(part))
    .filter(Boolean)
    .join('-');
  return base.slice(0, 63) || `grp-${groupId.slice(0, 8)}-worker`;
}

export function parseManagedServiceConfig(configJson: string | null): ManagedServiceConfig {
  return safeJsonParseOrDefault<ManagedServiceConfig>(configJson, {});
}

function isMatchingManagedService(
  record: ManagedServiceRecord,
  manifestName: string,
  componentKind: ManagedServiceComponentKind,
): boolean {
  return record.config.managedBy === 'group'
    && record.config.manifestName === manifestName
    && record.config.componentKind === componentKind;
}

export async function listGroupManagedServices(env: Env, groupId: string): Promise<ManagedServiceRecord[]> {
  const db = getDb(env.DB);
  const rows = await db
    .select()
    .from(services)
    .where(eq(services.groupId, groupId));

  return rows.map((row) => ({
    row,
    config: parseManagedServiceConfig(row.config),
  })).filter((record) => record.config.managedBy === 'group');
}

export async function findGroupManagedService(
  env: Env,
  groupId: string,
  manifestName: string,
  componentKind: ManagedServiceComponentKind,
): Promise<ManagedServiceRecord | null> {
  const records = await listGroupManagedServices(env, groupId);
  return records.find((record) => isMatchingManagedService(record, manifestName, componentKind)) ?? null;
}

export async function upsertGroupManagedService(
  env: Env,
  input: {
    groupId: string;
    spaceId: string;
    envName: string;
    componentKind: ManagedServiceComponentKind;
    manifestName: string;
    status: string;
    serviceType: 'app' | 'service';
    workloadKind: string;
    specFingerprint: string;
    desiredSpec: Record<string, unknown>;
    routeNames?: string[];
    dependsOn?: string[];
    deployedAt?: string;
    codeHash?: string;
    imageHash?: string;
    imageRef?: string;
    port?: number;
    ipv4?: string;
    dispatchNamespace?: string;
    resolvedBaseUrl?: string;
  },
): Promise<ManagedServiceRecord> {
  const db = getDb(env.DB);
  const now = new Date().toISOString();
  const existing = await findGroupManagedService(env, input.groupId, input.manifestName, input.componentKind);

  const slug = existing?.row.slug
    ?? buildManagedSlug(input.groupId, input.envName, input.componentKind, input.manifestName);
  const hostname = existing?.row.hostname
    ?? (env.TENANT_BASE_DOMAIN ? `${slug}.${env.TENANT_BASE_DOMAIN}` : null);
  const routeRef = existing?.row.routeRef
    ?? buildManagedRouteRef(input.groupId, input.envName, input.componentKind, input.manifestName);

  const config: ManagedServiceConfig = {
    managedBy: 'group',
    manifestName: input.manifestName,
    componentKind: input.componentKind,
    specFingerprint: input.specFingerprint,
    desiredSpec: input.desiredSpec,
    ...(input.routeNames && input.routeNames.length > 0 ? { routeNames: input.routeNames } : {}),
    ...(input.dependsOn && input.dependsOn.length > 0 ? { dependsOn: input.dependsOn } : {}),
    ...(input.deployedAt ? { deployedAt: input.deployedAt } : {}),
    ...(input.codeHash ? { codeHash: input.codeHash } : {}),
    ...(input.imageHash ? { imageHash: input.imageHash } : {}),
    ...(input.imageRef ? { imageRef: input.imageRef } : {}),
    ...(typeof input.port === 'number' ? { port: input.port } : {}),
    ...(input.ipv4 ? { ipv4: input.ipv4 } : {}),
    ...(input.dispatchNamespace ? { dispatchNamespace: input.dispatchNamespace } : {}),
    ...(input.resolvedBaseUrl ? { resolvedBaseUrl: input.resolvedBaseUrl } : {}),
  };

  if (existing) {
    await db.update(services)
      .set({
        accountId: input.spaceId,
        groupId: input.groupId,
        serviceType: input.serviceType,
        status: input.status,
        config: JSON.stringify(config),
        hostname,
        routeRef,
        slug,
        workloadKind: input.workloadKind,
        updatedAt: now,
      })
      .where(eq(services.id, existing.row.id))
      .run();

    return {
      row: {
        ...existing.row,
        accountId: input.spaceId,
        groupId: input.groupId,
        serviceType: input.serviceType,
        status: input.status,
        config: JSON.stringify(config),
        hostname,
        routeRef,
        slug,
        workloadKind: input.workloadKind,
        updatedAt: now,
      },
      config,
    };
  }

  const id = generateManagedServiceId();
  const row = {
    id,
    accountId: input.spaceId,
    groupId: input.groupId,
    serviceType: input.serviceType,
    status: input.status,
    config: JSON.stringify(config),
    hostname,
    routeRef,
    slug,
    workloadKind: input.workloadKind,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(services).values(row).run();

  return {
    row: {
      activeDeploymentId: null,
      currentVersion: 0,
      fallbackDeploymentId: null,
      nameType: null,
      ...row,
    },
    config,
  } as ManagedServiceRecord;
}

export async function deleteGroupManagedService(
  env: Env,
  groupId: string,
  manifestName: string,
  componentKind: ManagedServiceComponentKind,
): Promise<ManagedServiceRecord> {
  const db = getDb(env.DB);
  const existing = await findGroupManagedService(env, groupId, manifestName, componentKind);
  if (!existing) {
    throw new Error(`${componentKind} "${manifestName}" not found in group ${groupId}`);
  }

  await db.delete(serviceBindings)
    .where(eq(serviceBindings.serviceId, existing.row.id))
    .run();
  await db.delete(deployments)
    .where(eq(deployments.serviceId, existing.row.id))
    .run();
  await db.delete(services)
    .where(eq(services.id, existing.row.id))
    .run();

  return existing;
}
