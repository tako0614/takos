import type { Env, SpaceRole } from '../../../../shared/types';
import { getDb, accounts, accountMemberships } from '../../../../infra/db';
import { services } from '../../../../infra/db/schema-services';
import { eq, and } from 'drizzle-orm';
import { resolveActorPrincipalId } from '../../identity/principals';
import { CUSTOM_DOMAIN_WRITE_ROLES, CustomDomainError } from './types';
import type { ServiceInfo } from './types';

export async function getServiceForUser(
  env: Env,
  serviceId: string,
  userId: string,
  roles?: SpaceRole[]
): Promise<ServiceInfo | null> {
  const principalId = await resolveActorPrincipalId(env.DB, userId);
  if (!principalId) return null;
  const db = getDb(env.DB);

  // Check service ownership or membership via raw SQL for the complex nested relation query
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

  if (!service) return null;

  // Check if the user has access to this service's account
  const account = await db.select().from(accounts)
    .where(eq(accounts.id, service.accountId))
    .get();

  if (!account) return null;

  // Check ownership
  if (account.ownerAccountId === principalId) {
    return {
      id: service.id,
      space_id: service.accountId,
      service_type: service.workerType as 'app' | 'service',
      status: service.status,
      hostname: service.hostname,
      route_ref: service.routeRef,
      slug: service.slug,
    };
  }

  // Check membership
  const conditions = [
    eq(accountMemberships.accountId, service.accountId),
    eq(accountMemberships.memberId, principalId),
  ];

  const membership = await db.select().from(accountMemberships)
    .where(and(...conditions))
    .get();

  if (!membership) return null;

  if (roles && roles.length > 0 && !roles.includes(membership.role as SpaceRole)) {
    return null;
  }

  return {
    id: service.id,
    space_id: service.accountId,
    service_type: service.workerType as 'app' | 'service',
    status: service.status,
    hostname: service.hostname,
    route_ref: service.routeRef,
    slug: service.slug,
  };
}

export async function requireServiceWriteAccess(env: Env, serviceId: string, userId: string): Promise<ServiceInfo> {
  const service = await getServiceForUser(env, serviceId, userId, CUSTOM_DOMAIN_WRITE_ROLES);
  if (service) {
    return service;
  }

  const visibleService = await getServiceForUser(env, serviceId, userId);
  if (visibleService) {
    throw new CustomDomainError('Insufficient permissions to manage custom domains', 403);
  }

  throw new CustomDomainError('Service not found', 404);
}
