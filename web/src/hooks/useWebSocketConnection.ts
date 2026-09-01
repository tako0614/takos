import {
  type Accessor,
  createEffect,
  createSignal,
  type Setter,
} from "solid-js";
import type { TranslationKey } from "../store/i18n.ts";
import { rpc, rpcJson, rpcPath } from "../lib/rpc.ts";
import type {
  Message,
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
import { isRunInRootTree } from "../views/chat/timeline.ts";
import {
  TERMINAL_RUN_STATUSES,
  useWsMessageProcessor,
} from "./useWsMessageProcessor.ts";
import { useConnectionManagerWithFallback } from "./useConnectionManagerWithFallback.ts";
import { parseChatHistoryResponse } from "./chat-history-response.ts";

type MutableRefObject<T> = { current: T };

export interface UseWebSocketConnectionOptions {
  threadId: Accessor<string>;
  spaceRecordId: Accessor<string>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  isMountedRef: MutableRefObject<boolean>;
  fetchMessages: (showError?: boolean) => Promise<void>;
  startMessagePolling: (
    currentRunIdRef: MutableRefObject<string | null>,
  ) => void;
  stopMessagePolling: () => void;
  setMessages: Setter<Message[]>;
  setError: (value: string | null) => void;
}

export interface UseWebSocketConnectionResult {
  currentRun: ThreadHistoryRunSummary | null;
  setCurrentRun: Setter<ThreadHistoryRunSummary | null>;
  isLoading: boolean;
  setIsLoading: Setter<boolean>;
  streaming: ChatStreamingState;
  resetStreamingState: () => void;
  timelineEntries: ChatTimelineEntry[];
  runMetaById: ChatRunMetaMap;
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
  isCancelling: boolean;
  setIsCancelling: Setter<boolean>;
  handleCancel: () => Promise<void>;
  startWebSocket: (runId: string) => void;
  closeWebSocket: () => void;
  currentRunIdRef: MutableRefObject<string | null>;
  lastEventIdRef: MutableRefObject<number>;
  rootRunIdRef: MutableRefObject<string | null>;
  syncThreadAfterSendFailure: () => Promise<ThreadHistoryRunSummary | null>;
}

export function useWebSocketConnection({
  threadId,
  spaceRecordId,
  t,
  isMountedRef,
  fetchMessages,
  startMessagePolling,
  stopMessagePolling,
  setMessages,
  setError,
}: UseWebSocketConnectionOptions): UseWebSocketConnectionResult {
  // Stable refs for cross-hook communication. The status processor receives
  // this ref so a request started for an old Thread cannot settle into the
  // newly selected Run.
  const currentRunIdRef: MutableRefObject<string | null> = { current: null };
  const lastEventIdRef: MutableRefObject<number> = { current: 0 };

  // --- Message processor sub-hook ---
  const processor = useWsMessageProcessor({
    threadId,
    spaceRecordId,
    currentRunIdRef,
    t,
    fetchMessages,
  });
  const [isCancelling, setIsCancelling] = createSignal(false);

  // --- Connection manager sub-hook (WS with SSE fallback) ---
  const connection = useConnectionManagerWithFallback({
    t,
    isMountedRef,
    startMessagePolling,
    stopMessagePolling,
    setError,
    currentRunIdRef,
    lastEventIdRef,
    processor: {
      setCurrentRun: processor.setCurrentRun,
      setIsLoading: processor.setIsLoading,
      setStreaming: processor.setStreaming,
      resetStreamingState: processor.resetStreamingState,
      appendTimelineEntry: processor.appendTimelineEntry,
      verifyRunStatus: processor.verifyRunStatus,
      upsertRunMeta: processor.upsertRunMeta,
      handleRunCompletedRef: processor.handleRunCompletedRef,
      handleWebSocketEventRef: processor.handleWebSocketEventRef,
    },
  });

  // --- Wire up handleRunCompleted (needs connection.closeWebSocket) ---
  processor.handleRunCompletedRef.current = (
    _run?: Partial<Run>,
    _sessionId?: string | null,
  ): Promise<void> => {
    connection.closeWebSocket();
    currentRunIdRef.current = null;
    // Reset for next run (each run uses its own DO instance)
    lastEventIdRef.current = 0;

    processor.setIsLoading(false);
    processor.setCurrentRun(null);

    // Delay clearing streaming state until messages are fetched,
    // so thinking/tool calls remain visible during the transition.
    fetchMessages()
      .then(() => processor.resetStreamingState())
      .catch((err) => {
        console.debug("Final message fetch failed:", err);
        processor.resetStreamingState();
      });
    return Promise.resolve();
  };

  // --- Sync run tree ---
  const syncRunTreeRef: MutableRefObject<(() => Promise<void>) | null> = {
    current: null,
  };

  syncRunTreeRef.current = async () => {
    const rootRunId = connection.rootRunIdRef.current ||
      currentRunIdRef.current;
    if (!rootRunId) return;

    try {
      const currentThreadId = threadId();
      const currentSpaceRecordId = spaceRecordId();
      const historyRes = await rpc.threads[":id"].history.$get({
        param: { id: currentThreadId },
        query: {
          limit: "100",
          offset: "0",
          include_messages: "0",
          root_run_id: rootRunId,
        },
      });
      const historyData = parseChatHistoryResponse(
        await rpcJson<unknown>(historyRes),
        {
          spaceId: currentSpaceRecordId,
          threadId: currentThreadId,
          limit: 100,
          offset: 0,
          includeMessages: false,
          rootRunId,
        },
      );
      if (!isMountedRef.current) return;
      if (threadId() !== currentThreadId) return;
      if (spaceRecordId() !== currentSpaceRecordId) return;
      const runsById = new Map(
        historyData.runs.map((
          node,
        ) => [node.run.id, { parent_run_id: node.run.parent_run_id }]),
      );
      const treeRuns = historyData.runs.filter((node) =>
        isRunInRootTree(node.run.id, rootRunId, runsById)
      );
      processor.mergeHistorySnapshot({
        runs: treeRuns,
        focus: historyData.focus,
        taskContext: historyData.taskContext,
        truncation: historyData.truncation,
      });
      const rootRun = treeRuns.find((node) => node.run.id === rootRunId)?.run;
      if (
        rootRun &&
        TERMINAL_RUN_STATUSES.has(rootRun.status)
      ) {
        processor.handleRunCompletedRef.current(
          rootRun,
          rootRun.session_id ?? undefined,
        );
      }
    } catch (err) {
      console.debug("Failed to sync run tree:", err);
    }
  };

  // --- Wrapped handleCancel (adapts the sub-hook's signature) ---
  const handleCancel = async (): Promise<void> => {
    const runToCancel = processor.currentRun;
    if (!runToCancel) return;

    setIsCancelling(true);
    try {
      const res = await rpcPath(rpc, "runs", ":id", "cancel").$post({
        param: { id: runToCancel.id },
      });
      await rpcJson(res);
    } catch {
      setError(t("networkError"));
    } finally {
      setIsCancelling(false);
    }
  };

  // --- syncThreadAfterSendFailure ---
  const syncThreadAfterSendFailure = async (): Promise<
    ThreadHistoryRunSummary | null
  > => {
    try {
      const currentThreadId = threadId();
      const currentSpaceRecordId = spaceRecordId();
      const res = await rpc.threads[":id"].history.$get({
        param: { id: currentThreadId },
        query: { limit: "100", offset: "0", latest: "1" },
      });
      const data = parseChatHistoryResponse(await rpcJson<unknown>(res), {
        spaceId: currentSpaceRecordId,
        threadId: currentThreadId,
        limit: 100,
        offset: 0,
        includeMessages: true,
        latest: true,
      });
      if (!isMountedRef.current) return null;
      if (threadId() !== currentThreadId) return null;
      if (spaceRecordId() !== currentSpaceRecordId) return null;

      setMessages(data.messages);
      processor.applyHistorySnapshot({
        runs: data.runs || [],
        focus: data.focus,
        taskContext: data.taskContext,
        truncation: data.truncation,
      });
      if (data.activeRun) {
        processor.setCurrentRun(data.activeRun);
        processor.setIsLoading(true);
        connection.startWebSocketRef.current(data.activeRun.id);
      }
      return data.activeRun;
    } catch (syncErr) {
      console.debug("Failed to sync thread after send failure:", syncErr);
      return null;
    }
  };

  // --- Effects ---

  createEffect(() => {
    const run = processor.currentRun;
    if (run?.id) {
      processor.upsertRunMeta(run);
    }
  });

  // Sync run tree once when a run is first set (no polling).
  // Subsequent updates arrive via WebSocket events; reconnections
  // trigger verifyRunStatus which handles catch-up.
  createEffect(() => {
    // Read reactive dependencies
    const _run = processor.currentRun;
    const _threadId = threadId();
    if (!_run && !connection.rootRunIdRef.current) {
      return;
    }
    void syncRunTreeRef.current?.();
  });

  return {
    get currentRun() {
      return processor.currentRun;
    },
    setCurrentRun: processor.setCurrentRun,
    get isLoading() {
      return processor.isLoading;
    },
    setIsLoading: processor.setIsLoading,
    get streaming() {
      return processor.streaming;
    },
    resetStreamingState: processor.resetStreamingState,
    get timelineEntries() {
      return processor.timelineEntries;
    },
    get runMetaById() {
      return processor.runMetaById;
    },
    get artifactsByRunId() {
      return processor.artifactsByRunId;
    },
    get historyFocus() {
      return processor.historyFocus;
    },
    get taskContext() {
      return processor.taskContext;
    },
    get historyTruncation() {
      return processor.historyTruncation;
    },
    resetTimeline: processor.resetTimeline,
    applyHistorySnapshot: processor.applyHistorySnapshot,
    mergeHistorySnapshot: processor.mergeHistorySnapshot,
    get isCancelling() {
      return isCancelling();
    },
    setIsCancelling,
    handleCancel,
    startWebSocket: connection.startWebSocket,
    closeWebSocket: connection.closeWebSocket,
    currentRunIdRef,
    lastEventIdRef,
    rootRunIdRef: connection.rootRunIdRef,
    syncThreadAfterSendFailure,
  };
}
