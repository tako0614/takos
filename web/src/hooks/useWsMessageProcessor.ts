import { type Accessor, createSignal, type Setter } from "solid-js";
import type { TranslationKey } from "../store/i18n.ts";
import { rpc, rpcJson, rpcPath } from "../lib/rpc.ts";
import type {
  Run,
  ThreadHistoryFocus,
  ThreadHistoryRunNode,
  ThreadHistoryRunSummary,
  ThreadHistoryTaskContext,
  ThreadHistoryTruncation,
} from "../types/index.ts";
import type {
  ChatRunArtifactMap,
  ChatRunMetaMap,
  ChatStreamingState,
  ChatTimelineEntry,
} from "../views/chat/chat-types.ts";
import {
  normalizeTimelineEventType,
  parseEventData,
  summarizeEvent,
  type WebSocketEventPayload,
} from "../views/chat/timeline.ts";
import { parseChatRunDetailResponse } from "./chat-run-response.ts";

// Re-export from wsEventHandlers for consumers that import from this module
export {
  ACTIVE_RUN_STATUSES,
  EVENT_DISPATCH,
  type EventHandlerContext,
  getRunStatusFromPayload,
  resolveThinkingText,
  TERMINAL_RUN_STATUSES,
  VALID_RUN_STATUSES,
} from "./wsEventHandlers.ts";

import { ACTIVE_RUN_STATUSES } from "./wsEventHandlers.ts";

export {
  parseEventData,
  type WebSocketEventPayload,
} from "../views/chat/timeline.ts";

type MutableRefObject<T> = { current: T };

export const EMPTY_STREAMING: ChatStreamingState = {
  thinking: null,
  toolCalls: [],
  currentMessage: null,
};

export const EMPTY_HISTORY_TRUNCATION: ThreadHistoryTruncation = {
  message_data: false,
  runs: false,
  artifacts: false,
  events: false,
  event_data: false,
};

export function mergeHistoryTruncation(
  current: ThreadHistoryTruncation,
  incoming: ThreadHistoryTruncation,
): ThreadHistoryTruncation {
  return {
    message_data: current.message_data || incoming.message_data,
    runs: current.runs || incoming.runs,
    artifacts: current.artifacts || incoming.artifacts,
    events: current.events || incoming.events,
    event_data: current.event_data || incoming.event_data,
  };
}

export interface UseWsMessageProcessorOptions {
  threadId: Accessor<string>;
  spaceRecordId: Accessor<string>;
  currentRunIdRef: MutableRefObject<string | null>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  fetchMessages: (showError?: boolean) => Promise<void>;
}

export interface UseWsMessageProcessorResult {
  currentRun: ThreadHistoryRunSummary | null;
  setCurrentRun: Setter<ThreadHistoryRunSummary | null>;
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
  historyTruncation: ThreadHistoryTruncation;
  resetTimeline: () => void;
  applyHistorySnapshot: (snapshot: {
    runs: ThreadHistoryRunNode[];
    focus: ThreadHistoryFocus | null;
    taskContext: ThreadHistoryTaskContext | null;
    truncation: ThreadHistoryTruncation;
  }) => void;
  mergeHistorySnapshot: (snapshot: {
    runs: ThreadHistoryRunNode[];
    focus: ThreadHistoryFocus | null;
    taskContext: ThreadHistoryTaskContext | null;
    truncation: ThreadHistoryTruncation;
  }) => void;
  upsertRunMeta: (run: Partial<Run> & { id: string }) => void;
  appendTimelineEntry: (
    runId: string,
    eventType: string,
    payload: WebSocketEventPayload,
    eventId?: number,
    createdAt?: number,
  ) => void;
  verifyRunStatus: (
    runId: string,
    refreshMessages?: boolean,
  ) => Promise<boolean>;
  handleRunCompletedRef: MutableRefObject<
    (run?: Partial<Run>, sessionId?: string | null) => Promise<void>
  >;
  handleWebSocketEventRef: MutableRefObject<
    (
      eventType: string,
      data: unknown,
      eventId?: number,
      sourceRunId?: string,
    ) => void
  >;
  runEventCursorRef: MutableRefObject<Map<string, number>>;
}

