import type { Run } from '../../types';
import type { TranslationKey } from '../../i18n';
import type { ChatTimelineEventType } from './chat-types';

export type WebSocketEventPayload = {
  run?: Partial<Run>;
  status?: Run['status'];
  session_id?: string | null;
  lastEventId?: number;
  events?: Array<{
    id?: number;
    event_id?: string;
    timestamp?: number;
    created_at?: string;
    type: string;
    data: unknown;
  }>;
  message?: string;
  content?: string;
  text?: string;
  iteration?: number;
  id?: string;
  tool_call_id?: string;
  name?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
  result?: string;
  output?: string;
  error?: string;
};

const TIMELINE_EVENT_TYPES: ReadonlySet<ChatTimelineEventType> = new Set<ChatTimelineEventType>([
  'started',
  'run_status',
  'thinking',
  'tool_call',
  'tool_result',
  'progress',
  'message',
  'completed',
  'error',
  'cancelled',
  'run.failed',
]);

type RunTerminalStatus = Extract<Run['status'], 'completed' | 'failed' | 'cancelled'>;

const TERMINAL_RUN_STATUSES: ReadonlySet<RunTerminalStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

type TimelineStatusSourceEvent = {
  type: string;
  data: unknown;
};

export function parseTimelineEventId(event: { id?: number; event_id?: string }): number | undefined {
  const parsedEventId = typeof event.id === 'number'
    ? event.id
    : event.event_id
      ? Number.parseInt(event.event_id, 10)
      : undefined;
  if (typeof parsedEventId === 'number' && Number.isFinite(parsedEventId)) {
    return parsedEventId;
  }
  return undefined;
}

export function parseEventData(data: unknown): WebSocketEventPayload {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as WebSocketEventPayload;
    } catch {
      return { message: data };
    }
  }
  if (typeof data === 'object' && data !== null) {
    return data as WebSocketEventPayload;
  }
  return {};
}

export function normalizeTimelineEventType(eventType: string): ChatTimelineEventType {
  if (TIMELINE_EVENT_TYPES.has(eventType as ChatTimelineEventType)) {
    return eventType as ChatTimelineEventType;
  }
  return 'error';
}

export function getTerminalRunStatusFromTimelineEvent(
  type: ChatTimelineEventType,
  payload: WebSocketEventPayload,
): RunTerminalStatus | null {
  const isTerminalRunStatus = (status: unknown): status is RunTerminalStatus => (
    typeof status === 'string' && TERMINAL_RUN_STATUSES.has(status as RunTerminalStatus)
  );

  if (type === 'completed') return 'completed';
  if (type === 'cancelled') return 'cancelled';
  if (type === 'error' || type === 'run.failed') return 'failed';

  if (type === 'run_status') {
    const status = payload.status ?? payload.run?.status;
    if (isTerminalRunStatus(status)) {
      return status;
    }
  }

  return null;
}

export function deriveRunStatusFromTimelineEvents(
  fallbackStatus: Run['status'],
  events: TimelineStatusSourceEvent[],
): Run['status'] {
  let derivedTerminalStatus: RunTerminalStatus | null = null;

  for (const event of events) {
    const normalizedType = normalizeTimelineEventType(event.type);
    const payload = parseEventData(event.data);
    const terminalStatus = getTerminalRunStatusFromTimelineEvent(normalizedType, payload);
    if (terminalStatus) {
      derivedTerminalStatus = terminalStatus;
    }
  }

  return derivedTerminalStatus ?? fallbackStatus;
}

export function isRunInRootTree(
  runId: string,
  rootRunId: string,
  runsById: Map<string, { parent_run_id?: string | null }>,
): boolean {
  let currentRunId: string | null | undefined = runId;
  const visited = new Set<string>();

  while (currentRunId) {
    if (currentRunId === rootRunId) {
      return true;
    }

    if (visited.has(currentRunId)) {
      return false;
    }
    visited.add(currentRunId);

    const run = runsById.get(currentRunId);
    currentRunId = run?.parent_run_id ?? null;
  }

  return false;
}


export function summarizeEvent(
  type: ChatTimelineEventType,
  payload: WebSocketEventPayload,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): { message: string; detail?: string; failed?: boolean } {
  const toolName = payload.tool || payload.name || t('unknown');

  function translateRunStatus(status?: string | null): string {
    if (!status) return '-';
    const key = `runStatus_${status}` as TranslationKey;
    const translated = t(key);
    return translated === key ? status : translated;
  }

  switch (type) {
    case 'started':
      return { message: t('timelineRunStarted') };
    case 'run_status':
      return {
        message: t('timelineStatusUpdated', {
          status: translateRunStatus(payload.status ?? payload.run?.status),
        }),
      };
    case 'thinking':
      return { message: payload.message || payload.content || payload.text || t('timelineThinking') };
    case 'tool_call': {
      let detail: string | undefined;
      if (payload.arguments || payload.args) {
        try {
          detail = JSON.stringify(payload.arguments || payload.args);
        } catch {
          detail = undefined;
        }
      }
      return {
        message: t('timelineToolCall', { tool: toolName }),
        detail,
      };
    }
    case 'tool_result':
      return {
        message: payload.error
          ? t('timelineToolFailed', { tool: toolName })
          : t('timelineToolCompleted', { tool: toolName }),
        detail: payload.error || payload.output || payload.result,
        failed: !!payload.error,
      };
    case 'progress':
      return { message: payload.message || payload.content || t('timelineProgress') };
    case 'message':
      return { message: t('timelineResponseUpdated'), detail: payload.content || payload.text };
    case 'completed':
      return { message: t('timelineRunCompleted') };
    case 'cancelled':
      return { message: t('timelineRunCancelled') };
    case 'run.failed':
      return { message: t('timelineRunFailed'), detail: payload.error || payload.message, failed: true };
    case 'error':
    default:
      return { message: t('timelineRunError'), detail: payload.error || payload.message, failed: true };
  }
}
