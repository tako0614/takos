import type { RunStatus } from '../../../shared/types';
import type { RunTerminalPayload } from '../run-notifier';
import type { AgentEvent } from './agent-models';
export declare class RunCancelledError extends Error {
    constructor(message?: string);
}
export declare function shouldResetRunToQueuedOnContainerError(status: RunStatus | null | undefined): boolean;
export interface RunLifecycleDeps {
    updateRunStatus: (status: RunStatus, output?: string, error?: string) => Promise<void>;
    emitEvent: (type: AgentEvent['type'], data: Record<string, unknown>) => Promise<void>;
    buildTerminalEventPayload: (status: 'completed' | 'failed' | 'cancelled', details?: Record<string, unknown>) => RunTerminalPayload;
    autoCloseSession: (status: 'completed' | 'failed') => Promise<void>;
    enqueuePostRunJobs: () => Promise<void>;
    sanitizeErrorMessage: (error: string) => string;
}
export declare function handleSuccessfulRunCompletion(deps: RunLifecycleDeps): Promise<void>;
export declare function handleCancelledRun(deps: RunLifecycleDeps): Promise<void>;
export declare function handleFailedRun(deps: RunLifecycleDeps, error: unknown): Promise<void>;
//# sourceMappingURL=run-lifecycle.d.ts.map