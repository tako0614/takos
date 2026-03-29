import type { ServiceBindingFetcher } from '../shared/types/bindings.ts';
export type ServiceTargetMap = Record<string, string>;
export declare function parseServiceTargetMap(raw: string | undefined): ServiceTargetMap;
export declare function createForwardingFetcher(baseUrl: string): ServiceBindingFetcher;
export declare function createFetcherRegistry(targets: ServiceTargetMap, fallback?: (name: string) => ServiceBindingFetcher): {
    get(name: string): ServiceBindingFetcher;
};
//# sourceMappingURL=url-registry.d.ts.map