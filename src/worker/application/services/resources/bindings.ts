import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { getDb, serviceBindings, services } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { toApiServiceBinding } from "./format.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";

export const resourceBindingDeps = {
  getDb,
};

export async function listServiceBindings(
  db: SqlDatabaseBinding,
  resourceId: string,
) {
  const drizzle = resourceBindingDeps.getDb(db);

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
      createdAt: textDate(wb.createdAt),
    }),
    service_hostname: wb.serviceHostname,
    service_slug: wb.serviceSlug,
    service_status: wb.serviceStatus,
  }));
}

export async function countServiceBindings(
  db: SqlDatabaseBinding,
  resourceId: string,
) {
  const drizzle = resourceBindingDeps.getDb(db);
  const { count } = await import("drizzle-orm");
  const result = await drizzle.select({ count: count() }).from(serviceBindings)
    .where(eq(serviceBindings.resourceId, resourceId))
    .get();
  return { count: result?.count ?? 0 };
}

export async function createServiceBinding(
  db: SqlDatabaseBinding,
  input: {
    id: string;
    service_id: string;
    resource_id: string;
    binding_name: string;
    binding_type: string;
    config: Record<string, unknown>;
    created_at: string;
  },
) {
  const drizzle = resourceBindingDeps.getDb(db);
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

export async function deleteServiceBinding(
  db: SqlDatabaseBinding,
  resourceId: string,
  serviceId: string,
) {
  const drizzle = resourceBindingDeps.getDb(db);
  await drizzle.delete(serviceBindings)
    .where(and(
      eq(serviceBindings.resourceId, resourceId),
      eq(serviceBindings.serviceId, serviceId),
    ));
}

export const listResourceBindings = listServiceBindings;
export const countResourceBindings = countServiceBindings;
