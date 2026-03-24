import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb, serviceBindings, services } from '../../../infra/db';
import { eq, and } from 'drizzle-orm';
import { toRequiredIsoString } from '../../../shared/utils';
import { toApiServiceBinding } from './format';
import { getResourceById } from './store';

export async function listServiceBindings(db: D1Database, resourceId: string) {
  const drizzle = getDb(db);

  const bindingsResult = await drizzle.select({
    id: serviceBindings.id,
    serviceId: serviceBindings.serviceId,
    resourceId: serviceBindings.resourceId,
    bindingName: serviceBindings.bindingName,
    bindingType: serviceBindings.bindingType,
    config: serviceBindings.config,
    createdAt: serviceBindings.createdAt,
    serviceHostname: services.hostname,
    serviceSlug: services.slug,
    serviceStatus: services.status,
  }).from(serviceBindings)
    .leftJoin(services, eq(serviceBindings.serviceId, services.id))
    .where(eq(serviceBindings.resourceId, resourceId))
    .orderBy(serviceBindings.createdAt)
    .all();

  return bindingsResult.map((wb) => ({
    ...toApiServiceBinding({
      id: wb.id,
      serviceId: wb.serviceId,
      resourceId: wb.resourceId,
      bindingName: wb.bindingName,
      bindingType: wb.bindingType,
      config: wb.config,
      createdAt: toRequiredIsoString(wb.createdAt),
    }),
    service_hostname: wb.serviceHostname,
    service_slug: wb.serviceSlug,
    service_status: wb.serviceStatus,
  }));
}

export async function countServiceBindings(db: D1Database, resourceId: string) {
  const drizzle = getDb(db);
  const { count } = await import('drizzle-orm');
  const result = await drizzle.select({ count: count() }).from(serviceBindings)
    .where(eq(serviceBindings.resourceId, resourceId))
    .get();
  return { count: result?.count ?? 0 };
}

export async function createServiceBinding(
  db: D1Database,
  input: {
    id: string;
    service_id: string;
    resource_id: string;
    binding_name: string;
    binding_type: string;
    config: Record<string, unknown>;
    created_at: string;
  }
) {
  const drizzle = getDb(db);
  await drizzle.insert(serviceBindings).values({
    id: input.id,
    serviceId: input.service_id,
    resourceId: input.resource_id,
    bindingName: input.binding_name,
    bindingType: input.binding_type,
    config: JSON.stringify(input.config || {}),
    createdAt: input.created_at,
  });
}

export async function deleteServiceBinding(db: D1Database, resourceId: string, serviceId: string) {
  const drizzle = getDb(db);
  await drizzle.delete(serviceBindings)
    .where(and(
      eq(serviceBindings.resourceId, resourceId),
      eq(serviceBindings.serviceId, serviceId),
    ));
}

export const listResourceBindings = listServiceBindings;
export const countResourceBindings = countServiceBindings;
export const createWorkerBinding = createServiceBinding;
export const deleteWorkerBinding = deleteServiceBinding;

export async function buildBindingFromResource(
  db: D1Database,
  resourceId: string,
  bindingName: string
): Promise<{
  type: 'd1' | 'r2' | 'kv' | 'vectorize';
  name: string;
  id?: string;
  bucket_name?: string;
  namespace_id?: string;
  index_name?: string;
} | null> {
  const resource = await getResourceById(db, resourceId);

  if (!resource || resource.status !== 'active') {
    return null;
  }

  switch (resource.type) {
    case 'd1':
      return {
        type: 'd1',
        name: bindingName,
        id: resource.cf_id || undefined,
      };

    case 'r2':
      return {
        type: 'r2',
        name: bindingName,
        bucket_name: resource.cf_name || undefined,
      };

    case 'kv':
      return {
        type: 'kv',
        name: bindingName,
        namespace_id: resource.cf_id || undefined,
      };

    case 'vectorize':
      return {
        type: 'vectorize',
        name: bindingName,
        index_name: resource.cf_name || undefined,
      };

    default:
      return null;
  }
}
