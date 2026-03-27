import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { useI18n, type TranslationKey } from '../providers/I18nProvider';
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
import { useMessagePolling } from './useMessagePolling';
import { useWebSocketConnection, type SessionDiffState } from './useWebSocketConnection';
import { useFileAttachment } from './useFileAttachment';
import { useChatModelSelection } from './useChatModelSelection';
import { useChatAttachments } from './useChatAttachments';
import { useChatMessages } from './useChatMessages';

export type { SessionDiffState } from './useWebSocketConnection';

export interface UseChatSessionOptions {
  threadId: string;
  spaceId: string;
  onUpdateTitle: (title: string) => void;
  initialMessage?: string;
  initialModel?: string;
  focusSequence?: number | null;
}

export interface UseChatSessionResult {
  availableModels: import('../lib/modelCatalog').ModelSelectOption[];
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  messages: Message[];
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  streaming: ChatStreamingState;
  timelineEntries: ChatTimelineEntry[];
  runMetaById: ChatRunMetaMap;
  artifactsByRunId: ChatRunArtifactMap;
  historyFocus: ThreadHistoryFocus | null;
  taskContext: ThreadHistoryTaskContext | null;
  sessionDiff: SessionDiffState | null;
  dismissSessionDiff: () => void;
  isMerging: boolean;
  handleMerge: () => Promise<void>;
  isCancelling: boolean;
  handleCancel: () => Promise<void>;
  error: string | null;
  setError: (value: string | null) => void;
  attachedFiles: File[];
  addFiles: (files: File[]) => void;
  handleFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  removeAttachedFile: (index: number) => void;
  sendMessage: () => Promise<void>;
  messagesEndRef: RefObject<HTMLDivElement>;
}

