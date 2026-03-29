import type { ContainerStartFailure } from './tool-definitions';
import type { Env } from '../../shared/types';
import type { SpaceRole } from '../../shared/types';
import type { ObjectStoreBinding, SqlDatabaseBinding } from '../../shared/types/bindings.ts';
import { type ToolResolverOptions } from './resolver';
import { ToolExecutor } from './executor';
/** Session state with reference counting to prevent sessionId changes during execution. */
export declare class SessionState {
    private _sessionId;
    private _lastContainerStartFailure;
    private _activeExecutions;
    private _pendingClear;
    private _pendingClearTimeout;
    private static readonly MAX_PENDING_CLEAR_WAIT_MS;
    private static readonly EXECUTION_COUNT_WARNING_THRESHOLD;
    constructor(initialSessionId: string | undefined);
    get sessionId(): string | undefined;
    get lastContainerStartFailure(): ContainerStartFailure | undefined;
    beginExecution(): string | undefined;
    endExecution(): void;
    private _clearPendingTimeout;
    setSessionId(newSessionId: string | undefined): void;
    setLastContainerStartFailure(failure: ContainerStartFailure | undefined): void;
    waitForPendingClear(timeoutMs?: number): Promise<boolean>;
    get activeExecutions(): number;
    get hasPendingClear(): boolean;
    cleanup(): void;
}
export declare function createToolExecutor(env: Env, db: SqlDatabaseBinding, storage: ObjectStoreBinding | undefined, spaceId: string, sessionId: string | undefined, threadId: string, runId: string, userId: string, options?: ToolResolverOptions, toolExecutionTimeoutMs?: number, runAbortSignal?: AbortSignal, accessPolicy?: {
    minimumRole?: SpaceRole;
}): Promise<ToolExecutor>;
//# sourceMappingURL=executor-setup.d.ts.map