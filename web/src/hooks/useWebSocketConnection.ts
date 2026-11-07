import { type Accessor, createEffect, createSignal, type Setter, untrack } from "solid-js";
import type { TranslationKey } from "../store/i18n.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { createLatestRequest } from "../lib/createLatestRequest.ts";
import type { UseMessagePollingResult } from "./useMessagePolling.ts";
import type {
  Message,
  Run,
  ThreadHistoryFocus,
  ThreadHistoryRunNode,
  ThreadHistoryTaskContext,
} from "../types/index.ts";
import type {
  ChatRunArtifactMap,
  ChatRunMetaMap,
  ChatStreamingState,
  ChatTimelineEntry,
} from "../views/chat/chat-types.ts";
import { isRunInRootTree } from "../views/chat/timeline.ts";
import {
  type PendingSessionDiffSummary,
  type SessionDiffState,
  useWsSessionDiff,
} from "./useWsSessionDiff.ts";
import {
  TERMINAL_RUN_STATUSES,
  useWsMessageProcessor,
} from "./useWsMessageProcessor.ts";
import { useConnectionManagerWithFallback } from "./useConnectionManagerWithFallback.ts";

export type { SessionDiffState } from "./useWsSessionDiff.ts";

type MutableRefObject<T> = { current: T };

export interface UseWebSocketConnectionOptions {
  requestScope: Accessor<unknown>;
  threadId: Accessor<string>;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  isMountedRef: MutableRefObject<boolean>;
  fetchMessages: UseMessagePollingResult["fetchMessages"];
  startMessagePolling: (
    currentRunIdRef: MutableRefObject<string | null>,
  ) => void;
  stopMessagePolling: () => void;
  setMessages: Setter<Message[]>;
  setError: (value: string | null) => void;
}

export interface UseWebSocketConnectionResult {
  currentRun: Run | null;
  setCurrentRun: Setter<Run | null>;
  isLoading: boolean;
  setIsLoading: Setter<boolean>;
  streaming: ChatStreamingState;
  resetStreamingState: () => void;
  retryFinalMessages: (() => Promise<void>) | null;
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
  mergeHistorySnapshot: (snapshot: {
    runs: ThreadHistoryRunNode[];
    focus: ThreadHistoryFocus | null;
    taskContext: ThreadHistoryTaskContext | null;
  }) => void;
  sessionDiff: SessionDiffState | null;
  setSessionDiff: Setter<SessionDiffState | null>;
  loadPendingSessionDiff: (
    pending: PendingSessionDiffSummary | null,
  ) => Promise<void>;
  isMerging: boolean;
  handleMerge: () => Promise<void>;
  isCancelling: boolean;
  setIsCancelling: Setter<boolean>;
  handleCancel: (isCurrent?: () => boolean) => Promise<void>;
  dismissSessionDiff: () => void;
  startWebSocket: (runId: string) => void;
  closeWebSocket: () => void;
  currentRunIdRef: MutableRefObject<string | null>;
  lastEventIdRef: MutableRefObject<number>;
  rootRunIdRef: MutableRefObject<string | null>;
  syncThreadAfterSendFailure: (isCurrent?: () => boolean) => Promise<{ activeRun: Run | null } | undefined>;
}

