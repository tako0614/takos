import type { Env } from '../shared/types/index.ts';
import type { DispatchEnv } from '../dispatch.ts';
export declare const LOCAL_DEV_DEFAULTS: {
    readonly GOOGLE_CLIENT_ID: "local-google-client";
    readonly GOOGLE_CLIENT_SECRET: "local-google-secret";
    readonly PLATFORM_PRIVATE_KEY: "local-platform-private-key";
    readonly PLATFORM_PUBLIC_KEY: "local-platform-public-key";
    readonly ENCRYPTION_KEY: "local-encryption-key";
};
/** Options for {@link disposeNodePlatformState}. */
export interface DisposeOptions {
    /** If true, also delete the local data directory on disk. */
    clearData?: boolean;
}
/**
 * Tear down the shared singleton state, closing DB connections, Redis
 * clients, and dispatch registries.
 *
 * Pass `{ clearData: true }` to also remove the local data directory
 * (equivalent to the old `clearNodePlatformDataForTests`).
 */
export declare function disposeNodePlatformState(opts?: DisposeOptions): Promise<void>;
/** @deprecated Use {@link disposeNodePlatformState} directly. */
export declare function resetNodePlatformStateForTests(): Promise<void>;
/** @deprecated Use `disposeNodePlatformState({ clearData: true })`. */
export declare function clearNodePlatformDataForTests(): Promise<void>;
export declare function createNodeWebEnv(): Promise<Env>;
export declare function createNodeDispatchEnv(): Promise<DispatchEnv>;
//# sourceMappingURL=env-builder.d.ts.map