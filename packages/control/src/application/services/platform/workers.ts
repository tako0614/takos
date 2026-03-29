import type { D1Database } from '../../../shared/types/bindings.ts';
import type { SpaceRole } from '../../../shared/types';
import { generateId } from '../../../shared/utils';
import { accountMemberships, accounts, getDb, services } from '../../../infra/db';
import { eq, and, desc, sql, or, inArray } from 'drizzle-orm';
import { resolveActorPrincipalId } from '../identity/principals';
import { resolveAccessibleAccountIds } from '../identity/membership-resolver';

const MAX_SERVICES = 100;

export const WORKSPACE_SERVICE_LIMITS = {
  maxServices: MAX_SERVICES,
};

export const WORKSPACE_WORKER_LIMITS = {
  maxWorkers: MAX_SERVICES,
};

export interface ServiceRow {
  id: string;
  space_id: string;
  service_type: 'app' | 'service';
  status: 'pending' | 'building' | 'deployed' | 'failed' | 'stopped';
  config: string | null;
  hostname: string | null;
  service_name: string | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceWithSpaceName extends ServiceRow {
  workspace_name: string;
}

export type ServiceRouteRecord = {
  id: string;
  accountId: string;
  workerType: string;
  status: string;
  hostname: string | null;
  routeRef: string | null;
  slug: string | null;
};

export type ServiceRouteSummary = Pick<ServiceRouteRecord, 'id' | 'accountId' | 'hostname' | 'routeRef' | 'slug'>;

export type ServiceRouteCleanupRecord = ServiceRouteSummary & {
  config: string | null;
};

export function slugifyServiceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

export const slugifyWorkerName = slugifyServiceName;

function toApiService(row: {
  id: string;
  accountId: string;
  workerType: string;
  status: string;
  config: string | null;
  hostname: string | null;
  routeRef: string | null;
  slug: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}): ServiceRow {
  return {
    id: row.id,
    space_id: row.accountId,
    service_type: row.workerType as 'app' | 'service',
    status: row.status as ServiceRow['status'],
    config: row.config,
    hostname: row.hostname,
    service_name: row.routeRef,
    slug: row.slug,
    created_at: (row.createdAt == null ? null : typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString()),
    updated_at: (row.updatedAt == null ? null : typeof row.updatedAt === 'string' ? row.updatedAt : row.updatedAt.toISOString()),
  };
}

function normalizeServiceRouteRecord(row: ServiceRouteRecord): ServiceRouteRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    workerType: row.workerType,
    status: row.status,
    hostname: row.hostname,
    routeRef: row.routeRef,
    slug: row.slug,
  };
}

export async function countServicesInSpace(d1: D1Database, spaceId: string): Promise<number> {
  const db = getDb(d1);
  const result = await db.select({ count: sql<number>`count(*)` }).from(services).where(eq(services.accountId, spaceId)).get();
  return result?.count ?? 0;
}

export async function listServicesForUser(d1: D1Database, userId: string) {
  const principalId = await resolveActorPrincipalId(d1, userId);
  if (!principalId) return [];

  const db = getDb(d1);
  const allAccountIds = await resolveAccessibleAccountIds(d1, principalId);
  // Exclude the user's own account — only workspace memberships matter here
  const accountIds = allAccountIds.filter((id) => id !== principalId);
  if (accountIds.length === 0) return [];
  const serviceRows = await db.select({
    id: services.id,
    accountId: services.accountId,
    workerType: services.workerType,
    status: services.status,
    config: services.config,
    hostname: services.hostname,
    routeRef: services.routeRef,
    slug: services.slug,
    createdAt: services.createdAt,
    updatedAt: services.updatedAt,
  }).from(services).where(sql`${services.accountId} IN (${sql.join(accountIds.map((id) => sql`${id}`), sql`, `)})`).orderBy(desc(services.updatedAt)).all();
  const accountRows = await db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(sql`${accounts.id} IN (${sql.join(accountIds.map((id) => sql`${id}`), sql`, `)})`).all();
  const accountNameMap = new Map(accountRows.map((account) => [account.id, account.name]));
  return serviceRows.map((service) => ({ ...toApiService(service), workspace_name: accountNameMap.get(service.accountId) ?? '' }));
}