export function useChatSession({
  threadId,
  spaceId,
  onUpdateTitle,
  initialMessage,
  initialModel,
  focusSequence,
}: UseChatSessionOptions): UseChatSessionResult {
  const { t, lang } = useI18n();
  const [input, setInput] = useState(initialMessage ?? '');

  // Scroll tracking refs (owned by orchestrator because the auto-scroll
  // effect depends on state from both the polling and WebSocket hooks)
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastAutoScrollMessageCountRef = useRef<number>(0);
  const initialScrollPendingRef = useRef<boolean>(true);
  const autoScrollPinnedRef = useRef<boolean>(true);

  // --- Sub-hooks ---
  const polling = useMessagePolling({ threadId, t });

  const ws = useWebSocketConnection({
    threadId,
    t,
    isMountedRef: polling.isMountedRef,
    fetchMessages: polling.fetchMessages,
    startMessagePolling: polling.startMessagePolling,
    stopMessagePolling: polling.stopMessagePolling,
    setMessages: polling.setMessages,
    setError: polling.setError,
  });

  const files = useFileAttachment({ t, setError: polling.setError });

  const modelSelection = useChatModelSelection({
    spaceId,
    initialModel,
  });

  const attachments = useChatAttachments({
    spaceId,
    threadId,
  });

  const messaging = useChatMessages({
    threadId,
    lang,
    t,
    input,
    setInput,
    selectedModel: modelSelection.selectedModel,
    onUpdateTitle,
    attachedFiles: files.attachedFiles,
    setAttachedFiles: files.setAttachedFiles,
    isLoading: ws.isLoading,
    rootRunIdRef: ws.rootRunIdRef,
    closeWebSocket: ws.closeWebSocket,
    currentRunIdRef: ws.currentRunIdRef,
    lastEventIdRef: ws.lastEventIdRef,
    resetStreamingState: ws.resetStreamingState,
    resetTimeline: ws.resetTimeline,
    setIsLoading: ws.setIsLoading,
    setCurrentRun: ws.setCurrentRun,
    startWebSocket: ws.startWebSocket,
    syncThreadAfterSendFailure: ws.syncThreadAfterSendFailure,
    messagesCountRef: polling.messagesCountRef,
    abortPendingFetch: polling.abortPendingFetch,
    setMessages: polling.setMessages,
    setError: polling.setError,
    uploadChatAttachments: attachments.uploadChatAttachments,
  });

  // --- Initialization effect ---
  useEffect(() => {
    polling.isMountedRef.current = true;

    ws.rootRunIdRef.current = null;
    ws.closeWebSocket();
    ws.currentRunIdRef.current = null;
    ws.lastEventIdRef.current = 0;
    ws.setSessionDiff(null);
    polling.setMessages([]);
    ws.setIsLoading(false);
    ws.setCurrentRun(null);
    ws.setIsCancelling(false);
    ws.resetStreamingState();
    ws.resetTimeline();
    polling.setError(null);
    setInput(initialMessage ?? '');
    files.setAttachedFiles([]);
    initialScrollPendingRef.current = true;
    autoScrollPinnedRef.current = true;
    lastAutoScrollMessageCountRef.current = 0;

    const init = async () => {
      try {
        const limit = focusSequence != null ? 200 : 100;
        const offset = focusSequence != null
          ? Math.max(0, focusSequence - Math.floor(limit / 2))
          : 0;
        const res = await rpc.threads[':id'].history.$get({
          param: { id: threadId },
          query: { limit: String(limit), offset: String(offset) },
        });
        const data = await rpcJson<{
          messages: Message[];
          runs: ThreadHistoryRunNode[];
          focus: ThreadHistoryFocus | null;
          activeRun: Run | null;
          pendingSessionDiff: {
            sessionId: string;
            sessionStatus: string;
            git_mode: boolean;
          } | null;
          taskContext: ThreadHistoryTaskContext | null;
        }>(res);

        if (!polling.isMountedRef.current) return;

        polling.setMessages(data.messages);
        ws.applyHistorySnapshot({
          runs: data.runs || [],
          focus: data.focus,
          taskContext: data.taskContext,
        });

        if (data.activeRun) {
          ws.setIsLoading(true);
          ws.setCurrentRun(data.activeRun);
          ws.startWebSocket(data.activeRun.id);
        }

        void ws.loadPendingSessionDiff(data.pendingSessionDiff);
      } catch (err) {
        console.error('Failed to initialize chat session:', err);
        polling.setError(t('failedToLoad' as TranslationKey) || 'Failed to load messages');
      }
    };
    init();

    return () => {
      polling.isMountedRef.current = false;
      polling.abortPendingFetch();
      ws.closeWebSocket();
      ws.currentRunIdRef.current = null;
      ws.lastEventIdRef.current = 0;
      ws.rootRunIdRef.current = null;
    };
  }, [threadId, focusSequence, ws.resetStreamingState, ws.resetTimeline]);

  // --- Scroll pinning: track whether user is near the bottom ---
  useEffect(() => {
    const anchor = messagesEndRef.current;
    const scrollContainer = anchor?.parentElement?.parentElement;
    if (!(scrollContainer instanceof HTMLElement)) {
      return;
    }

    function updatePinnedState(): void {
      const distanceFromBottom =
        (scrollContainer as HTMLElement).scrollHeight -
        (scrollContainer as HTMLElement).scrollTop -
        (scrollContainer as HTMLElement).clientHeight;
      autoScrollPinnedRef.current = distanceFromBottom <= 96;
    }

    autoScrollPinnedRef.current = true;
    scrollContainer.addEventListener('scroll', updatePinnedState, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', updatePinnedState);
    };
  }, [threadId]);

  // --- Auto-scroll when messages change or streaming updates ---
  useEffect(() => {
    const nextCount = polling.messages.length;
    if (initialScrollPendingRef.current) {
      if (nextCount === 0) {
        return;
      }
      initialScrollPendingRef.current = false;
      lastAutoScrollMessageCountRef.current = nextCount;
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      return;
    }
    if (!autoScrollPinnedRef.current) {
      lastAutoScrollMessageCountRef.current = nextCount;
      return;
    }
    const behavior: ScrollBehavior =
      nextCount > lastAutoScrollMessageCountRef.current ? 'smooth' : 'auto';
    lastAutoScrollMessageCountRef.current = nextCount;
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, [polling.messages.length, ws.streaming.currentMessage, ws.streaming.thinking, ws.streaming.toolCalls.length]);

  return {
    availableModels: modelSelection.availableModels,
    selectedModel: modelSelection.selectedModel,
    setSelectedModel: modelSelection.setSelectedModel,
    messages: polling.messages,
    input,
    setInput,
    isLoading: ws.isLoading,
    streaming: ws.streaming,
    timelineEntries: ws.timelineEntries,
    runMetaById: ws.runMetaById,
    artifactsByRunId: ws.artifactsByRunId,
    historyFocus: ws.historyFocus,
    taskContext: ws.taskContext,
    sessionDiff: ws.sessionDiff,
    dismissSessionDiff: ws.dismissSessionDiff,
    isMerging: ws.isMerging,
    handleMerge: ws.handleMerge,
    isCancelling: ws.isCancelling,
    handleCancel: ws.handleCancel,
    error: polling.error,
    setError: polling.setError,
    attachedFiles: files.attachedFiles,
    addFiles: files.addFiles,
    handleFileSelect: files.handleFileSelect,
    removeAttachedFile: files.removeAttachedFile,
    sendMessage: messaging.sendMessage,
    messagesEndRef,
  };
}
