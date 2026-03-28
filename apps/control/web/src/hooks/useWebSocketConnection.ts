import { useCallback, useEffect, useRef } from 'react';
import type { TranslationKey } from '../store/i18n';
import { rpc, rpcJson } from '../lib/rpc';
import type {
  Message,
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
import { isRunInRootTree } from '../views/chat/timeline';
import { useWsSessionDiff, type SessionDiffState, type PendingSessionDiffSummary } from './useWsSessionDiff';
import { useWsMessageProcessor, ACTIVE_RUN_STATUSES, TERMINAL_RUN_STATUSES } from './useWsMessageProcessor';
import { useConnectionManagerWithFallback } from './useConnectionManagerWithFallback';

export type { SessionDiffState } from './useWsSessionDiff';

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
  // --- Session diff sub-hook ---
  const sessionDiffHook = useWsSessionDiff({ t, setError });

  // --- Message processor sub-hook ---
  const processor = useWsMessageProcessor({
    t,
    isMountedRef,
    fetchMessages,
    setError,
    fetchSessionDiff: sessionDiffHook.fetchSessionDiff,
  });

  // Stable refs for cross-hook communication
  const currentRunIdRef = useRef<string | null>(null);
  const lastEventIdRef = useRef<number>(0);

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
  processor.handleRunCompletedRef.current = async (run?: Partial<Run>, sessionId?: string | null) => {
    const effectiveSessionId = sessionId ?? run?.session_id ?? undefined;
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
    fetchMessages()
      .then(() => processor.resetStreamingState())
      .catch((err) => {
        console.debug('Final message fetch failed:', err);
        processor.resetStreamingState();
      });
  };

  // --- Sync run tree ---
  const syncRunTreeRef = useRef<(() => Promise<void>) | null>(null);

  syncRunTreeRef.current = async () => {
    const rootRunId = connection.rootRunIdRef.current || currentRunIdRef.current;
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
      processor.applyHistorySnapshot({
        runs: treeRuns,
        focus: historyData.focus,
        taskContext: historyData.taskContext,
      });
      void sessionDiffHook.loadPendingSessionDiff(historyData.pendingSessionDiff);

      const rootRun = treeRuns.find((node) => node.run.id === rootRunId)?.run;
      if (
        rootRun &&
        TERMINAL_RUN_STATUSES.has(rootRun.status)
      ) {
        processor.handleRunCompletedRef.current(rootRun, rootRun.session_id ?? undefined);
      }
    } catch (err) {
      console.debug('Failed to sync run tree:', err);
    }
  };

  // --- Wrapped handleCancel (adapts the sub-hook's signature) ---
  const handleCancel = useCallback(async (): Promise<void> => {
    await sessionDiffHook.handleCancel(() => {
      let run: Run | null = null;
      processor.setCurrentRun((prev) => {
        run = prev;
        return prev;
      });
      return run;
    });
  }, [sessionDiffHook, processor.setCurrentRun]);

  // --- syncThreadAfterSendFailure ---
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
    } catch (syncErr) {
      console.debug('Failed to sync thread after send failure:', syncErr);
    }
  }, [threadId, isMountedRef, setMessages]);

  // --- Effects ---

  useEffect(() => {
    if (processor.currentRun?.id) {
      processor.upsertRunMeta(processor.currentRun);
    }
  }, [processor.currentRun, processor.upsertRunMeta]);

  // Sync run tree once when a run is first set (no polling).
  // Subsequent updates arrive via WebSocket events; reconnections
  // trigger verifyRunStatus which handles catch-up.
  useEffect(() => {
    if (!processor.currentRun && !connection.rootRunIdRef.current) {
      return;
    }
    void syncRunTreeRef.current?.();
  }, [processor.currentRun, threadId]);

  return {
    currentRun: processor.currentRun,
    setCurrentRun: processor.setCurrentRun,
    isLoading: processor.isLoading,
    setIsLoading: processor.setIsLoading,
    streaming: processor.streaming,
    resetStreamingState: processor.resetStreamingState,
    timelineEntries: processor.timelineEntries,
    runMetaById: processor.runMetaById,
    artifactsByRunId: processor.artifactsByRunId,
    historyFocus: processor.historyFocus,
    taskContext: processor.taskContext,
    resetTimeline: processor.resetTimeline,
    applyHistorySnapshot: processor.applyHistorySnapshot,
    sessionDiff: sessionDiffHook.sessionDiff,
    setSessionDiff: sessionDiffHook.setSessionDiff,
    loadPendingSessionDiff: sessionDiffHook.loadPendingSessionDiff,
    isMerging: sessionDiffHook.isMerging,
    handleMerge: sessionDiffHook.handleMerge,
    isCancelling: sessionDiffHook.isCancelling,
    setIsCancelling: sessionDiffHook.setIsCancelling,
    handleCancel,
    dismissSessionDiff: sessionDiffHook.dismissSessionDiff,
    startWebSocket: connection.startWebSocket,
    closeWebSocket: connection.closeWebSocket,
    currentRunIdRef,
    lastEventIdRef,
    rootRunIdRef: connection.rootRunIdRef,
    syncThreadAfterSendFailure,
  };
}
