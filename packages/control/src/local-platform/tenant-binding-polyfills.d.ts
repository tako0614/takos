/**
 * Generates a wrapper entry script (`__takos_entry.mjs`) that intercepts
 * the tenant worker's env bindings and replaces CF-native bindings
 * (Vectorize, AI, Analytics Engine, Workflow) with polyfill objects that
 * delegate to host-side RPC service bindings.
 *
 * The generated script is pure ES module JavaScript — no TypeScript, no
 * external imports beyond the tenant's own `bundle.mjs`.
 */
export type PolyfillBindingEntry = {
    /** Binding name as seen by tenant code (e.g., "VECTORIZE", "AI"). */
    name: string;
    /** Polyfill type determines which client object to generate. */
    type: 'vectorize' | 'ai' | 'analytics_engine' | 'workflow';
    /** Name of the hidden Miniflare service binding for RPC. */
    rpcBindingName: string;
};
export type PolyfillConfig = {
    bindings: PolyfillBindingEntry[];
    /** Max subrequests per request (injected as fetch wrapper). 0 = unlimited. */
    maxSubrequests?: number;
};
/**
 * Returns `null` if no polyfill bindings are needed (no wrapper necessary).
 */
export declare function generateWrapperScript(config: PolyfillConfig): string | null;
//# sourceMappingURL=tenant-binding-polyfills.d.ts.map