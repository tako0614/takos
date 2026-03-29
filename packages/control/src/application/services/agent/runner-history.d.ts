/**
 * Agent Runner Messages & Conversation History
 *
 * Run status persistence, conversation history building, and
 * message-related helpers extracted from runner.ts.
 */
import type { RunStatus, Env } from '../../../shared/types';
import type { AgentMessage, ToolCall } from './agent-models';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
/**
 * Update run status in the database.
 */
export declare function updateRunStatusImpl(db: SqlDatabaseBinding, runId: string, totalUsage: {
    inputTokens: number;
    outputTokens: number;
}, status: RunStatus, output?: string, error?: string): Promise<void>;
/** Type guard to validate tool_calls array structure */
export declare function isValidToolCallsArray(value: unknown): value is ToolCall[];
export interface ConversationHistoryDeps {
    db: SqlDatabaseBinding;
    env: Env;
    threadId: string;
    runId: string;
    spaceId: string;
    aiModel: string;
}
export declare function normalizeRunStatus(value: string | null | undefined): RunStatus | null;
export declare function buildConversationHistory(deps: ConversationHistoryDeps): Promise<AgentMessage[]>;
//# sourceMappingURL=runner-history.d.ts.map