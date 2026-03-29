import type { RunStatus } from '../../../shared/types';
export type RunTerminalEventType = 'completed' | 'error' | 'cancelled' | 'run.failed';
export type RunTerminalStatus = 'completed' | 'failed' | 'cancelled';
export declare const RUN_TERMINAL_EVENT_TYPES: Set<RunTerminalEventType>;
export declare const RUN_TERMINAL_STATUSES: ReadonlySet<RunStatus>;
export type RunTerminalPayload = {
    status: RunTerminalStatus;
    run: {
        id: string;
        session_id: string | null;
    };
} & Record<string, unknown>;
export declare function buildTerminalPayload(runId: string, status: RunTerminalStatus, details?: Record<string, unknown>, sessionId?: string | null): RunTerminalPayload;
export declare function buildRunFailedPayload(runId: string, error: string, options?: {
    permanent?: boolean;
    sessionId?: string | null;
}): RunTerminalPayload;
export declare const TERMINAL_STATUS_BY_EVENT_TYPE: Readonly<Record<RunTerminalEventType, RunTerminalStatus>>;
export declare function isRunTerminalStatus(status: unknown): status is RunTerminalStatus;
export declare function parseRunEventPayload(data: unknown): Record<string, unknown> | null;
export declare function deriveTerminalStatusFromRunEvent(eventType: string, eventData: unknown): RunTerminalStatus | null;
//# sourceMappingURL=run-events-contract.d.ts.map