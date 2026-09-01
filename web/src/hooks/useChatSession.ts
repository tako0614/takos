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
  ThreadHistoryFocus,
  ThreadHistoryTaskContext,
  ThreadHistoryTruncation,
} from "../types/index.ts";
import type {
  ChatRunArtifactMap,
  ChatRunMetaMap,
  ChatStreamingState,
  ChatTimelineEntry,
} from "../views/chat/chat-types.ts";
import { useMessagePolling } from "./useMessagePolling.ts";
import { useWebSocketConnection } from "./useWebSocketConnection.ts";
import { useFileAttachment } from "./useFileAttachment.ts";
import { useChatModelSelection } from "./useChatModelSelection.ts";
import { useChatAttachments } from "./useChatAttachments.ts";
import { useChatMessages } from "./useChatMessages.ts";
import {
  type ChatSessionInitState,
  nextChatSessionInitState,
} from "./chat-session-init.ts";
import { mergeInitialHistoryMessages } from "./chat-history-merge.ts";
import { parseChatHistoryResponse } from "./chat-history-response.ts";

export interface UseChatSessionOptions {
  threadId: Accessor<string>;
  spaceId: Accessor<string>;
  spaceRecordId: Accessor<string>;
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
  modelsLoading: Accessor<boolean>;
  modelsHaveError: Accessor<boolean>;
  modelIsReady: Accessor<boolean>;
  retryModels: () => Promise<void>;
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
  historyTruncation: Accessor<ThreadHistoryTruncation>;
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
  spaceRecordId,
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
    spaceRecordId,
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
    spaceRecordId,
    threadId,
  });

  const messaging = useChatMessages({
    threadId,
    spaceRecordId,
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
    const currentSpaceRecordId = spaceRecordId();

    polling.isMountedRef.current = true;

    ws.rootRunIdRef.current = null;
    ws.closeWebSocket();
    ws.currentRunIdRef.current = null;
    ws.lastEventIdRef.current = 0;
    polling.setMessages([]);
    polling.setMessageDataTruncated(false);
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
          query: {
            limit: String(limit),
            offset: String(offset),
            latest: currentFocusSequence == null ? "1" : "0",
          },
        });
        const data = parseChatHistoryResponse(
          await rpcJson<unknown>(res),
          {
            spaceId: currentSpaceRecordId,
            threadId: currentThreadId,
            limit,
            offset,
            includeMessages: true,
            latest: currentFocusSequence == null,
          },
        );

        if (!polling.isMountedRef.current) return;
        if (threadId() !== currentThreadId) return;
        if (spaceRecordId() !== currentSpaceRecordId) return;

        polling.setMessages((current) =>
          mergeInitialHistoryMessages(data.messages, current)
        );
        ws.applyHistorySnapshot({
          runs: data.runs || [],
          focus: data.focus,
          taskContext: data.taskContext,
          truncation: data.truncation,
        });

        if (data.activeRun) {
          ws.setIsLoading(true);
          ws.setCurrentRun(data.activeRun);
          ws.startWebSocket(data.activeRun.id);
        }

      } catch {
        if (!polling.isMountedRef.current) return;
        if (threadId() !== currentThreadId) return;
        polling.setError(
          t("failedToLoadMessages" as TranslationKey),
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
    // Walk up to the nearest scrollable ancestor by CSS rather than assuming a
    // fixed nesting depth (anchor.parentElement.parentElement) — that silently
    // broke autoscroll whenever the feed markup gained/lost a wrapper.
    let scrollContainer: HTMLElement | null = anchor?.parentElement ?? null;
    while (scrollContainer) {
      const overflowY = getComputedStyle(scrollContainer).overflowY;
      if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
        break;
      }
      scrollContainer = scrollContainer.parentElement;
    }
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
  const historyTruncation = (): ThreadHistoryTruncation => ({
    ...ws.historyTruncation,
    message_data: ws.historyTruncation.message_data ||
      polling.messageDataTruncated,
  });
  const isCancelling = () => ws.isCancelling;
  const error = () => polling.error;
  const attachedFiles = () => files.attachedFiles;

  return {
    availableModels,
    selectedModel,
    setSelectedModel: modelSelection.setSelectedModel,
    modelsLoading: modelSelection.isLoading,
    modelsHaveError: modelSelection.hasError,
    modelIsReady: modelSelection.isReady,
    retryModels: modelSelection.fetchSpaceModels,
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
    historyTruncation,
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
