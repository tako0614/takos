import type { RoutingStore } from './application/services/routing/routing-models';
import type { DurableNamespaceBinding, KvStoreBinding, PlatformExecutionContext } from './shared/types/bindings.ts';
import type { ControlPlatform } from './platform/platform-config.ts';
type ServiceBinding = {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};
interface DispatchNamespace {
    get(name: string, options?: {
        deploymentId?: string;
    }): ServiceBinding;
}
export interface DispatchEnv {
    HOSTNAME_ROUTING?: KvStoreBinding;
    ROUTING_DO?: DurableNamespaceBinding;
    ROUTING_DO_PHASE?: string;
    ROUTING_STORE?: RoutingStore;
    DISPATCHER: DispatchNamespace;
    ADMIN_DOMAIN: string;
}
export declare function createDispatchWorker(buildPlatform?: (env: DispatchEnv) => ControlPlatform<DispatchEnv> | Promise<ControlPlatform<DispatchEnv>>): {
    fetch(request: Request, env: DispatchEnv, ctx: PlatformExecutionContext): Promise<Response>;
};
export declare const dispatchWorker: {
    fetch(request: Request, env: DispatchEnv, ctx: PlatformExecutionContext): Promise<Response>;
};
export default dispatchWorker;
//# sourceMappingURL=dispatch.d.ts.map