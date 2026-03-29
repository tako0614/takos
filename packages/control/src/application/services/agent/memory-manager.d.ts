/**
 * Memory Manager - Handles memory runtime integration and memory graph processing.
 *
 * Extracted from runner.ts to separate memory concerns from the core run loop.
 */
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { Env } from '../../../shared/types';
import type { AgentContext } from './agent-models';
import type { AgentRunnerIo } from './runner-io';
import type { ToolExecutorLike } from '../../tools/executor';
import { AgentMemoryRuntime } from '../memory-graph/memory-graph-runtime';
export interface MemoryManagerDeps {
    db: SqlDatabaseBinding;
    env: Env;
    context: AgentContext;
    runIo: AgentRunnerIo;
}
export interface MemoryState {
    runtime: AgentMemoryRuntime | undefined;
}
/**
 * Initialize and bootstrap the memory runtime, wiring the tool observer into the
 * provided tool executor. Silently degrades if initialization fails.
 */
export declare function bootstrapMemory(deps: MemoryManagerDeps, state: MemoryState, toolExecutor: ToolExecutorLike | undefined): Promise<void>;
/**
 * Finalize the memory runtime (flush overlay claims to DB).
 * Safe to call even if runtime was never initialized.
 */
export declare function finalizeMemory(state: MemoryState): Promise<void>;
//# sourceMappingURL=memory-manager.d.ts.map