import { createSignal, createEffect, onCleanup } from 'solid-js';
import { useI18n, type TranslationKey } from '../store/i18n.ts';
import { rpc, rpcJson } from '../lib/rpc.ts';
import type {
  Message,
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
import { useMessagePolling } from './useMessagePolling.ts';
import { useWebSocketConnection, type SessionDiffState } from './useWebSocketConnection.ts';
import { useFileAttachment } from './useFileAttachment.ts';
import { useChatModelSelection } from './useChatModelSelection.ts';
import { useChatAttachments } from './useChatAttachments.ts';
import { useChatMessages } from './useChatMessages.ts';

export type { SessionDiffState } from './useWebSocketConnection.ts';

export interface UseChatSessionOptions {
  threadId: string;
  spaceId: string;
  onUpdateTitle: (title: string) => void;
  initialMessage?: string;
  initialModel?: string;
  focusSequence?: number | null;
}

export interface UseChatSessionResult {
  availableModels: import('../lib/modelCatalog.ts').ModelSelectOption[];
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
  handleFileSelect: (e: Event & { currentTarget: HTMLInputElement }) => void;
  removeAttachedFile: (index: number) => void;
  sendMessage: () => Promise<void>;
  messagesEndRef: HTMLDivElement | undefined;
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
  const [input, setInput] = createSignal(initialMessage ?? '');

  // Scroll tracking refs (owned by orchestrator because the auto-scroll
  // effect depends on state from both the polling and WebSocket hooks)
  let messagesEndRef: HTMLDivElement | undefined;
  let lastAutoScrollMessageCount = 0;
  let initialScrollPending = true;
  let autoScrollPinned = true;

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
    input: input(),
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
  createEffect(() => {
    // Track threadId and focusSequence for reactivity
    void threadId;
    void focusSequence;

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
    initialScrollPending = true;
    autoScrollPinned = true;
    lastAutoScrollMessageCount = 0;

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
      } catch {
        polling.setError(t('failedToLoad' as TranslationKey) || 'Failed to load messages');
      }
    };
    init();

    onCleanup(() => {
      polling.isMountedRef.current = false;
      polling.abortPendingFetch();
      ws.closeWebSocket();
      ws.currentRunIdRef.current = null;
      ws.lastEventIdRef.current = 0;
      ws.rootRunIdRef.current = null;
    });
  });

  // --- Scroll pinning: track whether user is near the bottom ---
  createEffect(() => {
    // Track threadId for reactivity
    void threadId;

    const anchor = messagesEndRef;
    const scrollContainer = anchor?.parentElement?.parentElement;
    if (!(scrollContainer instanceof HTMLElement)) {
      return;
    }

    function updatePinnedState(): void {
      const distanceFromBottom =
        (scrollContainer as HTMLElement).scrollHeight -
        (scrollContainer as HTMLElement).scrollTop -
        (scrollContainer as HTMLElement).clientHeight;
      autoScrollPinned = distanceFromBottom <= 96;
    }

    autoScrollPinned = true;
    scrollContainer.addEventListener('scroll', updatePinnedState, { passive: true });
    onCleanup(() => {
      scrollContainer.removeEventListener('scroll', updatePinnedState);
    });
  });

  // --- Auto-scroll when messages change or streaming updates ---
  createEffect(() => {
    const msgList = polling.messages;
    const nextCount = msgList.length;
    // Track streaming state for reactivity
    void ws.streaming.currentMessage;
    void ws.streaming.thinking;
    void ws.streaming.toolCalls.length;

    if (initialScrollPending) {
      if (nextCount === 0) {
        return;
      }
      initialScrollPending = false;
      lastAutoScrollMessageCount = nextCount;
      messagesEndRef?.scrollIntoView({ behavior: 'auto' });
      return;
    }
    if (!autoScrollPinned) {
      lastAutoScrollMessageCount = nextCount;
      return;
    }
    const behavior: ScrollBehavior =
      nextCount > lastAutoScrollMessageCount ? 'smooth' : 'auto';
    lastAutoScrollMessageCount = nextCount;
    messagesEndRef?.scrollIntoView({ behavior });
  });

  return {
    get availableModels() { return modelSelection.availableModels; },
    get selectedModel() { return modelSelection.selectedModel; },
    setSelectedModel: modelSelection.setSelectedModel,
    get messages() { return polling.messages; },
    get input() { return input(); },
    setInput,
    get isLoading() { return ws.isLoading; },
    get streaming() { return ws.streaming; },
    get timelineEntries() { return ws.timelineEntries; },
    get runMetaById() { return ws.runMetaById; },
    get artifactsByRunId() { return ws.artifactsByRunId; },
    get historyFocus() { return ws.historyFocus; },
    get taskContext() { return ws.taskContext; },
    get sessionDiff() { return ws.sessionDiff; },
    dismissSessionDiff: ws.dismissSessionDiff,
    get isMerging() { return ws.isMerging; },
    handleMerge: ws.handleMerge,
    get isCancelling() { return ws.isCancelling; },
    handleCancel: ws.handleCancel,
    get error() { return polling.error; },
    setError: polling.setError,
    get attachedFiles() { return files.attachedFiles; },
    addFiles: files.addFiles,
    handleFileSelect: files.handleFileSelect,
    removeAttachedFile: files.removeAttachedFile,
    sendMessage: messaging.sendMessage,
    messagesEndRef,
  };
}
