import type { Resource, ResourceAccess, ResourcePermission, ResourceStatus, ResourceType, ServiceBinding } from '../../../shared/types';
import { toIsoString } from '../../../shared/utils';

export function toApiResource(r: {
  id: string;
  ownerId: string;
  spaceId: string | null;
  name: string;
  type: string;
  status: string;
  cfId: string | null;
  cfName: string | null;
  config: string;
  metadata: string;
  sizeBytes: number | null;
  itemCount: number | null;
  lastUsedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}): Resource {
  return {
    id: r.id,
    owner_id: r.ownerId,
    space_id: r.spaceId,
    name: r.name,
    type: r.type as ResourceType,
    status: r.status as ResourceStatus,
    cf_id: r.cfId,
    cf_name: r.cfName,
    config: r.config,
    metadata: r.metadata,
    size_bytes: r.sizeBytes,
    item_count: r.itemCount,
    last_used_at: toIsoString(r.lastUsedAt),
    created_at: toIsoString(r.createdAt) ?? new Date(0).toISOString(),
    updated_at: toIsoString(r.updatedAt) ?? new Date(0).toISOString(),
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
    created_at: toIsoString(ra.createdAt) ?? new Date(0).toISOString(),
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
    created_at: toIsoString(wb.createdAt) ?? new Date(0).toISOString(),
  } as ServiceBinding;
}
