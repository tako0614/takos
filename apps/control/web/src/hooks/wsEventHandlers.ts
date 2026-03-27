import type { Run } from '../types';
import type { WebSocketEventPayload } from '../views/chat/timeline';
import { parseTimelineEventId } from '../views/chat/timeline';
import type { TranslationKey } from '../store/i18n';

export const VALID_RUN_STATUSES: Set<string> = new Set([
  'pending', 'queued', 'running', 'completed', 'failed', 'cancelled',
]);

export const ACTIVE_RUN_STATUSES: Set<string> = new Set([
  'pending', 'queued', 'running',
]);

export const TERMINAL_RUN_STATUSES: Set<string> = new Set([
  'completed', 'failed', 'cancelled',
]);

export function getRunStatusFromPayload(payload: WebSocketEventPayload): Run['status'] | null {
  const status = payload.status ?? payload.run?.status;
  if (status && VALID_RUN_STATUSES.has(status)) {
    return status as Run['status'];
  }
  return null;
}

export function resolveThinkingText(payload: WebSocketEventPayload): string {
  return payload.message || payload.content || payload.text ||
    (payload.iteration ? `Step ${payload.iteration}...` : 'Processing...');
}

// ---------------------------------------------------------------------------
// Extracted event handlers -- each corresponds to a case in the event dispatch.
// They share a common signature via EventHandlerContext.
// ---------------------------------------------------------------------------

