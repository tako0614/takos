import type { RunStatus } from '../../../shared/types';

export type RunTerminalEventType = 'completed' | 'error' | 'cancelled' | 'run.failed';
export type RunTerminalStatus = 'completed' | 'failed' | 'cancelled';

export const RUN_TERMINAL_EVENT_TYPES = new Set<RunTerminalEventType>([
  'completed',
  'error',
  'cancelled',
  'run.failed',
]);

export const RUN_TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'completed',
  'failed',
  'cancelled',
]);

export type RunTerminalPayload = {
  status: RunTerminalStatus;
  run: {
    id: string;
    session_id: string | null;
  };
} & Record<string, unknown>;

export function buildTerminalPayload(
  runId: string,
  status: RunTerminalStatus,
  details: Record<string, unknown> = {},
  sessionId: string | null = null,
): RunTerminalPayload {
  return {
    status,
    run: {
      id: runId,
      session_id: sessionId,
    },
    ...details,
  };
}

export function buildRunFailedPayload(
  runId: string,
  error: string,
  options: { permanent?: boolean; sessionId?: string | null } = {},
): RunTerminalPayload {
  return buildTerminalPayload(
    runId,
    'failed',
    {
      error,
      ...(options.permanent ? { permanent: true } : {}),
    },
    options.sessionId ?? null,
  );
}

export const TERMINAL_STATUS_BY_EVENT_TYPE: Readonly<Record<RunTerminalEventType, RunTerminalStatus>> = {
  completed: 'completed',
  error: 'failed',
  cancelled: 'cancelled',
  'run.failed': 'failed',
};

export function isRunTerminalStatus(status: unknown): status is RunTerminalStatus {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseRunEventPayload(data: unknown): Record<string, unknown> | null {
  if (typeof data === 'string') {
    try {
      return asRecord(JSON.parse(data));
    } catch {
      return null;
    }
  }
  return asRecord(data);
}

export function deriveTerminalStatusFromRunEvent(
  eventType: string,
  eventData: unknown,
): RunTerminalStatus | null {
  if (eventType in TERMINAL_STATUS_BY_EVENT_TYPE) {
    return TERMINAL_STATUS_BY_EVENT_TYPE[eventType as RunTerminalEventType];
  }
  if (eventType !== 'run_status') {
    return null;
  }

  const payload = parseRunEventPayload(eventData);
  if (!payload) {
    return null;
  }

  if (isRunTerminalStatus(payload.status)) {
    return payload.status;
  }

  const runPayload = asRecord(payload.run);
  if (runPayload && isRunTerminalStatus(runPayload.status)) {
    return runPayload.status;
  }

  return null;
}
