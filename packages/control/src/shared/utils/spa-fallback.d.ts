import type { Env } from '../types';
/**
 * Serve the SPA index.html from the ASSETS binding.
 * Used when server-side routes want to hand off rendering to the React app.
 * Returns null if ASSETS is unavailable (fallback to server-rendered HTML).
 */
export declare function serveSpaFallback(env: Env, requestUrl: string): Promise<Response | null>;
//# sourceMappingURL=spa-fallback.d.ts.map