export interface EventHandlerContext {
  payload: WebSocketEventPayload;
  runId: string;
  eventId: number | undefined;
  eventType: string;
  isPrimaryRun: boolean;
  // deps
  verifyRunStatus: (runId: string, refreshMessages?: boolean) => Promise<boolean>;
  isMountedRef: React.MutableRefObject<boolean>;
  currentRunIdRef: React.MutableRefObject<string | null>;
  lastEventIdRef: React.MutableRefObject<number>;
  handleWebSocketEventRef: React.MutableRefObject<(
    eventType: string,
    data: unknown,
    eventId?: number,
    sourceRunId?: string,
  ) => void>;
  handleRunCompletedRef: React.MutableRefObject<(run?: Partial<Run>, sessionId?: string | null) => Promise<void>>;
  setCurrentRun: React.Dispatch<React.SetStateAction<Run | null>>;
  setStreaming: React.Dispatch<React.SetStateAction<import('../views/chat/types').ChatStreamingState>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: (value: string | null) => void;
  closeWebSocket: () => void;
  resetStreamingState: () => void;
  appendTimelineEntry: (
    runId: string,
    eventType: string,
    payload: WebSocketEventPayload,
    eventId?: number,
    createdAt?: number,
  ) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

function handleConnectedEvent(ctx: EventHandlerContext): void {
  const { payload, lastEventIdRef, currentRunIdRef, verifyRunStatus } = ctx;
  if (typeof payload.lastEventId === 'number' && payload.lastEventId > lastEventIdRef.current) {
    lastEventIdRef.current = payload.lastEventId;
  }
  if (currentRunIdRef.current) {
    verifyRunStatus(currentRunIdRef.current);
  }
}

function handleReplayEvent(ctx: EventHandlerContext): void {
  const {
    payload, currentRunIdRef, lastEventIdRef, verifyRunStatus,
    isMountedRef, handleWebSocketEventRef,
  } = ctx;
  if (!currentRunIdRef.current) return;

  const replayRunId = currentRunIdRef.current;
  verifyRunStatus(replayRunId).then((isActive) => {
    if (!isMountedRef.current) return;
    if (!replayRunId || currentRunIdRef.current !== replayRunId) return;
    if (!isActive || !payload.events) return;

    for (const event of payload.events) {
      const replayEventId = parseTimelineEventId(event);
      if (typeof replayEventId === 'number') {
        if (replayEventId <= lastEventIdRef.current) continue;
        lastEventIdRef.current = replayEventId;
      }
      handleWebSocketEventRef.current(event.type, event.data, replayEventId, replayRunId);
    }
  });
}

function handleRunStatusEvent(ctx: EventHandlerContext): void {
  const {
    payload, isPrimaryRun, runId, eventType, eventId,
    setCurrentRun, handleRunCompletedRef, appendTimelineEntry,
  } = ctx;

  if (isPrimaryRun) {
    const runStatus = getRunStatusFromPayload(payload);
    if (payload.run) {
      setCurrentRun((prev) =>
        prev ? { ...prev, ...payload.run, status: runStatus ?? prev.status } : prev,
      );
    } else if (runStatus) {
      setCurrentRun((prev) => (prev ? { ...prev, status: runStatus } : prev));
    }
    if (runStatus && TERMINAL_RUN_STATUSES.has(runStatus)) {
      handleRunCompletedRef.current(payload.run, payload.run?.session_id ?? payload.session_id ?? undefined);
    }
  }
  appendTimelineEntry(runId, eventType, payload, eventId);
}

function handleStartedEvent(ctx: EventHandlerContext): void {
  if (ctx.isPrimaryRun) {
    ctx.setStreaming((prev) => ({ ...prev, toolCalls: [] }));
  }
  ctx.appendTimelineEntry(ctx.runId, ctx.eventType, ctx.payload, ctx.eventId);
}

function handleThinkingEvent(ctx: EventHandlerContext): void {
  if (ctx.isPrimaryRun) {
    const text = resolveThinkingText(ctx.payload);
    ctx.setStreaming((prev) => ({ ...prev, thinking: text }));
  }
  ctx.appendTimelineEntry(ctx.runId, ctx.eventType, ctx.payload, ctx.eventId);
}

function handleToolCallEvent(ctx: EventHandlerContext): void {
  const { payload, isPrimaryRun, setStreaming, runId, eventType, eventId, appendTimelineEntry } = ctx;
  if (isPrimaryRun) {
    setStreaming((prev) => ({
      ...prev,
      toolCalls: [
        ...prev.toolCalls,
        {
          id: payload.id || payload.tool_call_id || `tc-${Date.now()}`,
          name: payload.name || payload.tool || 'unknown',
          arguments: payload.arguments || payload.args || {},
          status: 'running',
          startedAt: Date.now(),
        },
      ],
    }));
  }
  appendTimelineEntry(runId, eventType, payload, eventId);
}

function handleToolResultEvent(ctx: EventHandlerContext): void {
  const { payload, isPrimaryRun, setStreaming, runId, eventType, eventId, appendTimelineEntry } = ctx;
  if (isPrimaryRun) {
    setStreaming((prev) => ({
      ...prev,
      toolCalls: prev.toolCalls.map((tc) =>
        tc.id === payload.tool_call_id || tc.id === payload.id
          ? {
              ...tc,
              result: payload.result || payload.output,
              error: payload.error,
              status: payload.error ? ('error' as const) : ('completed' as const),
            }
          : tc,
      ),
    }));
  }
  appendTimelineEntry(runId, eventType, payload, eventId);
}

function handleProgressEvent(ctx: EventHandlerContext): void {
  const { payload, isPrimaryRun, setStreaming, runId, eventType, eventId, appendTimelineEntry } = ctx;
  if (isPrimaryRun && (payload.message || payload.content)) {
    setStreaming((prev) => ({
      ...prev,
      thinking: payload.message || payload.content || prev.thinking,
    }));
  }
  appendTimelineEntry(runId, eventType, payload, eventId);
}

function handleMessageEvent(ctx: EventHandlerContext): void {
  if (ctx.isPrimaryRun) {
    ctx.setStreaming((prev) => ({
      ...prev,
      currentMessage: ctx.payload.content || ctx.payload.text || null,
      thinking: null,
    }));
  }
  ctx.appendTimelineEntry(ctx.runId, ctx.eventType, ctx.payload, ctx.eventId);
}

function handleTerminalEvent(ctx: EventHandlerContext): void {
  if (ctx.isPrimaryRun) {
    ctx.handleRunCompletedRef.current(
      ctx.payload.run,
      ctx.payload.run?.session_id ?? ctx.payload.session_id ?? undefined,
    );
  }
  ctx.appendTimelineEntry(ctx.runId, ctx.eventType, ctx.payload, ctx.eventId);
}

function handleRunFailedEvent(ctx: EventHandlerContext): void {
  if (ctx.isPrimaryRun) {
    ctx.setIsLoading(false);
    ctx.setCurrentRun(null);
    ctx.closeWebSocket();
    ctx.resetStreamingState();
    ctx.setError(ctx.payload.error || ctx.t('networkError'));
  }
  ctx.appendTimelineEntry(ctx.runId, ctx.eventType, ctx.payload, ctx.eventId);
}

type EventHandler = (ctx: EventHandlerContext) => void;

export const EVENT_DISPATCH: Record<string, EventHandler> = {
  connected: handleConnectedEvent,
  replay: handleReplayEvent,
  subscribed: () => {},
  run_status: handleRunStatusEvent,
  started: handleStartedEvent,
  thinking: handleThinkingEvent,
  tool_call: handleToolCallEvent,
  tool_result: handleToolResultEvent,
  progress: handleProgressEvent,
  message: handleMessageEvent,
  completed: handleTerminalEvent,
  error: handleTerminalEvent,
  cancelled: handleTerminalEvent,
  'run.failed': handleRunFailedEvent,
};
