import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { InsertOf, SelectOf } from '../../../shared/types/drizzle-utils';
import { deployments } from '../../../infra/db';
import type { Deployment, DeploymentEvent } from './models';
type DeploymentInsert = InsertOf<typeof deployments>;
type DeploymentUpdate = Partial<InsertOf<typeof deployments>>;
export type DeploymentRow = SelectOf<typeof deployments>;
export declare function toApiDeployment(d: DeploymentRow): Deployment;
export declare function getDeploymentServiceId(deployment: Pick<Deployment, 'service_id' | 'worker_id'>): string;
export declare function getLatestDeploymentVersion(db: SqlDatabaseBinding, serviceId: string): Promise<number>;
export declare function createDeploymentWithVersion(db: SqlDatabaseBinding, serviceId: string, buildData: (version: number) => DeploymentInsert): Promise<{
    deployment: Deployment;
    version: number;
}>;
export declare function updateDeploymentRecord(db: SqlDatabaseBinding, deploymentId: string, data: DeploymentUpdate): Promise<void>;
export declare function updateServiceDeploymentPointers(db: SqlDatabaseBinding, serviceId: string, input: {
    activeDeploymentId: string | null;
    fallbackDeploymentId: string | null;
    activeDeploymentVersion: number | null;
    updatedAt: string;
    status?: string;
}): Promise<void>;
export declare function getDeploymentById(db: SqlDatabaseBinding, deploymentId: string): Promise<Deployment | null>;
export declare function getDeploymentByIdempotencyKey(db: SqlDatabaseBinding, serviceId: string, idempotencyKey: string): Promise<Deployment | null>;
export type ServiceDeploymentBasics = {
    exists: boolean;
    id: string;
    hostname: string | null;
    activeDeploymentId: string | null;
    fallbackDeploymentId: string | null;
    activeDeploymentVersion: number | null;
    workloadKind: string | null;
};
export declare function getServiceDeploymentBasics(db: SqlDatabaseBinding, serviceId: string): Promise<ServiceDeploymentBasics>;
export type ServiceRollbackInfo = ServiceDeploymentBasics;
export declare function getServiceRollbackInfo(db: SqlDatabaseBinding, serviceId: string): Promise<ServiceRollbackInfo | null>;
export declare function findDeploymentByServiceVersion(db: SqlDatabaseBinding, serviceId: string, version: number): Promise<Deployment | null>;
export declare function getDeploymentHistory(db: SqlDatabaseBinding, serviceId: string, limit: number): Promise<Deployment[]>;
export declare function getDeploymentEvents(db: SqlDatabaseBinding, deploymentId: string): Promise<DeploymentEvent[]>;
export declare function logDeploymentEvent(db: SqlDatabaseBinding, deploymentId: string, eventType: string, stepName: string | null, message: string | null, options?: {
    actorAccountId?: string | null;
    details?: Record<string, unknown>;
}): Promise<void>;
export declare function getStuckDeployments(db: SqlDatabaseBinding, cutoffIso: string): Promise<Deployment[]>;
export type DeploymentRouteHead = {
    exists: boolean;
    id: string;
    hostname: string | null;
    activeDeploymentId: string | null;
};
export declare function getDeploymentRouteHead(db: SqlDatabaseBinding, serviceId: string): Promise<DeploymentRouteHead>;
export type DeploymentRollbackAnchor = {
    id: string;
    activeDeploymentId: string | null;
    fallbackDeploymentId: string | null;
    activeDeploymentVersion: number | null;
};
export declare function getDeploymentRollbackAnchor(db: SqlDatabaseBinding, serviceId: string): Promise<DeploymentRollbackAnchor | null>;
export type DeploymentRoutingServiceRecord = {
    id: string;
    hostname: string | null;
    activeDeploymentId: string | null;
    customDomains: Array<{
        domain: string | null;
    }>;
};
export declare function getDeploymentRoutingServiceRecord(db: SqlDatabaseBinding, serviceId: string): Promise<DeploymentRoutingServiceRecord | null>;
export {};
//# sourceMappingURL=store.d.ts.map