export function useWebSocketConnection({
  requestScope,
  threadId,
  t,
  isMountedRef,
  fetchMessages,
  startMessagePolling,
  stopMessagePolling,
  setMessages,
  setError,
}: UseWebSocketConnectionOptions): UseWebSocketConnectionResult {
  const currentRunIdRef: MutableRefObject<string | null> = { current: null };
  const lastEventIdRef: MutableRefObject<number> = { current: 0 };

  // --- Session diff sub-hook ---
  const sessionDiffHook = useWsSessionDiff({ threadId, t, setError });

  // --- Message processor sub-hook ---
  const processor = useWsMessageProcessor({
    requestScope,
    currentRunIdRef,
    t,
    isMountedRef,
    fetchMessages,
    setError,
    fetchSessionDiff: sessionDiffHook.fetchSessionDiff,
  });

  // --- Connection manager sub-hook (WS with SSE fallback) ---
  const connection = useConnectionManagerWithFallback({
    requestScope,
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
  const finalMessageReads = createLatestRequest();
  const [finalMessageRetry, setFinalMessageRetry] = createSignal<{
    isCurrent: () => boolean;
    run: () => Promise<void>;
  } | null>(null);
  processor.handleRunCompletedRef.current = (
    run?: Partial<Run>,
    sessionId?: string | null,
  ): Promise<void> => {
    const currentThreadId = threadId();
    const scope = untrack(requestScope);
    const rootRunId = connection.rootRunIdRef.current;
    const claim = finalMessageReads.claim(() => isMountedRef.current &&
      requestScope() === scope && threadId() === currentThreadId &&
      connection.rootRunIdRef.current === rootRunId &&
      currentRunIdRef.current === null);
    const effectiveSessionId = sessionId ?? run?.session_id ?? undefined;
    setFinalMessageRetry(null);
    if (effectiveSessionId) {
      sessionDiffHook.fetchSessionDiff(effectiveSessionId);
    }

    connection.closeWebSocket();
    currentRunIdRef.current = null;
    // Reset for next run (each run uses its own DO instance)
    lastEventIdRef.current = 0;

    processor.setIsLoading(false);
    processor.setCurrentRun(null);

    // Delay clearing streaming state until messages are fetched,
    // so thinking/tool calls remain visible during the transition.
    const refreshFinalMessages = (isCurrent?: () => boolean): Promise<void> => {
      if (!claim.won()) return Promise.resolve();
      setFinalMessageRetry(null);
      return fetchMessages(true, { isCurrent, isEffectCurrent: claim.won }).then((outcome) => {
        if (!claim.won()) return;
        if (outcome === "adopted") processor.resetStreamingState();
        else if (outcome === "failed") {
          setFinalMessageRetry({ isCurrent: claim.won, run: () => refreshFinalMessages(claim.won) });
        }
      }).catch((err) => {
        console.debug("Final message fetch failed:", err);
      });
    };
    // Preserve same-thread message adoption for the initial completion read.
    // A manual retry additionally retires its body when the next reply starts.
    void refreshFinalMessages();
    return Promise.resolve();
  };

  // --- Sync run tree ---
  const syncRunTreeRef: MutableRefObject<(() => Promise<void>) | null> = {
    current: null,
  };
  const runTreeReads = createLatestRequest();

  syncRunTreeRef.current = async () => {
    const rootRunId = connection.rootRunIdRef.current ||
      currentRunIdRef.current;
    if (!rootRunId) return;

    const currentThreadId = threadId();
    // Capture the view generation without adding a new effect dependency.
    const scope = untrack(requestScope);
    const claim = runTreeReads.claim(() => isMountedRef.current &&
      requestScope() === scope && threadId() === currentThreadId &&
      (connection.rootRunIdRef.current || currentRunIdRef.current) === rootRunId);

    try {
      const historyRes = await rpc.threads[":id"].history.$get({
        param: { id: currentThreadId },
        query: {
          limit: "100",
          offset: "0",
          include_messages: "0",
          root_run_id: rootRunId,
        },
      });
      const historyData = await rpcJson<{
        runs: ThreadHistoryRunNode[];
        focus: ThreadHistoryFocus | null;
        pendingSessionDiff: PendingSessionDiffSummary | null;
        activeRun: Run | null;
        taskContext: ThreadHistoryTaskContext | null;
      }>(historyRes, { isCurrent: claim.won });
      if (!claim.won()) return;
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
      });
      void sessionDiffHook.loadPendingSessionDiff(
        historyData.pendingSessionDiff,
      );

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
  const handleCancel = async (isCurrent?: () => boolean): Promise<void> => {
    await sessionDiffHook.handleCancel(() => {
      return processor.currentRun;
    }, isCurrent);
  };

  // --- syncThreadAfterSendFailure ---
  const syncThreadAfterSendFailure = async (isCurrent?: () => boolean): Promise<{ activeRun: Run | null } | undefined> => {
    try {
      const currentThreadId = threadId();
      const stillCurrent = () => isMountedRef.current && threadId() === currentThreadId && isCurrent?.() !== false;
      const res = await rpc.threads[":id"].history.$get({
        param: { id: currentThreadId },
        query: { limit: "100", offset: "0" },
      });
      const data = await rpcJson<{
        messages: Message[];
        runs: ThreadHistoryRunNode[];
        focus: ThreadHistoryFocus | null;
        activeRun: Run | null;
        pendingSessionDiff: PendingSessionDiffSummary | null;
        taskContext: ThreadHistoryTaskContext | null;
      }>(res, { isCurrent: stillCurrent });
      if (!stillCurrent()) return;
      if (!data || !Array.isArray(data.messages) || !Array.isArray(data.runs) ||
        !data.messages.every((message) => message && typeof message.id === "string" &&
          message.thread_id === currentThreadId && typeof message.content === "string") ||
        !(data.activeRun === null || (data.activeRun && typeof data.activeRun.id === "string" && data.activeRun.id &&
          (data.activeRun.thread_id === currentThreadId || data.activeRun.root_thread_id === currentThreadId) &&
          ["pending", "queued", "running"].includes(data.activeRun.status)))) {
        throw new Error("Invalid send recovery history response");
      }

      setMessages(data.messages || []);
      processor.applyHistorySnapshot({
        runs: data.runs || [],
        focus: data.focus,
        taskContext: data.taskContext,
      });
      void sessionDiffHook.loadPendingSessionDiff(data.pendingSessionDiff);
      if (data.activeRun) {
        processor.setCurrentRun(data.activeRun);
        processor.setIsLoading(true);
        connection.startWebSocketRef.current(data.activeRun.id);
      }
      return { activeRun: data.activeRun ?? null };
    } catch (syncErr) {
      console.debug("Failed to sync thread after send failure:", syncErr);
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
    resetTimeline: processor.resetTimeline,
    applyHistorySnapshot: processor.applyHistorySnapshot,
    mergeHistorySnapshot: processor.mergeHistorySnapshot,
    get sessionDiff() {
      return sessionDiffHook.sessionDiff;
    },
    setSessionDiff: sessionDiffHook.setSessionDiff,
    loadPendingSessionDiff: sessionDiffHook.loadPendingSessionDiff,
    get isMerging() {
      return sessionDiffHook.isMerging;
    },
    handleMerge: sessionDiffHook.handleMerge,
    get isCancelling() {
      return sessionDiffHook.isCancelling;
    },
    setIsCancelling: sessionDiffHook.setIsCancelling,
    handleCancel,
    dismissSessionDiff: sessionDiffHook.dismissSessionDiff,
    get retryFinalMessages() {
      const retry = finalMessageRetry();
      return !processor.isLoading && retry?.isCurrent() ? retry.run : null;
    },
    startWebSocket: connection.startWebSocket,
    closeWebSocket: connection.closeWebSocket,
    currentRunIdRef,
    lastEventIdRef,
    rootRunIdRef: connection.rootRunIdRef,
    syncThreadAfterSendFailure,
  };
}
