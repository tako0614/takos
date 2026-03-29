import type { Resource, ResourceAccess, ServiceBinding } from '../../../shared/types';
export declare function toApiResource(r: {
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
}): Resource;
export declare function toApiResourceAccess(ra: {
    id: string;
    resourceId: string;
    accountId: string;
    permission: string;
    grantedByAccountId: string | null;
    createdAt: string | Date;
}): ResourceAccess;
export declare function toApiServiceBinding(wb: {
    id: string;
    serviceId: string;
    resourceId: string;
    bindingName: string;
    bindingType: string;
    config: string;
    createdAt: string | Date;
}): ServiceBinding;
//# sourceMappingURL=format.d.ts.map