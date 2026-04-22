import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
import { type TranslationKey, useI18n } from "../store/i18n.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
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
import { useMessagePolling } from "./useMessagePolling.ts";
import {
  type SessionDiffState,
  useWebSocketConnection,
} from "./useWebSocketConnection.ts";
import { useFileAttachment } from "./useFileAttachment.ts";
import { useChatModelSelection } from "./useChatModelSelection.ts";
import { useChatAttachments } from "./useChatAttachments.ts";
import { useChatMessages } from "./useChatMessages.ts";
import {
  type ChatSessionInitState,
  nextChatSessionInitState,
} from "./chat-session-init.ts";

export type { SessionDiffState } from "./useWebSocketConnection.ts";

export interface UseChatSessionOptions {
  threadId: Accessor<string>;
  spaceId: Accessor<string>;
  onUpdateTitle: (title: string) => void;
  initialMessage?: Accessor<string | undefined>;
  initialModel?: Accessor<string | undefined>;
  focusSequence?: Accessor<number | null | undefined>;
}

export interface UseChatSessionResult {
  availableModels: Accessor<
    import("../lib/modelCatalog.ts").ModelSelectOption[]
  >;
  selectedModel: Accessor<string>;
  setSelectedModel: (model: string) => void;
  messages: Accessor<Message[]>;
  input: Accessor<string>;
  setInput: (value: string) => void;
  isLoading: Accessor<boolean>;
  streaming: Accessor<ChatStreamingState>;
  timelineEntries: Accessor<ChatTimelineEntry[]>;
  runMetaById: Accessor<ChatRunMetaMap>;
  artifactsByRunId: Accessor<ChatRunArtifactMap>;
  historyFocus: Accessor<ThreadHistoryFocus | null>;
  taskContext: Accessor<ThreadHistoryTaskContext | null>;
  sessionDiff: Accessor<SessionDiffState | null>;
  dismissSessionDiff: () => void;
  isMerging: Accessor<boolean>;
  handleMerge: () => Promise<void>;
  isCancelling: Accessor<boolean>;
  handleCancel: () => Promise<void>;
  error: Accessor<string | null>;
  setError: (value: string | null) => void;
  attachedFiles: Accessor<File[]>;
  addFiles: (files: File[]) => void;
  handleFileSelect: (e: Event & { currentTarget: HTMLInputElement }) => void;
  removeAttachedFile: (index: number) => void;
  sendMessage: () => Promise<void>;
  messagesEndRef: (element: HTMLDivElement | undefined) => void;
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
  const [input, setInput] = createSignal(initialMessage?.() ?? "");

  // Scroll tracking refs (owned by orchestrator because the auto-scroll
  // effect depends on state from both the polling and WebSocket hooks)
  const [messagesEndRef, setMessagesEndRef] = createSignal<
    HTMLDivElement | undefined
  >(undefined);
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
    input,
    setInput,
    selectedModel: modelSelection.selectedModel,
    onUpdateTitle,
    attachedFiles: () => files.attachedFiles,
    setAttachedFiles: files.setAttachedFiles,
    isLoading: () => ws.isLoading,
    rootRunIdRef: ws.rootRunIdRef,
    closeWebSocket: ws.closeWebSocket,
    currentRunIdRef: ws.currentRunIdRef,
    lastEventIdRef: ws.lastEventIdRef,
    resetStreamingState: ws.resetStreamingState,
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

  const initState = createMemo((previous?: ChatSessionInitState) =>
    nextChatSessionInitState(
      previous,
      threadId(),
      focusSequence?.() ?? null,
    )
  );

  // --- Initialization effect ---
  createEffect(() => {
    const currentInitState = initState();
    const currentThreadId = currentInitState.threadId;
    const currentFocusSequence = currentInitState.focusSequence;
    const currentInitialMessage = untrack(() => initialMessage?.() ?? "");

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
    setInput(currentInitialMessage);
    files.setAttachedFiles([]);
    setMessagesEndRef(undefined);
    initialScrollPending = true;
    autoScrollPinned = true;
    lastAutoScrollMessageCount = 0;

    const init = async () => {
      try {
        const limit = currentFocusSequence != null ? 200 : 100;
        const offset = currentFocusSequence != null
          ? Math.max(0, currentFocusSequence - Math.floor(limit / 2))
          : 0;
        const res = await rpc.threads[":id"].history.$get({
          param: { id: currentThreadId },
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
        if (threadId() !== currentThreadId) return;

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
        if (!polling.isMountedRef.current) return;
        if (threadId() !== currentThreadId) return;
        polling.setError(
          t("failedToLoad" as TranslationKey) || "Failed to load messages",
        );
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
    threadId();

    const anchor = messagesEndRef();
    const scrollContainer = anchor?.parentElement?.parentElement;
    if (!(scrollContainer instanceof HTMLElement)) {
      return;
    }

    function updatePinnedState(): void {
      const distanceFromBottom = (scrollContainer as HTMLElement).scrollHeight -
        (scrollContainer as HTMLElement).scrollTop -
        (scrollContainer as HTMLElement).clientHeight;
      autoScrollPinned = distanceFromBottom <= 96;
    }

    autoScrollPinned = true;
    scrollContainer.addEventListener("scroll", updatePinnedState, {
      passive: true,
    });
    onCleanup(() => {
      scrollContainer.removeEventListener("scroll", updatePinnedState);
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
      messagesEndRef()?.scrollIntoView({ behavior: "auto" });
      return;
    }
    if (!autoScrollPinned) {
      lastAutoScrollMessageCount = nextCount;
      return;
    }
    const behavior: ScrollBehavior = nextCount > lastAutoScrollMessageCount
      ? "smooth"
      : "auto";
    lastAutoScrollMessageCount = nextCount;
    messagesEndRef()?.scrollIntoView({ behavior });
  });

  const availableModels = modelSelection.availableModels;
  const selectedModel = modelSelection.selectedModel;
  const messages = () => polling.messages;
  const isLoading = () => ws.isLoading;
  const streaming = () => ws.streaming;
  const timelineEntries = () => ws.timelineEntries;
  const runMetaById = () => ws.runMetaById;
  const artifactsByRunId = () => ws.artifactsByRunId;
  const historyFocus = () => ws.historyFocus;
  const taskContext = () => ws.taskContext;
  const sessionDiff = () => ws.sessionDiff;
  const isMerging = () => ws.isMerging;
  const isCancelling = () => ws.isCancelling;
  const error = () => polling.error;
  const attachedFiles = () => files.attachedFiles;

  return {
    availableModels,
    selectedModel,
    setSelectedModel: modelSelection.setSelectedModel,
    messages,
    input,
    setInput,
    isLoading,
    streaming,
    timelineEntries,
    runMetaById,
    artifactsByRunId,
    historyFocus,
    taskContext,
    sessionDiff,
    dismissSessionDiff: ws.dismissSessionDiff,
    isMerging,
    handleMerge: ws.handleMerge,
    isCancelling,
    handleCancel: ws.handleCancel,
    error,
    setError: polling.setError,
    attachedFiles,
    addFiles: files.addFiles,
    handleFileSelect: files.handleFileSelect,
    removeAttachedFile: files.removeAttachedFile,
    sendMessage: messaging.sendMessage,
    messagesEndRef: setMessagesEndRef,
  };
}
