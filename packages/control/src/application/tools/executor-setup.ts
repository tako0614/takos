import type { ToolContext, ContainerStartFailure } from './tool-definitions';
import type { Env } from '../../shared/types';
import type { SpaceRole } from '../../shared/types';
import type { ObjectStoreBinding, SqlDatabaseBinding } from '../../shared/types/bindings.ts';
import { createToolResolver, type ToolResolverOptions } from './resolver';
import { resolveAllowedCapabilities } from '../services/platform/capabilities';
import { logError, logWarn } from '../../shared/utils/logger';
import { ToolExecutor } from './executor';
import { buildPerRunCapabilityRegistry } from './executor-utils';

/** Session state with reference counting to prevent sessionId changes during execution. */
export class SessionState {
  private _sessionId: string | undefined;
  private _lastContainerStartFailure: ContainerStartFailure | undefined;
  private _activeExecutions = 0;
  private _pendingClear: (() => void) | null = null;
  private _pendingClearTimeout: ReturnType<typeof setTimeout> | null = null;

  private static readonly MAX_PENDING_CLEAR_WAIT_MS = 5 * 60 * 1000;
  private static readonly EXECUTION_COUNT_WARNING_THRESHOLD = 50;

  constructor(initialSessionId: string | undefined) {
    this._sessionId = initialSessionId;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  get lastContainerStartFailure(): ContainerStartFailure | undefined {
    return this._lastContainerStartFailure;
  }

  beginExecution(): string | undefined {
    this._activeExecutions++;

    if (this._activeExecutions > SessionState.EXECUTION_COUNT_WARNING_THRESHOLD) {
      logWarn(`High active execution count: ${this._activeExecutions}. ` +
        `This may indicate endExecution() is not being called properly.`, { module: 'sessionstate' });
    }

    return this._sessionId;
  }

  endExecution(): void {
    if (this._activeExecutions > 0) {
      this._activeExecutions--;
    } else {
      logWarn('Warning: endExecution called with no active executions', { module: 'tools/executor' });
    }

    if (this._activeExecutions === 0 && this._pendingClear) {
      this._clearPendingTimeout();
      this._pendingClear();
      this._pendingClear = null;
    }
  }

  private _clearPendingTimeout(): void {
    if (this._pendingClearTimeout) {
      clearTimeout(this._pendingClearTimeout);
      this._pendingClearTimeout = null;
    }
  }

  setSessionId(newSessionId: string | undefined): void {
    if (newSessionId !== undefined) {
      this._sessionId = newSessionId;
      this._lastContainerStartFailure = undefined;
      this._clearPendingTimeout();
      this._pendingClear = null;
    } else {
      if (this._activeExecutions > 0) {
        logWarn(`Warning: Deferring sessionId clear - ${this._activeExecutions} executions active`, { module: 'tools/executor' });
        this._pendingClear = () => {
          this._sessionId = undefined;
        };

        this._clearPendingTimeout();
        this._pendingClearTimeout = setTimeout(() => {
          if (this._pendingClear && this._activeExecutions > 0) {
            logError(`Session clear still pending after ${SessionState.MAX_PENDING_CLEAR_WAIT_MS / 1000}s - ` +
              `${this._activeExecutions} executions still active. NOT force-clearing to prevent data corruption.`, undefined, { module: 'tools/executor' });
          } else if (this._pendingClear) {
            this._pendingClear();
            this._pendingClear = null;
          }
          this._pendingClearTimeout = null;
        }, SessionState.MAX_PENDING_CLEAR_WAIT_MS);
      } else {
        this._sessionId = undefined;
      }
    }
  }

  setLastContainerStartFailure(failure: ContainerStartFailure | undefined): void {
    this._lastContainerStartFailure = failure;
  }

  async waitForPendingClear(timeoutMs: number = 30000): Promise<boolean> {
    if (!this._pendingClear && this._activeExecutions === 0) {
      return true;
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (!this._pendingClear && this._activeExecutions === 0) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return false;
  }

  get activeExecutions(): number {
    return this._activeExecutions;
  }

  get hasPendingClear(): boolean {
    return this._pendingClear !== null;
  }

  cleanup(): void {
    this._clearPendingTimeout();
    this._sessionId = undefined;
    this._lastContainerStartFailure = undefined;
    this._activeExecutions = 0;
    this._pendingClear = null;
  }
}

export async function createToolExecutor(
  env: Env,
  db: SqlDatabaseBinding,
  storage: ObjectStoreBinding | undefined,
  spaceId: string,
  sessionId: string | undefined,
  threadId: string,
  runId: string,
  userId: string,
  options?: ToolResolverOptions,
  toolExecutionTimeoutMs?: number,
  runAbortSignal?: AbortSignal,
  accessPolicy?: {
    minimumRole?: SpaceRole;
  },
): Promise<ToolExecutor> {
  const { ctx, allowed } = await resolveAllowedCapabilities({
    db,
    spaceId,
    userId,
    minimumRole: accessPolicy?.minimumRole,
  });

  const resolver = await createToolResolver(db, spaceId, env, {
    ...options,
    mcpExposureContext: {
      role: ctx.role,
      capabilities: Array.from(allowed),
    },
  });

  const sessionState = new SessionState(sessionId);

  const context: ToolContext = {
    spaceId,
    get sessionId() { return sessionState.sessionId; },
    threadId,
    runId,
    userId,
    role: ctx.role,
    capabilities: Array.from(allowed),
    env,
    db,
    storage,
    setSessionId: (newSessionId: string | undefined) => {
      sessionState.setSessionId(newSessionId);
    },
    getLastContainerStartFailure: () => sessionState.lastContainerStartFailure,
    setLastContainerStartFailure: (failure: ContainerStartFailure | undefined) => {
      sessionState.setLastContainerStartFailure(failure);
    },
    abortSignal: runAbortSignal,
  };

  const executor = new ToolExecutor(resolver, context, sessionState, undefined, toolExecutionTimeoutMs);
  const internalContext = context as ToolContext & {
    _toolExecutor?: Pick<ToolExecutor, 'execute'>;
  };
  internalContext.capabilityRegistry = buildPerRunCapabilityRegistry(executor);
  internalContext._toolExecutor = executor;

  return executor;
}
