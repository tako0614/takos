import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import { type ReconcileUpdate } from '../common-env/repository';
import type { DesiredStateEnv, ServiceEnvRow, ServiceLocalEnvVarState } from './desired-state-types';
export declare function requireEncryptionKey(env: DesiredStateEnv): string;
export declare function buildServiceEnvSalt(serviceId: string, envName: string): string;
export declare function decryptServiceEnvRow(encryptionKey: string, row: ServiceEnvRow): Promise<ServiceLocalEnvVarState>;
export declare function resolveServiceCommonEnvState(env: DesiredStateEnv, spaceId: string, serviceId: string): Promise<{
    envBindings: WorkerBinding[];
    envVars: Record<string, string>;
    localEnvVars: ServiceLocalEnvVarState[];
    commonEnvUpdates: ReconcileUpdate[];
}>;
//# sourceMappingURL=env-state-resolution.d.ts.map