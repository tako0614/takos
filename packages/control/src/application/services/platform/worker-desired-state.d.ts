import type { RoutingTarget } from '../routing/types';
export type { ServiceManagedMcpServerState, ServiceRuntimeConfigState, ServiceLocalEnvVarState, ServiceLocalEnvVarSummary, ServiceDesiredStateSnapshot, } from './desired-state-types';
import type { DesiredStateEnv, ServiceManagedMcpServerState, ServiceRuntimeConfigState, ServiceRuntimeLimits, ServiceLocalEnvVarState, ServiceLocalEnvVarSummary, ServiceDesiredStateSnapshot } from './desired-state-types';
import { resolveServiceCommonEnvState } from './env-state-resolution';
export { resolveServiceCommonEnvState } from './env-state-resolution';
export declare class ServiceDesiredStateService {
    private readonly env;
    private readonly encryptionKey;
    constructor(env: DesiredStateEnv);
    private get db();
    getRuntimeConfig(spaceId: string, serviceId: string): Promise<ServiceRuntimeConfigState>;
    saveRuntimeConfig(params: {
        spaceId: string;
        serviceId?: string;
        workerId?: string;
        compatibilityDate?: string;
        compatibilityFlags?: string[];
        limits?: ServiceRuntimeLimits;
        mcpServer?: ServiceManagedMcpServerState;
    }): Promise<ServiceRuntimeConfigState>;
    listLocalEnvVars(spaceId: string, serviceId: string): Promise<ServiceLocalEnvVarState[]>;
    listLocalEnvVarSummaries(spaceId: string, serviceId: string): Promise<ServiceLocalEnvVarSummary[]>;
    replaceLocalEnvVars(params: {
        spaceId: string;
        serviceId?: string;
        workerId?: string;
        variables: Array<{
            name: string;
            value: string;
            secret?: boolean;
        }>;
    }): Promise<void>;
    listResourceBindings(serviceId: string): Promise<Array<{
        id: string;
        name: string;
        type: string;
        resource_id: string;
        resource_name: string | null;
    }>>;
    replaceResourceBindings(params: {
        serviceId?: string;
        workerId?: string;
        bindings: Array<{
            name: string;
            type: string;
            resourceId: string;
            config?: Record<string, unknown>;
        }>;
    }): Promise<void>;
    resolveDeploymentState(spaceId: string, serviceId: string): Promise<ServiceDesiredStateSnapshot>;
    getCurrentDeploymentArtifactRef(serviceId: string): Promise<string | null>;
    getRoutingTarget(serviceId: string): Promise<RoutingTarget | null>;
}
export type WorkerManagedMcpServerState = import('./desired-state-types').ServiceManagedMcpServerState;
export type WorkerRuntimeConfigState = import('./desired-state-types').ServiceRuntimeConfigState;
export type WorkerLocalEnvVarState = import('./desired-state-types').ServiceLocalEnvVarState;
export type WorkerLocalEnvVarSummary = import('./desired-state-types').ServiceLocalEnvVarSummary;
export type WorkerDesiredStateSnapshot = import('./desired-state-types').ServiceDesiredStateSnapshot;
export { ServiceDesiredStateService as WorkerDesiredStateService };
export { resolveServiceCommonEnvState as resolveWorkerCommonEnvState };
//# sourceMappingURL=worker-desired-state.d.ts.map