export async function listServicesForSpace(d1: D1Database, spaceId: string) {
  const db = getDb(d1);
  const serviceRows = await db.select({
    id: services.id,
    accountId: services.accountId,
    workerType: services.workerType,
    status: services.status,
    config: services.config,
    hostname: services.hostname,
    routeRef: services.routeRef,
    slug: services.slug,
    createdAt: services.createdAt,
    updatedAt: services.updatedAt,
  }).from(services).where(eq(services.accountId, spaceId)).orderBy(desc(services.updatedAt)).all();
  return serviceRows.map((service) => toApiService(service));
}

export async function getServiceById(d1: D1Database, serviceId: string) {
  const db = getDb(d1);
  const service = await db.select({
    id: services.id,
    accountId: services.accountId,
    workerType: services.workerType,
    status: services.status,
    config: services.config,
    hostname: services.hostname,
    routeRef: services.routeRef,
    slug: services.slug,
    createdAt: services.createdAt,
    updatedAt: services.updatedAt,
  }).from(services).where(eq(services.id, serviceId)).get();
  if (!service) return null;
  return toApiService(service);
}

export async function getServiceRouteRecord(d1: D1Database, serviceId: string): Promise<ServiceRouteRecord | null> {
  const db = getDb(d1);
  const service = await db.select({
    id: services.id,
    accountId: services.accountId,
    workerType: services.workerType,
    status: services.status,
    hostname: services.hostname,
    routeRef: services.routeRef,
    slug: services.slug,
  }).from(services)
    .where(eq(services.id, serviceId))
    .get();
  return service ? normalizeServiceRouteRecord(service) : null;
}

export async function getServiceRouteRecordForSpace(
  d1: D1Database,
  spaceId: string,
  serviceId: string,
): Promise<ServiceRouteRecord | null> {
  const service = await getServiceRouteRecord(d1, serviceId);
  if (!service || service.accountId !== spaceId) return null;
  return service;
}

export async function resolveServiceReferenceRecord(
  d1: D1Database,
  spaceId: string,
  reference: string,
): Promise<ServiceRouteRecord | null> {
  const ref = reference.trim();
  if (!ref) return null;

  const db = getDb(d1);
  const service = await db.select({
    id: services.id,
    accountId: services.accountId,
    workerType: services.workerType,
    status: services.status,
    hostname: services.hostname,
    routeRef: services.routeRef,
    slug: services.slug,
  }).from(services)
    .where(and(
      eq(services.accountId, spaceId),
      or(
        eq(services.id, ref),
        eq(services.routeRef, ref),
        eq(services.slug, ref),
      ),
    ))
    .get();

  return service ? normalizeServiceRouteRecord(service) : null;
}

export async function resolveServiceRouteReference(
  d1: D1Database,
  spaceId: string,
  reference: string,
): Promise<ServiceRouteRecord | null> {
  return resolveServiceReferenceRecord(d1, spaceId, reference);
}

export async function listServiceRouteRecordsByIds(
  d1: D1Database,
  serviceIds: string[],
): Promise<ServiceRouteRecord[]> {
  if (serviceIds.length === 0) return [];
  const db = getDb(d1);
  const rows = await db.select({
    id: services.id,
    accountId: services.accountId,
    workerType: services.workerType,
    status: services.status,
    hostname: services.hostname,
    routeRef: services.routeRef,
    slug: services.slug,
  }).from(services)
    .where(inArray(services.id, serviceIds))
    .all();
  return rows.map(normalizeServiceRouteRecord);
}

export async function getServiceRouteSummary(
  d1: D1Database,
  serviceId: string,
  spaceId?: string,
): Promise<ServiceRouteSummary | null> {
  const db = getDb(d1);
  const conditions = [eq(services.id, serviceId)];
  if (spaceId) {
    conditions.push(eq(services.accountId, spaceId));
  }

  const service = await db.select({
    id: services.id,
    accountId: services.accountId,
    hostname: services.hostname,
    routeRef: services.routeRef,
    slug: services.slug,
  }).from(services)
    .where(and(...conditions))
    .get();

  return service ?? null;
}

export async function resolveServiceRouteSummaryForSpace(
  d1: D1Database,
  spaceId: string,
  reference: string,
): Promise<ServiceRouteSummary | null> {
  const service = await resolveServiceReferenceRecord(d1, spaceId, reference);
  if (!service) return null;
  return {
    id: service.id,
    accountId: service.accountId,
    hostname: service.hostname,
    routeRef: service.routeRef,
    slug: service.slug,
  };
}

