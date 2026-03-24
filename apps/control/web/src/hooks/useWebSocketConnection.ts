import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranslationKey } from '../providers/I18nProvider';
import { rpc, rpcJson } from '../lib/rpc';
import type {
  Message,
  Run,
  SessionDiff,
  ThreadHistoryArtifactSummary,
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
  isRunInRootTree,
  normalizeTimelineEventType,
  parseEventData,
  parseTimelineEventId,
  summarizeEvent,
  type WebSocketEventPayload,
} from '../views/chat/timeline';

export interface SessionDiffState {
  sessionId: string;
  diff: SessionDiff;
}

interface PendingSessionDiffSummary {
  sessionId: string;
  sessionStatus: string;
  git_mode: boolean;
}

export interface UseWebSocketConnectionOptions {
  threadId: string;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  isMountedRef: React.MutableRefObject<boolean>;
  fetchMessages: (showError?: boolean) => Promise<void>;
  startMessagePolling: (currentRunIdRef: React.MutableRefObject<string | null>) => void;
  stopMessagePolling: () => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setError: (value: string | null) => void;
}

export interface UseWebSocketConnectionResult {
  currentRun: Run | null;
  setCurrentRun: React.Dispatch<React.SetStateAction<Run | null>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  streaming: ChatStreamingState;
  resetStreamingState: () => void;
  timelineEntries: ChatTimelineEntry[];
  runMetaById: ChatRunMetaMap;
  artifactsByRunId: ChatRunArtifactMap;
  historyFocus: ThreadHistoryFocus | null;
  taskContext: ThreadHistoryTaskContext | null;
  resetTimeline: () => void;
  applyHistorySnapshot: (snapshot: {
    runs: ThreadHistoryRunNode[];
    focus: ThreadHistoryFocus | null;
    taskContext: ThreadHistoryTaskContext | null;
  }) => void;
  sessionDiff: SessionDiffState | null;
  setSessionDiff: React.Dispatch<React.SetStateAction<SessionDiffState | null>>;
  loadPendingSessionDiff: (pending: PendingSessionDiffSummary | null) => Promise<void>;
  isMerging: boolean;
  handleMerge: () => Promise<void>;
  isCancelling: boolean;
  setIsCancelling: React.Dispatch<React.SetStateAction<boolean>>;
  handleCancel: () => Promise<void>;
  dismissSessionDiff: () => void;
  startWebSocket: (runId: string) => void;
  closeWebSocket: () => void;
  currentRunIdRef: React.MutableRefObject<string | null>;
  lastEventIdRef: React.MutableRefObject<number>;
  rootRunIdRef: React.MutableRefObject<string | null>;
  syncThreadAfterSendFailure: () => Promise<void>;
}

const EMPTY_STREAMING: ChatStreamingState = {
  thinking: null,
  toolCalls: [],
  currentMessage: null,
};

const MAX_WS_RECONNECT_ATTEMPTS = 8;

const VALID_RUN_STATUSES: Set<string> = new Set([
  'pending', 'queued', 'running', 'completed', 'failed', 'cancelled',
]);

const ACTIVE_RUN_STATUSES: Set<string> = new Set([
  'pending', 'queued', 'running',
]);

const TERMINAL_RUN_STATUSES: Set<string> = new Set([
  'completed', 'failed', 'cancelled',
]);

function getRunStatusFromPayload(payload: WebSocketEventPayload): Run['status'] | null {
  const status = payload.status ?? payload.run?.status;
  if (status && VALID_RUN_STATUSES.has(status)) {
    return status as Run['status'];
  }
  return null;
}

function resolveThinkingText(payload: WebSocketEventPayload): string {
  return payload.message || payload.content || payload.text ||
    (payload.iteration ? `Step ${payload.iteration}...` : 'Processing...');
}

// ---------------------------------------------------------------------------
// Extracted event handlers – each corresponds to a case in the former switch.
// They share a common signature via EventHandlerContext.
// ---------------------------------------------------------------------------

