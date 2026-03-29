import type { RoutingStore } from '../../application/services/routing/routing-models.ts';
import type { ControlPlatform, PlatformConfig, PlatformServiceBinding, PlatformServices, PlatformSource } from '../platform-config.ts';
export type PlatformEnvRecord = Record<string, unknown>;
export declare function getString(env: PlatformEnvRecord, key: string): string | undefined;
export declare function getServiceRegistry(env: PlatformEnvRecord): {
    get(name: string, options?: {
        deploymentId?: string;
    }): PlatformServiceBinding;
} | undefined;
type PlatformConfigInput = {
    adminDomain?: string;
    tenantBaseDomain?: string;
    environment?: string;
    googleClientId?: string;
    googleClientSecret?: string;
    platformPrivateKey?: string;
    platformPublicKey?: string;
    encryptionKey?: string;
    serviceInternalJwtIssuer?: string;
};
type PlatformServiceInputs = {
    routing: PlatformServices['routing'];
    sqlBinding?: NonNullable<PlatformServices['sql']>['binding'];
    routingStore?: RoutingStore;
    hostnameRouting?: PlatformServices['hostnameRouting'];
    queues?: PlatformServices['queues'];
    objects?: PlatformServices['objects'];
    notifications?: PlatformServices['notifications'];
    locks?: PlatformServices['locks'];
    hosts?: PlatformServices['hosts'];
    ai?: PlatformServices['ai'];
    assets?: PlatformServices['assets'];
    documents?: PlatformServices['documents'];
    serviceRegistry?: {
        get(name: string, options?: {
            deploymentId?: string;
        }): PlatformServiceBinding;
    };
    sseNotifier?: PlatformServices['sseNotifier'];
};
export declare function createPlatformConfig(input: PlatformConfigInput): PlatformConfig;
export declare function createRoutingService(options: {
    resolveHostname: PlatformServices['routing']['resolveHostname'];
}): PlatformServices['routing'];
export declare function createPlatformServices(input: PlatformServiceInputs): PlatformServices;
export declare function buildPlatform<TBindings extends object>(source: PlatformSource, bindings: TBindings, config: PlatformConfig, services: PlatformServices): ControlPlatform<TBindings>;
export type PlatformOverrides = {
    source: PlatformSource;
    documents?: PlatformServices['documents'];
    sseNotifier?: PlatformServices['sseNotifier'];
};
export declare function buildCommonPlatform<TBindings extends object>(env: TBindings & PlatformEnvRecord, overrides: PlatformOverrides): ControlPlatform<TBindings>;
export {};
//# sourceMappingURL=shared.d.ts.map