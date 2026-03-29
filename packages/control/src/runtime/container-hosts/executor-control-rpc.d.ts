/**
 * Control-plane RPC handlers for the executor-host subsystem.
 *
 * These handle /rpc/control/* requests: conversation history, skill planning,
 * memory graph activation/finalization, message persistence, tool execution,
 * run status updates, and run event emission.
 */
import type { Env } from './executor-utils';
export declare function handleConversationHistory(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleSkillPlan(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleMemoryActivation(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleMemoryFinalize(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleAddMessage(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleUpdateRunStatus(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleToolCatalog(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleToolExecute(body: Record<string, unknown>, env: Env): Promise<Response>;
export declare function handleToolCleanup(body: Record<string, unknown>): Promise<Response>;
export declare function handleRunEvent(body: Record<string, unknown>, env: Env): Promise<Response>;
//# sourceMappingURL=executor-control-rpc.d.ts.map