interface EventHandlerContext {
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

const EVENT_DISPATCH: Record<string, EventHandler> = {
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

export function useWebSocketConnection({
  threadId,
  t,
  isMountedRef,
  fetchMessages,
  startMessagePolling,
  stopMessagePolling,
  setMessages,
  setError,
}: UseWebSocketConnectionOptions): UseWebSocketConnectionResult {
  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streaming, setStreaming] = useState<ChatStreamingState>(EMPTY_STREAMING);
  const [timelineEntries, setTimelineEntries] = useState<ChatTimelineEntry[]>([]);
  const [runMetaById, setRunMetaById] = useState<ChatRunMetaMap>({});
  const [artifactsByRunId, setArtifactsByRunId] = useState<ChatRunArtifactMap>({});
  const [historyFocus, setHistoryFocus] = useState<ThreadHistoryFocus | null>(null);
  const [taskContext, setTaskContext] = useState<ThreadHistoryTaskContext | null>(null);
  const [sessionDiff, setSessionDiff] = useState<SessionDiffState | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const currentRunIdRef = useRef<string | null>(null);
  const lastEventIdRef = useRef<number>(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPongRef = useRef<number>(Date.now());
  const wsReconnectAttemptsRef = useRef<number>(0);
  const rootRunIdRef = useRef<string | null>(null);
  const runEventCursorRef = useRef<Map<string, number>>(new Map());
  const runMetaRef = useRef<ChatRunMetaMap>({});

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
      // Optimization: skip sort if new entry goes at the end (common case —
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

  const closeWebSocket = useCallback((): void => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    stopMessagePolling();
    if (wsRef.current) {
      try {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      } catch (cleanupErr) {
        console.debug('WebSocket cleanup error (expected):', cleanupErr);
      }
      wsRef.current = null;
    }
    wsReconnectAttemptsRef.current = 0;
  }, [stopMessagePolling]);

  const fetchSessionDiff = useCallback(async (sessionId: string): Promise<void> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (rpc.sessions[':sessionId'] as any).diff.$get({
        param: { sessionId },
      });
      const data = await rpcJson<SessionDiff>(res);
      if (data.changes.length > 0) {
        setSessionDiff({ sessionId, diff: data });
      }
    } catch (err) {
      console.debug('Failed to fetch session diff:', err);
    }
  }, []);

  // handleRunCompleted, verifyRunStatus, handleWebSocketEvent, and startWebSocket
  // form a mutually recursive cluster. We use refs to break the circular dependency.
  const handleRunCompletedRef = useRef<(run?: Partial<Run>, sessionId?: string | null) => Promise<void>>(
    async () => {},
  );
  const handleWebSocketEventRef = useRef<(
    eventType: string,
    data: unknown,
    eventId?: number,
    sourceRunId?: string,
  ) => void>(() => {});
  const startWebSocketRef = useRef<(runId: string) => void>(() => {});

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
        closeWebSocket();
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
  }, [resetStreamingState, closeWebSocket, fetchMessages, fetchSessionDiff, upsertRunMeta]);

  // Assign the actual implementations to the refs.
  // These are updated on every render to capture the latest closures.

  handleRunCompletedRef.current = async (run?: Partial<Run>, sessionId?: string | null) => {
    const effectiveSessionId = sessionId ?? run?.session_id ?? undefined;
    if (effectiveSessionId) {
      fetchSessionDiff(effectiveSessionId);
    }

    closeWebSocket();
    currentRunIdRef.current = null;
    // Reset for next run (each run uses its own DO instance)
    lastEventIdRef.current = 0;

    setIsLoading(false);
    setCurrentRun(null);

    // Delay clearing streaming state until messages are fetched,
    // so thinking/tool calls remain visible during the transition.
    fetchMessages()
      .then(() => resetStreamingState())
      .catch((err) => {
        console.debug('Final message fetch failed:', err);
        resetStreamingState();
      });
  };

  handleWebSocketEventRef.current = (
    eventType: string,
    data: unknown,
    eventId?: number,
    sourceRunId?: string,
  ) => {
    const payload = parseEventData(data);
    const runId = payload.run?.id || sourceRunId || currentRunIdRef.current || '';
    if (!runId) return;
    const isPrimaryRun = runId === currentRunIdRef.current;
    if (payload.run?.id) {
      upsertRunMeta(payload.run as Partial<Run> & { id: string });
    }

    const handler = EVENT_DISPATCH[eventType];
    if (handler) {
      handler({
        payload,
        runId,
        eventId,
        eventType,
        isPrimaryRun,
        verifyRunStatus,
        isMountedRef,
        currentRunIdRef,
        lastEventIdRef,
        handleWebSocketEventRef,
        handleRunCompletedRef,
        setCurrentRun,
        setStreaming,
        setIsLoading,
        setError,
        closeWebSocket,
        resetStreamingState,
        appendTimelineEntry,
        t,
      });
    }
  };

  startWebSocketRef.current = (runId: string) => {
    const previousRunId = currentRunIdRef.current;
    if (previousRunId !== runId) {
      lastEventIdRef.current = 0;
      rootRunIdRef.current = runId;
    }

    closeWebSocket();
    currentRunIdRef.current = runId;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsParams = new URLSearchParams();
    if (lastEventIdRef.current > 0) {
      wsParams.set('last_event_id', String(lastEventIdRef.current));
    }
    const wsQuery = wsParams.toString();
    const wsUrl = `${protocol}//${window.location.host}/api/runs/${runId}/ws${wsQuery ? `?${wsQuery}` : ''}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // Connection timeout — if WebSocket doesn't open within 10s, force close.
      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          console.warn('[WS] Connection timeout, closing');
          ws.close();
        }
      }, 10_000);

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        ws.send(JSON.stringify({ type: 'subscribe', runId }));
        lastPongRef.current = Date.now();
        wsReconnectAttemptsRef.current = 0;

        startMessagePolling(currentRunIdRef);

        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const timeSinceLastPong = Date.now() - lastPongRef.current;
            if (timeSinceLastPong > 45000) {
              ws.close();
              return;
            }
            ws.send('ping');
          }
        }, 30000);
      };

      ws.onmessage = (event) => {
        if (event.data === 'pong') {
          lastPongRef.current = Date.now();
          return;
        }

        try {
          const message = JSON.parse(event.data) as {
            type: string;
            data?: unknown;
            eventId?: number;
            event_id?: string;
          };

          // Server-side JSON heartbeats also count as liveness signal.
          if (message.type === 'heartbeat') {
            lastPongRef.current = Date.now();
            return;
          }

          const parsedEventId = parseTimelineEventId({
            id: message.eventId,
            event_id: message.event_id,
          });

          if (typeof parsedEventId === 'number') {
            if (parsedEventId <= lastEventIdRef.current) {
              return;
            }
            // Detect event ID gaps — large gaps indicate possible event loss
            const gap = parsedEventId - lastEventIdRef.current;
            if (gap > 5 && lastEventIdRef.current > 0) {
              console.warn(`[WS] Event ID gap detected: ${lastEventIdRef.current} → ${parsedEventId} (gap=${gap})`);
              if (currentRunIdRef.current) {
                verifyRunStatus(currentRunIdRef.current);
              }
            }
            lastEventIdRef.current = parsedEventId;
          }
          handleWebSocketEventRef.current(
            message.type,
            message.data,
            parsedEventId,
            runId,
          );
        } catch (parseErr) {
          console.debug('Invalid WebSocket message:', parseErr);
        }
      };

      ws.onerror = (event) => {
        console.warn('WebSocket error event:', event);
      };

      ws.onclose = async () => {
        wsRef.current = null;
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }

        if (!isMountedRef.current) return;

        const savedRunId = currentRunIdRef.current;
        if (!savedRunId) return;

        const attemptReconnect = () => {
          wsReconnectAttemptsRef.current++;
          if (wsReconnectAttemptsRef.current <= MAX_WS_RECONNECT_ATTEMPTS && isMountedRef.current) {
            const delay = Math.min(1000 * Math.pow(2, wsReconnectAttemptsRef.current - 1), 30000);
            setTimeout(() => {
              if (isMountedRef.current && currentRunIdRef.current === savedRunId) {
                startWebSocketRef.current(savedRunId);
              }
            }, delay);
          } else if (isMountedRef.current) {
            setIsLoading(false);
            setCurrentRun(null);
            setError(t('networkError'));
          }
        };

        try {
          const res = await rpc.runs[':id'].$get({ param: { id: savedRunId } });
          const data = await rpcJson<{ run: Run }>(res);
          const status = data.run?.status;

          if (status && TERMINAL_RUN_STATUSES.has(status)) {
            handleRunCompletedRef.current(data.run, data.run?.session_id ?? undefined);
          } else if (status && ACTIVE_RUN_STATUSES.has(status)) {
            attemptReconnect();
          }
        } catch (statusErr) {
          console.error('Failed to check run status after WebSocket close:', statusErr);
          attemptReconnect();
        }
      };
    } catch (wsErr) {
      console.error('WebSocket creation failed:', wsErr);
    }
  };

  // Stable wrappers that delegate to the refs
  const startWebSocket = useCallback((runId: string): void => {
    startWebSocketRef.current(runId);
  }, []);

  const loadPendingSessionDiff = useCallback(async (pending: PendingSessionDiffSummary | null): Promise<void> => {
    if (!pending?.sessionId) {
      setSessionDiff(null);
      return;
    }
    await fetchSessionDiff(pending.sessionId);
  }, [fetchSessionDiff]);

  const syncRunTreeRef = useRef<(() => Promise<void>) | null>(null);

  syncRunTreeRef.current = async () => {
    const rootRunId = rootRunIdRef.current || currentRunIdRef.current;
    if (!rootRunId) return;

    try {
      const params = new URLSearchParams({
        limit: '100',
        offset: '0',
        include_messages: '0',
        root_run_id: rootRunId,
      });
      const historyRes = await fetch(`/api/threads/${encodeURIComponent(threadId)}/history?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      const historyData = await rpcJson<{
        runs: ThreadHistoryRunNode[];
        focus: ThreadHistoryFocus | null;
        pendingSessionDiff: PendingSessionDiffSummary | null;
        activeRun: Run | null;
        taskContext: ThreadHistoryTaskContext | null;
      }>(historyRes);
      const runsById = new Map(historyData.runs.map((node) => [node.run.id, { parent_run_id: node.run.parent_run_id }]));
      const treeRuns = historyData.runs.filter((node) => isRunInRootTree(node.run.id, rootRunId, runsById));
      applyHistorySnapshot({
        runs: treeRuns,
        focus: historyData.focus,
        taskContext: historyData.taskContext,
      });
      void loadPendingSessionDiff(historyData.pendingSessionDiff);

      const rootRun = treeRuns.find((node) => node.run.id === rootRunId)?.run;
      if (
        rootRun &&
        TERMINAL_RUN_STATUSES.has(rootRun.status)
      ) {
        handleRunCompletedRef.current(rootRun, rootRun.session_id ?? undefined);
      }
    } catch (err) {
      console.debug('Failed to sync run tree:', err);
    }
  };

  const handleMerge = useCallback(async (): Promise<void> => {
    // Read sessionDiff via setState callback to get the latest value
    // without adding sessionDiff to the dependency array.
    let currentSessionDiff: SessionDiffState | null = null;
    setSessionDiff((prev) => {
      currentSessionDiff = prev;
      return prev;
    });
    if (!currentSessionDiff) return;

    const { sessionId, diff } = currentSessionDiff as SessionDiffState;
    setIsMerging(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (rpc.sessions[':sessionId'] as any).merge.$post({
        param: { sessionId },
        json: {
          expected_head: diff.workspace_head,
          use_diff3: true,
        },
      });
      await rpcJson(res);
      setSessionDiff(null);
    } catch {
      setError(t('mergeFailed'));
    } finally {
      setIsMerging(false);
    }
  }, [t, setError]);

  const handleCancel = useCallback(async (): Promise<void> => {
    let runToCancel: Run | null = null;
    setCurrentRun((prev) => {
      runToCancel = prev;
      return prev;
    });
    if (!runToCancel) return;

    setIsCancelling(true);
    try {
      const res = await rpc.runs[':id'].cancel.$post({
        param: { id: (runToCancel as Run).id },
      });
      await rpcJson(res);
    } catch {
      setError(t('networkError'));
    } finally {
      setIsCancelling(false);
    }
  }, [t, setError]);

  const dismissSessionDiff = useCallback((): void => {
    setSessionDiff(null);
  }, []);

  const syncThreadAfterSendFailure = useCallback(async (): Promise<void> => {
    try {
      const res = await rpc.threads[':id'].history.$get({
        param: { id: threadId },
        query: { limit: '100', offset: '0' },
      });
      const data = await rpcJson<{
        messages: Message[];
        runs: ThreadHistoryRunNode[];
        focus: ThreadHistoryFocus | null;
        activeRun: Run | null;
        pendingSessionDiff: PendingSessionDiffSummary | null;
        taskContext: ThreadHistoryTaskContext | null;
      }>(res);
      if (!isMountedRef.current) return;

      setMessages(data.messages || []);
      applyHistorySnapshot({
        runs: data.runs || [],
        focus: data.focus,
        taskContext: data.taskContext,
      });
      void loadPendingSessionDiff(data.pendingSessionDiff);
      if (data.activeRun) {
        setCurrentRun(data.activeRun);
        setIsLoading(true);
        startWebSocketRef.current(data.activeRun.id);
      }
    } catch (syncErr) {
      console.debug('Failed to sync thread after send failure:', syncErr);
    }
  }, [threadId, isMountedRef, setMessages]);

  useEffect(() => {
    if (currentRun?.id) {
      upsertRunMeta(currentRun);
    }
  }, [currentRun, upsertRunMeta]);

  // Sync run tree once when a run is first set (no polling).
  // Subsequent updates arrive via WebSocket events; reconnections
  // trigger verifyRunStatus which handles catch-up.
  useEffect(() => {
    if (!currentRun && !rootRunIdRef.current) {
      return;
    }
    void syncRunTreeRef.current?.();
  }, [currentRun, threadId]);

  return {
    currentRun,
    setCurrentRun,
    isLoading,
    setIsLoading,
    streaming,
    resetStreamingState,
    timelineEntries,
    runMetaById,
    artifactsByRunId,
    historyFocus,
    taskContext,
    resetTimeline,
    applyHistorySnapshot,
    sessionDiff,
    setSessionDiff,
    loadPendingSessionDiff,
    isMerging,
    handleMerge,
    isCancelling,
    setIsCancelling,
    handleCancel,
    dismissSessionDiff,
    startWebSocket,
    closeWebSocket,
    currentRunIdRef,
    lastEventIdRef,
    rootRunIdRef,
    syncThreadAfterSendFailure,
  };
}
