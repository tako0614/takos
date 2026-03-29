/**
 * Main entry point for local-platform runtime.
 *
 * Re-exports the public API that was originally in this single 974-line file,
 * now split across focused modules:
 *
 *   runtime-types.ts          – shared types and constants
 *   runtime-http.ts           – HTTP utilities (forwarding, JSON response, etc.)
 *   runtime-gateway-stubs.ts  – in-process gateway stub factories
 *   runtime-host-fetch.ts     – runtime-host and browser-host fetch builders
 *   executor-control-rpc.ts   – executor control RPC handlers + executor-host fetch builder
 *   runtime-env.ts            – environment construction for production and tests
 */
export { DEFAULT_LOCAL_PORTS } from './runtime-types.ts';
export type { LocalFetch } from './runtime-types.ts';
export { buildLocalRuntimeHostFetch, buildLocalBrowserHostFetch } from './runtime-host-fetch.ts';
export { buildLocalExecutorHostFetch } from './executor-control-rpc.ts';
import type { LocalFetch } from './runtime-types.ts';
export declare function createLocalWebFetch(): Promise<LocalFetch>;
export declare function createLocalWebFetchForTests(): Promise<LocalFetch>;
export declare function createLocalDispatchFetch(): Promise<LocalFetch>;
export declare function createLocalDispatchFetchForTests(): Promise<LocalFetch>;
export declare function createLocalRuntimeHostFetch(): Promise<LocalFetch>;
export declare function createLocalExecutorHostFetch(): Promise<LocalFetch>;
export declare function createLocalBrowserHostFetch(): Promise<LocalFetch>;
export declare function createLocalRuntimeHostFetchForTests(): Promise<LocalFetch>;
export declare function createLocalExecutorHostFetchForTests(): Promise<LocalFetch>;
export declare function createLocalBrowserHostFetchForTests(): Promise<LocalFetch>;
//# sourceMappingURL=runtime.d.ts.map