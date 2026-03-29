import type { Env, SpaceRole } from '../../../../shared/types';
import type { ServiceInfo } from './domain-models';
export declare function getServiceForUser(env: Env, serviceId: string, userId: string, roles?: SpaceRole[]): Promise<ServiceInfo | null>;
export declare function requireServiceWriteAccess(env: Env, serviceId: string, userId: string): Promise<ServiceInfo>;
//# sourceMappingURL=access.d.ts.map