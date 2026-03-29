import type { D1Database } from '../../../shared/types/bindings.ts';
import type { ResourcePermission } from '../../../shared/types';
export declare function listResourceAccess(db: D1Database, resourceId: string): Promise<{
    workspace_name: string | null;
    id: string;
    resource_id: string;
    space_id: string;
    permission: ResourcePermission;
    granted_by: string | null;
    created_at: string;
}[]>;
export declare function upsertResourceAccess(db: D1Database, input: {
    resource_id: string;
    space_id: string;
    permission: ResourcePermission;
    granted_by: string;
}): Promise<{
    created: boolean;
    access: {
        id: string;
        resource_id: string;
        space_id: string;
        permission: ResourcePermission;
        granted_by: string;
        created_at: string;
    };
    permission?: undefined;
} | {
    created: boolean;
    permission: ResourcePermission;
    access?: undefined;
}>;
export declare function deleteResourceAccess(db: D1Database, resourceId: string, spaceId: string): Promise<void>;
export declare function checkResourceAccess(db: D1Database, resourceId: string, userId: string, requiredPermissions?: ResourcePermission[]): Promise<boolean>;
export declare function canAccessResource(db: D1Database, resourceId: string, userId: string, requiredPermissions?: ResourcePermission[]): Promise<{
    canAccess: boolean;
    isOwner: boolean;
    permission?: ResourcePermission;
}>;
//# sourceMappingURL=access.d.ts.map