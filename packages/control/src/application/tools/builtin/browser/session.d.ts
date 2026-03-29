/**
 * Browser session helpers for tool handlers.
 *
 * Manages the mapping between a ToolContext (run) and the active browser session.
 * One session per run, stored in a module-level cache.
 */
import type { ToolContext } from '../../types';
export declare function getBrowserSessionId(context: ToolContext): string | undefined;
export declare function setBrowserSessionId(context: ToolContext, sessionId: string): void;
export declare function clearBrowserSessionId(context: ToolContext): void;
export declare function requireBrowserSessionId(context: ToolContext): string;
/**
 * Forward a request to the BROWSER_HOST service binding.
 */
export declare function browserHostFetch(context: ToolContext, path: string, init?: RequestInit): Promise<Response>;
//# sourceMappingURL=session.d.ts.map