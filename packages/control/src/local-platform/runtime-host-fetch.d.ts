import type { LocalFetch } from './runtime-types.ts';
export declare function buildLocalRuntimeHostFetch(env: {
    RUNTIME_CONTAINER: unknown;
}): Promise<LocalFetch>;
export declare function buildLocalBrowserHostFetch(env: {
    BROWSER_CONTAINER: unknown;
}): Promise<LocalFetch>;
//# sourceMappingURL=runtime-host-fetch.d.ts.map