import type { D1Database } from '../../../shared/types/bindings.ts';
import type { SpaceRole } from '../../../shared/types';
export declare const WORKSPACE_SERVICE_LIMITS: {
    maxServices: number;
};
export declare const WORKSPACE_WORKER_LIMITS: {
    maxWorkers: number;
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
export declare function slugifyServiceName(name: string): string;
export declare const slugifyWorkerName: typeof slugifyServiceName;
export declare function countServicesInSpace(d1: D1Database, spaceId: string): Promise<number>;
export declare function listServicesForUser(d1: D1Database, userId: string): Promise<{
    workspace_name: string;
    id: string;
    space_id: string;
    service_type: "app" | "service";
    status: "pending" | "building" | "deployed" | "failed" | "stopped";
    config: string | null;
    hostname: string | null;
    service_name: string | null;
    slug: string | null;
    created_at: string;
    updated_at: string;
}[]>;
export declare function listServicesForSpace(d1: D1Database, spaceId: string): Promise<ServiceRow[]>;
export declare function getServiceById(d1: D1Database, serviceId: string): Promise<ServiceRow | null>;
export declare function getServiceRouteRecord(d1: D1Database, serviceId: string): Promise<ServiceRouteRecord | null>;
export declare function getServiceRouteRecordForSpace(d1: D1Database, spaceId: string, serviceId: string): Promise<ServiceRouteRecord | null>;
export declare function resolveServiceReferenceRecord(d1: D1Database, spaceId: string, reference: string): Promise<ServiceRouteRecord | null>;
export declare function resolveServiceRouteReference(d1: D1Database, spaceId: string, reference: string): Promise<ServiceRouteRecord | null>;
export declare function listServiceRouteRecordsByIds(d1: D1Database, serviceIds: string[]): Promise<ServiceRouteRecord[]>;
export declare function getServiceRouteSummary(d1: D1Database, serviceId: string, spaceId?: string): Promise<ServiceRouteSummary | null>;
export declare function resolveServiceRouteSummaryForSpace(d1: D1Database, spaceId: string, reference: string): Promise<ServiceRouteSummary | null>;
export declare function findServiceRouteSummaryInSpace(d1: D1Database, spaceId: string, reference: string): Promise<ServiceRouteSummary | null>;
export declare function listSpaceServiceRouteCleanupRecords(d1: D1Database, spaceId: string): Promise<ServiceRouteCleanupRecord[]>;
export declare function listServiceRouteCleanupRecordsForSpace(d1: D1Database, spaceId: string): Promise<ServiceRouteCleanupRecord[]>;
export declare function getServiceForUser(d1: D1Database, serviceId: string, userId: string): Promise<{
    workspace_name: string;
    id: string;
    space_id: string;
    service_type: "app" | "service";
    status: "pending" | "building" | "deployed" | "failed" | "stopped";
    config: string | null;
    hostname: string | null;
    service_name: string | null;
    slug: string | null;
    created_at: string;
    updated_at: string;
} | null>;
export declare function getServiceForUserWithRole(d1: D1Database, serviceId: string, userId: string, roles?: SpaceRole[]): Promise<{
    member_role: SpaceRole;
    id: string;
    space_id: string;
    service_type: "app" | "service";
    status: "pending" | "building" | "deployed" | "failed" | "stopped";
    config: string | null;
    hostname: string | null;
    service_name: string | null;
    slug: string | null;
    created_at: string;
    updated_at: string;
} | null>;
export declare function createService(d1: D1Database, input: {
    spaceId: string;
    workerType: 'app' | 'service';
    slug?: string;
    config?: string | null;
    platformDomain: string;
}): Promise<{
    service: ServiceRow | null;
    worker: ServiceRow | null;
    id: string;
    slug: string;
    hostname: string;
    serviceSlotName: string;
    workerSlotName: string;
}>;
export declare function deleteService(d1: D1Database, serviceId: string): Promise<void>;
//# sourceMappingURL=workers.d.ts.map