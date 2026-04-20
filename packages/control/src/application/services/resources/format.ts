import type {
  Resource,
  ResourceAccess,
  ResourcePermission,
  ResourceStatus,
  ResourceType,
  ServiceBinding,
} from "../../../shared/types/index.ts";
import { textDateNullable } from "../../../shared/utils/db-guards.ts";
import {
  getStoredResourceImplementation,
  toPublicResourceType,
  toResourceCapability,
} from "./capabilities.ts";

export function toApiResource(r: {
  id: string;
  ownerId: string;
  spaceId: string | null;
  groupId?: string | null;
  name: string;
  type: string;
  semanticType?: string | null;
  driver?: string | null;
  backendName?: string | null;
  status: string;
  backingResourceId?: string | null;
  backingResourceName?: string | null;
  config: string;
  metadata: string;
  sizeBytes: number | null;
  itemCount: number | null;
  lastUsedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}): Resource {
  const capability = r.semanticType ?? toResourceCapability(r.type, r.config);
  const publicType = toPublicResourceType(r.type, r.config) ?? r.type;
  const implementation = getStoredResourceImplementation(r.type, r.config);
  return {
    id: r.id,
    owner_id: r.ownerId,
    space_id: r.spaceId,
    group_id: r.groupId ?? null,
    name: r.name,
    type: publicType as ResourceType,
    ...(capability ? { capability } : {}),
    ...(implementation ? { implementation } : {}),
    ...(r.driver !== undefined ? { driver: r.driver } : {}),
    ...(r.backendName !== undefined ? { backend_name: r.backendName } : {}),
    status: r.status as ResourceStatus,
    backing_resource_id: r.backingResourceId ?? null,
    backing_resource_name: r.backingResourceName ?? null,
    config: r.config,
    metadata: r.metadata,
    size_bytes: r.sizeBytes,
    item_count: r.itemCount,
    last_used_at: textDateNullable(r.lastUsedAt),
    created_at: textDateNullable(r.createdAt) ?? new Date(0).toISOString(),
    updated_at: textDateNullable(r.updatedAt) ?? new Date(0).toISOString(),
  } as Resource;
}

export function toApiResourceAccess(ra: {
  id: string;
  resourceId: string;
  accountId: string;
  permission: string;
  grantedByAccountId: string | null;
  createdAt: string | Date;
}): ResourceAccess {
  return {
    id: ra.id,
    resource_id: ra.resourceId,
    space_id: ra.accountId,
    permission: ra.permission as ResourcePermission,
    granted_by: ra.grantedByAccountId,
    created_at: textDateNullable(ra.createdAt) ?? new Date(0).toISOString(),
  } as ResourceAccess;
}

export function toApiServiceBinding(wb: {
  id: string;
  serviceId: string;
  resourceId: string;
  bindingName: string;
  bindingType: string;
  config: string;
  createdAt: string | Date;
}): ServiceBinding {
  return {
    id: wb.id,
    service_id: wb.serviceId,
    resource_id: wb.resourceId,
    binding_name: wb.bindingName,
    binding_type: wb.bindingType,
    config: wb.config,
    created_at: textDateNullable(wb.createdAt) ?? new Date(0).toISOString(),
  } as ServiceBinding;
}