export async function findServiceRouteSummaryInSpace(
  d1: D1Database,
  spaceId: string,
  reference: string,
): Promise<ServiceRouteSummary | null> {
  return resolveServiceRouteSummaryForSpace(d1, spaceId, reference);
}

export async function listSpaceServiceRouteCleanupRecords(
  d1: D1Database,
  spaceId: string,
): Promise<ServiceRouteCleanupRecord[]> {
  const db = getDb(d1);
  return db.select({
    id: services.id,
    accountId: services.accountId,
    hostname: services.hostname,
    routeRef: services.routeRef,
    slug: services.slug,
    config: services.config,
  }).from(services)
    .where(eq(services.accountId, spaceId))
    .all();
}

export async function listServiceRouteCleanupRecordsForSpace(
  d1: D1Database,
  spaceId: string,
): Promise<ServiceRouteCleanupRecord[]> {
  return listSpaceServiceRouteCleanupRecords(d1, spaceId);
}

export async function getServiceForUser(d1: D1Database, serviceId: string, userId: string) {
  const principalId = await resolveActorPrincipalId(d1, userId);
  if (!principalId) return null;

  const db = getDb(d1);
  const service = await db.select({
    id: services.id,
    accountId: services.accountId,
    workerType: services.workerType,
    status: services.status,
    config: services.config,
    hostname: services.hostname,
    routeRef: services.routeRef,
    slug: services.slug,
    createdAt: services.createdAt,
    updatedAt: services.updatedAt,
  }).from(services).where(eq(services.id, serviceId)).get();
  if (!service) return null;

  const membership = await db.select({ accountId: accountMemberships.accountId }).from(accountMemberships).where(and(eq(accountMemberships.accountId, service.accountId), eq(accountMemberships.memberId, principalId))).get();
  if (!membership) return null;

  const account = await db.select({ name: accounts.name }).from(accounts).where(eq(accounts.id, service.accountId)).get();
  return { ...toApiService(service), workspace_name: account?.name ?? '' };
}

export async function getServiceForUserWithRole(d1: D1Database, serviceId: string, userId: string, roles?: SpaceRole[]) {
  const principalId = await resolveActorPrincipalId(d1, userId);
  if (!principalId) return null;

  const db = getDb(d1);
  const service = await db.select({
    id: services.id,
    accountId: services.accountId,
    workerType: services.workerType,
    status: services.status,
    config: services.config,
    hostname: services.hostname,
    routeRef: services.routeRef,
    slug: services.slug,
    createdAt: services.createdAt,
    updatedAt: services.updatedAt,
  }).from(services).where(eq(services.id, serviceId)).get();
  if (!service) return null;

  const membership = await db.select({ role: accountMemberships.role }).from(accountMemberships).where(and(eq(accountMemberships.accountId, service.accountId), eq(accountMemberships.memberId, principalId))).get();
  if (!membership) return null;
  if (roles && roles.length > 0 && !roles.includes(membership.role as SpaceRole)) return null;

  return { ...toApiService(service), member_role: membership.role as SpaceRole };
}

export async function createService(d1: D1Database, input: { spaceId: string; workerType: 'app' | 'service'; slug?: string; config?: string | null; platformDomain: string; }) {
  const db = getDb(d1);
  const id = generateId();
  const timestamp = new Date().toISOString();
  const slug = slugifyServiceName(input.slug ?? id);
  const hostname = `${slug}.${input.platformDomain}`;
  const serviceSlotName = `worker-${id}`;

  await db.insert(services).values({
    id,
    accountId: input.spaceId,
    serviceType: input.workerType,
    status: 'pending',
    config: input.config || null,
    hostname,
    routeRef: serviceSlotName,
    slug,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const service = await db.select({
    id: services.id,
    accountId: services.accountId,
    workerType: services.workerType,
    status: services.status,
    config: services.config,
    hostname: services.hostname,
    routeRef: services.routeRef,
    slug: services.slug,
    createdAt: services.createdAt,
    updatedAt: services.updatedAt,
  }).from(services).where(eq(services.id, id)).get();

  const apiService = service ? toApiService(service) : null;
  return {
    service: apiService,
    worker: apiService,
    id,
    slug,
    hostname,
    serviceSlotName,
    workerSlotName: serviceSlotName,
  };
}

export async function deleteService(d1: D1Database, serviceId: string) {
  const db = getDb(d1);
  await db.delete(services).where(eq(services.id, serviceId));
}

