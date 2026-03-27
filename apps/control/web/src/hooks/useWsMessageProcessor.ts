import { useCallback, useRef, useState } from 'react';
import type { TranslationKey } from '../providers/I18nProvider';
import { rpc, rpcJson } from '../lib/rpc';
import type {
  Run,
  ThreadHistoryFocus,
  ThreadHistoryRunNode,
  ThreadHistoryTaskContext,
} from '../types';
import type {
  ChatRunArtifactMap,
  ChatRunMetaMap,
  ChatStreamingState,
  ChatTimelineEntry,
} from '../views/chat/types';
import {
  normalizeTimelineEventType,
  parseEventData,
  parseTimelineEventId,
  summarizeEvent,
  type WebSocketEventPayload,
} from '../views/chat/timeline';

export { parseEventData, type WebSocketEventPayload } from '../views/chat/timeline';

export const EMPTY_STREAMING: ChatStreamingState = {
  thinking: null,
  toolCalls: [],
  currentMessage: null,
};

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
  setStreaming: React.Dispatch<React.SetStateAction<ChatStreamingState>>;
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

export interface UseWsMessageProcessorOptions {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  isMountedRef: React.MutableRefObject<boolean>;
  fetchMessages: (showError?: boolean) => Promise<void>;
  setError: (value: string | null) => void;
  fetchSessionDiff: (sessionId: string) => Promise<void>;
}

export interface UseWsMessageProcessorResult {
  currentRun: Run | null;
  setCurrentRun: React.Dispatch<React.SetStateAction<Run | null>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  streaming: ChatStreamingState;
  setStreaming: React.Dispatch<React.SetStateAction<ChatStreamingState>>;
  resetStreamingState: () => void;
  timelineEntries: ChatTimelineEntry[];
  runMetaById: ChatRunMetaMap;
  runMetaRef: React.MutableRefObject<ChatRunMetaMap>;
  artifactsByRunId: ChatRunArtifactMap;
  historyFocus: ThreadHistoryFocus | null;
  taskContext: ThreadHistoryTaskContext | null;
  resetTimeline: () => void;
  applyHistorySnapshot: (snapshot: {
    runs: ThreadHistoryRunNode[];
    focus: ThreadHistoryFocus | null;
    taskContext: ThreadHistoryTaskContext | null;
  }) => void;
  upsertRunMeta: (run: Partial<Run> & { id: string }) => void;
  appendTimelineEntry: (
    runId: string,
    eventType: string,
    payload: WebSocketEventPayload,
    eventId?: number,
    createdAt?: number,
  ) => void;
  verifyRunStatus: (runId: string, refreshMessages?: boolean) => Promise<boolean>;
  handleRunCompletedRef: React.MutableRefObject<(run?: Partial<Run>, sessionId?: string | null) => Promise<void>>;
  handleWebSocketEventRef: React.MutableRefObject<(
    eventType: string,
    data: unknown,
    eventId?: number,
    sourceRunId?: string,
  ) => void>;
  runEventCursorRef: React.MutableRefObject<Map<string, number>>;
}

