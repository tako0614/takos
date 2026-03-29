/**
 * Agent Runner - Public API entry point.
 *
 * Contains the AgentRunner class (thin shell) and re-exports for backward
 * compatibility.
 */
import type { Env } from '../../../shared/types';
import type { ObjectStoreBinding, SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { AgentContext } from './agent-models';
export type { AgentRunnerIo } from './runner-io';
export { type EventEmitterState, emitEventImpl, buildTerminalEventPayloadImpl, } from './runner-events';
export { updateRunStatusImpl, isValidToolCallsArray, type ConversationHistoryDeps, normalizeRunStatus, buildConversationHistory, } from './runner-history';
export { executeRun } from './execute-run';
export declare class AgentRunner {
    private db;
    private env;
    private context;
    private config;
    private toolExecutor;
    private totalUsage;
    private abortSignal?;
    private toolCallCount;
    private totalToolCalls;
    private lastCancelCheck;
    private isCancelled;
    private static readonly CANCEL_CHECK_INTERVAL_MS;
    private toolExecutions;
    private eventState;
    private runIo;
    private llm;
    private skillState;
    private skillDeps;
    private memoryState;
    private memoryDeps;
    constructor(env: Env, db: SqlDatabaseBinding, _storage: ObjectStoreBinding | undefined, apiKey: string | undefined, context: AgentContext, agentType: string, aiModel: string | undefined, options: {
        abortSignal?: AbortSignal;
        runIo: import('./runner-io').AgentRunnerIo;
    });
    private emitEvent;
    private updateRunStatus;
    private buildTerminalEventPayload;
    private autoCloseSession;
    private checkCancellation;
    private throwIfCancelled;
    private getConversationHistory;
    private addMessage;
    private getCurrentSessionId;
    private getRunRecord;
    private buildOrchestrationDeps;
    run(): Promise<void>;
}
//# sourceMappingURL=runner.d.ts.map
