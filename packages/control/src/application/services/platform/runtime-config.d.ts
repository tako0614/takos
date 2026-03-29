import type { DesiredStateEnv, ServiceManagedMcpServerState, ServiceRuntimeConfigState, ServiceRuntimeLimits } from './desired-state-types';
export declare function getRuntimeConfig(env: DesiredStateEnv, spaceId: string, serviceId: string): Promise<ServiceRuntimeConfigState>;
export declare function saveRuntimeConfig(env: DesiredStateEnv, params: {
    spaceId: string;
    serviceId?: string;
    workerId?: string;
    compatibilityDate?: string;
    compatibilityFlags?: string[];
    limits?: ServiceRuntimeLimits;
    mcpServer?: ServiceManagedMcpServerState;
}): Promise<ServiceRuntimeConfigState>;
//# sourceMappingURL=runtime-config.d.ts.map