export function useWsMessageProcessor({
  t,
  isMountedRef,
  fetchMessages,
  setError,
  fetchSessionDiff,
}: UseWsMessageProcessorOptions): UseWsMessageProcessorResult {
  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streaming, setStreaming] = useState<ChatStreamingState>(EMPTY_STREAMING);
  const [timelineEntries, setTimelineEntries] = useState<ChatTimelineEntry[]>([]);
  const [runMetaById, setRunMetaById] = useState<ChatRunMetaMap>({});
  const [artifactsByRunId, setArtifactsByRunId] = useState<ChatRunArtifactMap>({});
  const [historyFocus, setHistoryFocus] = useState<ThreadHistoryFocus | null>(null);
  const [taskContext, setTaskContext] = useState<ThreadHistoryTaskContext | null>(null);

  const runEventCursorRef = useRef<Map<string, number>>(new Map());
  const runMetaRef = useRef<ChatRunMetaMap>({});

  const handleRunCompletedRef = useRef<(run?: Partial<Run>, sessionId?: string | null) => Promise<void>>(
    async () => {},
  );
  const handleWebSocketEventRef = useRef<(
    eventType: string,
    data: unknown,
    eventId?: number,
    sourceRunId?: string,
  ) => void>(() => {});

  const resetStreamingState = useCallback((): void => {
    setStreaming(EMPTY_STREAMING);
  }, []);

  const resetTimeline = useCallback((): void => {
    runEventCursorRef.current = new Map();
    runMetaRef.current = {};
    setTimelineEntries([]);
    setRunMetaById({});
    setArtifactsByRunId({});
    setHistoryFocus(null);
    setTaskContext(null);
  }, []);

  const applyHistorySnapshot = useCallback((snapshot: {
    runs: ThreadHistoryRunNode[];
    focus: ThreadHistoryFocus | null;
    taskContext: ThreadHistoryTaskContext | null;
  }): void => {
    runEventCursorRef.current = new Map();
    runMetaRef.current = {};

    const nextRunMeta: ChatRunMetaMap = {};
    const nextArtifacts: ChatRunArtifactMap = {};
    const nextTimelineEntries: ChatTimelineEntry[] = [];

    for (const node of snapshot.runs) {
      nextRunMeta[node.run.id] = {
        runId: node.run.id,
        parentRunId: node.run.parent_run_id,
        agentType: node.run.agent_type,
        status: node.run.status,
      };

      nextArtifacts[node.run.id] = node.artifacts;

      for (const event of node.events) {
        const payload = parseEventData(event.data);
        const normalizedType = normalizeTimelineEventType(event.type);
        const summary = summarizeEvent(normalizedType, payload, t);
        nextTimelineEntries.push({
          key: `${node.run.id}:${event.id}`,
          seq: event.id,
          runId: node.run.id,
          type: normalizedType,
          eventId: event.id,
          message: summary.message,
          detail: summary.detail,
          failed: summary.failed,
          createdAt: Date.parse(event.created_at),
        });
        runEventCursorRef.current.set(node.run.id, event.id);
      }
    }

    nextTimelineEntries.sort((a, b) => (
      a.createdAt === b.createdAt
        ? a.seq - b.seq
        : a.createdAt - b.createdAt
    ));

    runMetaRef.current = nextRunMeta;
    setRunMetaById(nextRunMeta);
    setArtifactsByRunId(nextArtifacts);
    setTimelineEntries(nextTimelineEntries);
    setHistoryFocus(snapshot.focus);
    setTaskContext(snapshot.taskContext);
  }, [t]);

  const upsertRunMeta = useCallback((run: Partial<Run> & { id: string }) => {
    setRunMetaById((prev) => {
      const next: ChatRunMetaMap = {
        ...prev,
        [run.id]: {
          runId: run.id,
          parentRunId: typeof run.parent_run_id === 'string' ? run.parent_run_id : (prev[run.id]?.parentRunId ?? null),
          agentType: typeof run.agent_type === 'string' ? run.agent_type : (prev[run.id]?.agentType ?? 'default'),
          status: run.status ?? prev[run.id]?.status ?? 'queued',
        },
      };
      runMetaRef.current = next;
      return next;
    });
  }, []);

  const appendTimelineEntry = useCallback((
    runId: string,
    eventType: string,
    payload: WebSocketEventPayload,
    eventId?: number,
    createdAt?: number,
  ) => {
    const normalizedType = normalizeTimelineEventType(eventType);
    const summary = summarizeEvent(normalizedType, payload, t);
    const timestamp = createdAt ?? Date.now();
    const key = typeof eventId === 'number'
      ? `${runId}:${eventId}`
      : `${runId}:${normalizedType}:${timestamp}`;

    if (typeof eventId === 'number') {
      const previous = runEventCursorRef.current.get(runId) ?? 0;
      if (eventId > previous) {
        runEventCursorRef.current.set(runId, eventId);
      }
      // Prevent unbounded growth of cursor map
      if (runEventCursorRef.current.size > 100) {
        const oldest = runEventCursorRef.current.keys().next().value;
        if (oldest !== undefined) {
          runEventCursorRef.current.delete(oldest);
        }
      }
    }

    setTimelineEntries((prev) => {
      if (prev.some((entry) => entry.key === key)) {
        return prev;
      }
      const entry = {
        key,
        seq: typeof eventId === 'number' ? eventId : timestamp,
        runId,
        type: normalizedType,
        eventId,
        message: summary.message,
        detail: summary.detail,
        failed: summary.failed,
        createdAt: timestamp,
      };
      // Optimization: skip sort if new entry goes at the end (common case --
      // event IDs and timestamps are monotonically increasing)
      const last = prev[prev.length - 1];
      if (!last || timestamp > last.createdAt || (timestamp === last.createdAt && entry.seq >= last.seq)) {
        return [...prev, entry];
      }
      const next = [...prev, entry];
      next.sort((a, b) => (
        a.createdAt === b.createdAt
          ? a.seq - b.seq
          : a.createdAt - b.createdAt
      ));
      return next;
    });
  }, [t]);

  const verifyRunStatus = useCallback(async (runId: string, refreshMessages = true): Promise<boolean> => {
    try {
      const res = await rpc.runs[':id'].$get({
        param: { id: runId },
      });
      const data = await rpcJson<{ run: Run }>(res);
      const status = data.run?.status;
      if (data.run) {
        upsertRunMeta(data.run);
      }
      const isActive = !!status && ACTIVE_RUN_STATUSES.has(status);

      if (!isActive) {
        setIsLoading(false);
        setCurrentRun(null);
        resetStreamingState();
        // Note: closeWebSocket is called by the caller (connection manager)
        // after verifyRunStatus returns false
        fetchMessages();
        const sessionId = data.run?.session_id ?? undefined;
        if (sessionId) {
          fetchSessionDiff(sessionId);
        }
      } else if (refreshMessages) {
        fetchMessages();
      }
      return isActive;
    } catch (err) {
      console.error('Failed to verify run status:', err);
      return false;
    }
  }, [resetStreamingState, fetchMessages, fetchSessionDiff, upsertRunMeta]);

  return {
    currentRun,
    setCurrentRun,
    isLoading,
    setIsLoading,
    streaming,
    setStreaming,
    resetStreamingState,
    timelineEntries,
    runMetaById,
    runMetaRef,
    artifactsByRunId,
    historyFocus,
    taskContext,
    resetTimeline,
    applyHistorySnapshot,
    upsertRunMeta,
    appendTimelineEntry,
    verifyRunStatus,
    handleRunCompletedRef,
    handleWebSocketEventRef,
    runEventCursorRef,
  };
}
