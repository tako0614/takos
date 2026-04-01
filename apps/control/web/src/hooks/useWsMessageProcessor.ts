import { createSignal, type Setter } from 'solid-js';
import type { TranslationKey } from '../store/i18n.ts';
import { rpc, rpcJson, rpcPath } from '../lib/rpc.ts';
import type {
  Run,
  ThreadHistoryFocus,
  ThreadHistoryRunNode,
  ThreadHistoryTaskContext,
} from '../types/index.ts';
import type {
  ChatRunArtifactMap,
  ChatRunMetaMap,
  ChatStreamingState,
  ChatTimelineEntry,
} from '../views/chat/chat-types.ts';
import {
  normalizeTimelineEventType,
  parseEventData,
  summarizeEvent,
  type WebSocketEventPayload,
} from '../views/chat/timeline.ts';

// Re-export from wsEventHandlers for consumers that import from this module
export {
  VALID_RUN_STATUSES,
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  EVENT_DISPATCH,
  getRunStatusFromPayload,
  resolveThinkingText,
  type EventHandlerContext,
} from './wsEventHandlers.ts';

import { ACTIVE_RUN_STATUSES } from './wsEventHandlers.ts';

export { parseEventData, type WebSocketEventPayload } from '../views/chat/timeline.ts';

type MutableRefObject<T> = { current: T };

export const EMPTY_STREAMING: ChatStreamingState = {
  thinking: null,
  toolCalls: [],
  currentMessage: null,
};

export interface UseWsMessageProcessorOptions {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  isMountedRef: MutableRefObject<boolean>;
  fetchMessages: (showError?: boolean) => Promise<void>;
  setError: (value: string | null) => void;
  fetchSessionDiff: (sessionId: string) => Promise<void>;
}

export interface UseWsMessageProcessorResult {
  currentRun: Run | null;
  setCurrentRun: Setter<Run | null>;
  isLoading: boolean;
  setIsLoading: Setter<boolean>;
  streaming: ChatStreamingState;
  setStreaming: Setter<ChatStreamingState>;
  resetStreamingState: () => void;
  timelineEntries: ChatTimelineEntry[];
  runMetaById: ChatRunMetaMap;
  runMetaRef: MutableRefObject<ChatRunMetaMap>;
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
  handleRunCompletedRef: MutableRefObject<(run?: Partial<Run>, sessionId?: string | null) => Promise<void>>;
  handleWebSocketEventRef: MutableRefObject<(
    eventType: string,
    data: unknown,
    eventId?: number,
    sourceRunId?: string,
  ) => void>;
  runEventCursorRef: MutableRefObject<Map<string, number>>;
}

export function useWsMessageProcessor({
  t,
  isMountedRef: _isMountedRef,
  fetchMessages,
  setError: _setError,
  fetchSessionDiff,
}: UseWsMessageProcessorOptions): UseWsMessageProcessorResult {
  const [currentRun, setCurrentRun] = createSignal<Run | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [streaming, setStreaming] = createSignal<ChatStreamingState>(EMPTY_STREAMING);
  const [timelineEntries, setTimelineEntries] = createSignal<ChatTimelineEntry[]>([]);
  const [runMetaById, setRunMetaById] = createSignal<ChatRunMetaMap>({});
  const [artifactsByRunId, setArtifactsByRunId] = createSignal<ChatRunArtifactMap>({});
  const [historyFocus, setHistoryFocus] = createSignal<ThreadHistoryFocus | null>(null);
  const [taskContext, setTaskContext] = createSignal<ThreadHistoryTaskContext | null>(null);

  const runEventCursorRef: MutableRefObject<Map<string, number>> = { current: new Map() };
  const runMetaRef: MutableRefObject<ChatRunMetaMap> = { current: {} };

  const handleRunCompletedRef: MutableRefObject<(run?: Partial<Run>, sessionId?: string | null) => Promise<void>> = {
    current: async () => {},
  };
  const handleWebSocketEventRef: MutableRefObject<(
    eventType: string,
    data: unknown,
    eventId?: number,
    sourceRunId?: string,
  ) => void> = { current: () => {} };

  const resetStreamingState = (): void => {
    setStreaming(EMPTY_STREAMING);
  };

  const resetTimeline = (): void => {
    runEventCursorRef.current = new Map();
    runMetaRef.current = {};
    setTimelineEntries([]);
    setRunMetaById({});
    setArtifactsByRunId({});
    setHistoryFocus(null);
    setTaskContext(null);
  };

  const applyHistorySnapshot = (snapshot: {
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
  };

  const upsertRunMeta = (run: Partial<Run> & { id: string }) => {
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
  };

  const appendTimelineEntry = (
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
  };

  const verifyRunStatus = async (runId: string, refreshMessages = true): Promise<boolean> => {
    try {
      const res = await rpcPath(rpc, 'runs', ':id').$get({
        param: { id: runId },
      }) as Response;
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
    } catch {
      return false;
    }
  };

  return {
    get currentRun() { return currentRun(); },
    setCurrentRun,
    get isLoading() { return isLoading(); },
    setIsLoading,
    get streaming() { return streaming(); },
    setStreaming,
    resetStreamingState,
    get timelineEntries() { return timelineEntries(); },
    get runMetaById() { return runMetaById(); },
    runMetaRef,
    get artifactsByRunId() { return artifactsByRunId(); },
    get historyFocus() { return historyFocus(); },
    get taskContext() { return taskContext(); },
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