export function useWsMessageProcessor({
  threadId,
  spaceRecordId,
  currentRunIdRef,
  t,
  fetchMessages,
}: UseWsMessageProcessorOptions): UseWsMessageProcessorResult {
  const [currentRun, setCurrentRun] = createSignal<
    ThreadHistoryRunSummary | null
  >(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [streaming, setStreaming] = createSignal<ChatStreamingState>(
    EMPTY_STREAMING,
  );
  const [timelineEntries, setTimelineEntries] = createSignal<
    ChatTimelineEntry[]
  >([]);
  const [runMetaById, setRunMetaById] = createSignal<ChatRunMetaMap>({});
  const [artifactsByRunId, setArtifactsByRunId] = createSignal<
    ChatRunArtifactMap
  >({});
  const [historyFocus, setHistoryFocus] = createSignal<
    ThreadHistoryFocus | null
  >(null);
  const [taskContext, setTaskContext] = createSignal<
    ThreadHistoryTaskContext | null
  >(null);
  const [historyTruncation, setHistoryTruncation] = createSignal(
    EMPTY_HISTORY_TRUNCATION,
  );

  const runEventCursorRef: MutableRefObject<Map<string, number>> = {
    current: new Map(),
  };
  const runMetaRef: MutableRefObject<ChatRunMetaMap> = { current: {} };

  const handleRunCompletedRef: MutableRefObject<
    (run?: Partial<Run>, sessionId?: string | null) => Promise<void>
  > = {
    current: async () => {},
  };
  const handleWebSocketEventRef: MutableRefObject<
    (
      eventType: string,
      data: unknown,
      eventId?: number,
      sourceRunId?: string,
    ) => void
  > = { current: () => {} };

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
    setHistoryTruncation(EMPTY_HISTORY_TRUNCATION);
  };

  const applyHistorySnapshot = (snapshot: {
    runs: ThreadHistoryRunNode[];
    focus: ThreadHistoryFocus | null;
    taskContext: ThreadHistoryTaskContext | null;
    truncation: ThreadHistoryTruncation;
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
        const previous = runEventCursorRef.current.get(node.run.id) ?? 0;
        if (event.id > previous) {
          runEventCursorRef.current.set(node.run.id, event.id);
        }
      }
    }

    nextTimelineEntries.sort((a, b) => (
      a.createdAt === b.createdAt ? a.seq - b.seq : a.createdAt - b.createdAt
    ));

    runMetaRef.current = nextRunMeta;
    setRunMetaById(nextRunMeta);
    setArtifactsByRunId(nextArtifacts);
    setTimelineEntries(nextTimelineEntries);
    setHistoryFocus(snapshot.focus);
    setTaskContext(snapshot.taskContext);
    setHistoryTruncation(snapshot.truncation);
  };

  const mergeHistorySnapshot = (snapshot: {
    runs: ThreadHistoryRunNode[];
    focus: ThreadHistoryFocus | null;
    taskContext: ThreadHistoryTaskContext | null;
    truncation: ThreadHistoryTruncation;
  }): void => {
    const nextRunMeta: ChatRunMetaMap = { ...runMetaRef.current };
    const nextArtifacts: ChatRunArtifactMap = { ...artifactsByRunId() };
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
        const previous = runEventCursorRef.current.get(node.run.id) ?? 0;
        if (event.id > previous) {
          runEventCursorRef.current.set(node.run.id, event.id);
        }
      }
    }

    runMetaRef.current = nextRunMeta;
    setRunMetaById(nextRunMeta);
    setArtifactsByRunId(nextArtifacts);
    setTimelineEntries((prev) => {
      const existingKeys = new Set(prev.map((entry) => entry.key));
      const merged = [...prev];
      for (const entry of nextTimelineEntries) {
        if (!existingKeys.has(entry.key)) {
          existingKeys.add(entry.key);
          merged.push(entry);
        }
      }
      merged.sort((a, b) => (
        a.createdAt === b.createdAt ? a.seq - b.seq : a.createdAt - b.createdAt
      ));
      return merged;
    });
    if (snapshot.focus) {
      setHistoryFocus(snapshot.focus);
    }
    if (snapshot.taskContext) {
      setTaskContext(snapshot.taskContext);
    }
    setHistoryTruncation((current) =>
      mergeHistoryTruncation(current, snapshot.truncation)
    );
  };

  const upsertRunMeta = (run: Partial<Run> & { id: string }) => {
    setRunMetaById((prev) => {
      const next: ChatRunMetaMap = {
        ...prev,
        [run.id]: {
          runId: run.id,
          parentRunId: typeof run.parent_run_id === "string"
            ? run.parent_run_id
            : (prev[run.id]?.parentRunId ?? null),
          agentType: typeof run.agent_type === "string"
            ? run.agent_type
            : (prev[run.id]?.agentType ?? "default"),
          status: run.status ?? prev[run.id]?.status ?? "queued",
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
    const key = typeof eventId === "number"
      ? `${runId}:${eventId}`
      : `${runId}:${normalizedType}:${timestamp}`;

    if (typeof eventId === "number") {
      const previous = runEventCursorRef.current.get(runId) ?? 0;
      if (eventId > previous) {
        runEventCursorRef.current.set(runId, eventId);
      }
      // Bound the cursor map WITHOUT dropping a still-active run's cursor.
      // Map keys are insertion-ordered, so evicting the oldest-inserted entry
      // could drop a long-lived active run while keeping short idle ones; its
      // cursor would then fall back to `?? 0` and replay the run's entire event
      // history on the next event/reconnect. Evict only runs no longer present on
      // the timeline (the current run is always kept).
      if (runEventCursorRef.current.size > 100) {
        const active = new Set(timelineEntries().map((e) => e.runId));
        active.add(runId);
        for (const cursorRunId of runEventCursorRef.current.keys()) {
          if (runEventCursorRef.current.size <= 100) break;
          if (!active.has(cursorRunId)) {
            runEventCursorRef.current.delete(cursorRunId);
          }
        }
      }
    }

    setTimelineEntries((prev) => {
      if (prev.some((entry) => entry.key === key)) {
        return prev;
      }
      const entry = {
        key,
        seq: typeof eventId === "number" ? eventId : timestamp,
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
      if (
        !last || timestamp > last.createdAt ||
        (timestamp === last.createdAt && entry.seq >= last.seq)
      ) {
        return [...prev, entry];
      }
      const next = [...prev, entry];
      next.sort((a, b) => (
        a.createdAt === b.createdAt ? a.seq - b.seq : a.createdAt - b.createdAt
      ));
      return next;
    });
  };

  const verifyRunStatus = async (
    runId: string,
    refreshMessages = true,
  ): Promise<boolean> => {
    const targetThreadId = threadId();
    const targetSpaceId = spaceRecordId();
    const isCurrentTarget = () =>
      currentRunIdRef.current === runId && threadId() === targetThreadId &&
      spaceRecordId() === targetSpaceId;
    if (!isCurrentTarget()) return false;
    try {
      const res = await rpcPath(rpc, "runs", ":id").$get({
        param: { id: runId },
      });
      const run = parseChatRunDetailResponse(await rpcJson<unknown>(res), {
        runId,
        threadId: targetThreadId,
        spaceId: targetSpaceId,
      });
      if (!isCurrentTarget()) return false;
      upsertRunMeta(run);
      const isActive = ACTIVE_RUN_STATUSES.has(run.status);

      if (!isActive) {
        setIsLoading(false);
        setCurrentRun(null);
        resetStreamingState();
        // Note: closeWebSocket is called by the caller (connection manager)
        // after verifyRunStatus returns false
        fetchMessages();
      } else if (refreshMessages) {
        fetchMessages();
      }
      return isActive;
    } catch {
      // A transient or malformed status response is not evidence that the Run
      // ended. Preserve the last verified active state and let the transport
      // or next watchdog tick retry instead of closing a healthy connection.
      return isCurrentTarget();
    }
  };

  return {
    get currentRun() {
      return currentRun();
    },
    setCurrentRun,
    get isLoading() {
      return isLoading();
    },
    setIsLoading,
    get streaming() {
      return streaming();
    },
    setStreaming,
    resetStreamingState,
    get timelineEntries() {
      return timelineEntries();
    },
    get runMetaById() {
      return runMetaById();
    },
    runMetaRef,
    get artifactsByRunId() {
      return artifactsByRunId();
    },
    get historyFocus() {
      return historyFocus();
    },
    get taskContext() {
      return taskContext();
    },
    get historyTruncation() {
      return historyTruncation();
    },
    resetTimeline,
    applyHistorySnapshot,
    mergeHistorySnapshot,
    upsertRunMeta,
    appendTimelineEntry,
    verifyRunStatus,
    handleRunCompletedRef,
    handleWebSocketEventRef,
    runEventCursorRef,
  };
}
