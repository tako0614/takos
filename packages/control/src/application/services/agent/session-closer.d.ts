/**
 * Auto-close session logic for the Agent Runner.
 *
 * Handles committing session changes (snapshot + file sync) on success,
 * or discarding changes on failure. Uses chunked processing to limit
 * memory usage and phase-aware rollback for error recovery.
 */
import type { Env } from '../../../shared/types';
import type { AgentContext, AgentEvent } from './agent-models';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
export interface SessionCloserDeps {
    env: Env;
    db: SqlDatabaseBinding;
    context: AgentContext;
    checkCancellation: (force?: boolean) => Promise<boolean>;
    emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => Promise<void>;
    getCurrentSessionId: () => Promise<string | null>;
}
/**
 * Auto-close session after run completion.
 * On success: commit changes (snapshot + file sync).
 * On failure: discard changes to prevent corruption.
 * Uses chunked processing and phase-aware rollback.
 */
export declare function autoCloseSession(deps: SessionCloserDeps, status: 'completed' | 'failed'): Promise<void>;
//# sourceMappingURL=session-closer.d.ts.map