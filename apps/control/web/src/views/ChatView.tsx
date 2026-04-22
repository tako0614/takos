import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { For, Show } from "solid-js";
import { useI18n } from "../store/i18n.ts";
import type { TranslationKey } from "../store/i18n.ts";
import type {
  AgentTaskPriority,
  AgentTaskStatus,
  Run,
  Thread,
} from "../types/index.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { useToast } from "../store/toast.ts";
import { Icons } from "../lib/Icons.tsx";
import { ChatErrorBanner } from "./chat/ChatErrorBanner.tsx";
import { ChatHeader } from "./chat/ChatHeader.tsx";
import { ModelSwitcher } from "./chat/ModelSwitcher.tsx";
import { ChatInputBar } from "./chat/ChatInputBar.tsx";
import { ChatMessageFeed } from "./chat/ChatMessageFeed.tsx";
import { ChatShareModal } from "./chat/ChatShareModal.tsx";
import { ChatExportModal } from "./chat/ChatExportModal.tsx";
import { useChatSession } from "../hooks/useChatSession.ts";
import { useChatSharing } from "../hooks/useChatSharing.ts";
import { useMobileHeader } from "../store/mobile-header.ts";
import { getFocusedRunEntries, getFocusedRunMeta } from "./chat/focused-run.ts";

const TASK_STATUS_LABEL_KEYS: Record<AgentTaskStatus, TranslationKey> = {
  planned: "taskStatus.planned",
  in_progress: "taskStatus.in_progress",
  blocked: "taskStatus.blocked",
  completed: "taskStatus.completed",
  cancelled: "taskStatus.cancelled",
  failed: "taskStatus.failed",
};

const TASK_PRIORITY_LABEL_KEYS: Record<AgentTaskPriority, TranslationKey> = {
  low: "taskPriority.low",
  medium: "taskPriority.medium",
  high: "taskPriority.high",
  urgent: "taskPriority.urgent",
};

const RUN_STATUS_LABEL_KEYS: Record<Run["status"], TranslationKey> = {
  pending: "runStatus_pending",
  queued: "runStatus_queued",
  running: "runStatus_running",
  completed: "runStatus_completed",
  failed: "runStatus_failed",
  cancelled: "runStatus_cancelled",
};

export interface ChatViewProps {
  thread: Thread;
  spaceId: string;
  onUpdateTitle: (title: string) => void;
  jumpToMessageId?: string | null;
  jumpToMessageSequence?: number | null;
  focusRunId?: string | null;
  onJumpHandled?: () => void;
  onRunFocusHandled?: () => void;
  onOpenSearch?: () => void;
  initialMessage?: string;
  initialFiles?: File[];
  onInitialMessageSent?: () => void;
  initialModel?: string;
}

export function ChatView(props: ChatViewProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const mobileHeader = useMobileHeader();
  const threadId = () => props.thread.id;
  const spaceId = () => props.spaceId;
  const initialMessage = () => props.initialMessage;
  const initialFiles = () => props.initialFiles;
  const initialModel = () => props.initialModel;
  const jumpMessageId = () => props.jumpToMessageId;
  const jumpMessageSequence = () => props.jumpToMessageSequence;
  const focusRunId = () => props.focusRunId;
  const currentTaskContext = () => taskContext();

  const {
    selectedModel,
    setSelectedModel,
    messages,
    input,
    setInput,
    isLoading,
    streaming,
    timelineEntries,
    runMetaById,
    taskContext,
    sessionDiff,
    dismissSessionDiff,
    isMerging,
    handleMerge,
    isCancelling,
    handleCancel,
    error,
    setError,
    attachedFiles,
    addFiles,
    handleFileSelect,
    removeAttachedFile,
    sendMessage,
    messagesEndRef,
  } = useChatSession({
    threadId,
    spaceId,
    onUpdateTitle: props.onUpdateTitle,
    initialMessage,
    initialModel,
    focusSequence: jumpMessageSequence,
  });

  const sharing = useChatSharing(threadId);
  let focusedRunPanelRef: HTMLDivElement | undefined;

  const focusedRunMeta = createMemo(() =>
    getFocusedRunMeta(runMetaById(), focusRunId())
  );
  const focusedRunEntries = createMemo(() =>
    getFocusedRunEntries(timelineEntries(), focusRunId()).slice(-8)
  );

  // Auto-send initialMessage once on mount
  const [pendingSendWithFiles, setPendingSendWithFiles] = createSignal(false);
  let initialSendThreadId: string | null = null;
  let sendMessageRef = sendMessage;
  createEffect(() => {
    sendMessageRef = sendMessage;
  });
  let onInitialMessageSentRef = props.onInitialMessageSent;
  createEffect(() => {
    onInitialMessageSentRef = props.onInitialMessageSent;
  });
  createEffect(() => {
    const currentMessage = initialMessage();
    const currentFiles = initialFiles() ?? [];
    const currentThreadId = threadId();
    if (!currentMessage) {
      setPendingSendWithFiles(false);
      return;
    }
    if (initialSendThreadId === currentThreadId) {
      return;
    }
    initialSendThreadId = currentThreadId;

    setInput(currentMessage);
    if (currentFiles.length > 0) {
      addFiles(currentFiles);
      setPendingSendWithFiles(true);
    } else {
      void sendMessageRef().finally(() => {
        onInitialMessageSentRef?.();
      });
    }
  });
  createEffect(() => {
    if (pendingSendWithFiles()) {
      setPendingSendWithFiles(false);
      void sendMessageRef().finally(() => {
        onInitialMessageSentRef?.();
      });
    }
  });

  // Cmd+K search shortcut
  createEffect(() => {
    if (!props.onOpenSearch) return;
    const onOpenSearch = props.onOpenSearch;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenSearch();
      }
    };
    globalThis.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      globalThis.removeEventListener("keydown", handleKeyDown);
    });
  });

  // Jump-to-message
  let jumpStart: { id: string; startedAt: number } | null = null;
  let messageFeedContainerRef: HTMLDivElement | undefined;
  const scrollToMessage = (messageId: string) => {
    const container = messageFeedContainerRef;
    if (!container) return false;
    const el = container.querySelector<HTMLElement>(
      `#message-${CSS.escape(messageId)}`,
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }
    return false;
  };
  createEffect(() => {
    const currentJumpToMessageId = jumpMessageId();
    const currentJumpToMessageSequence = jumpMessageSequence();
    if (!currentJumpToMessageId) {
      jumpStart = null;
      return;
    }
    const hasTargetMessage = messages().some((message) =>
      message.id === currentJumpToMessageId
    );
    if (!jumpStart || jumpStart.id !== currentJumpToMessageId) {
      jumpStart = { id: currentJumpToMessageId, startedAt: Date.now() };
    }
    const ok = scrollToMessage(currentJumpToMessageId);
    if (ok) {
      jumpStart = null;
      props.onJumpHandled?.();
      return;
    }
    if (currentJumpToMessageSequence == null) {
      return;
    }
    const elapsed = Date.now() - (jumpStart?.startedAt || Date.now());
    if (elapsed > 2000 && !hasTargetMessage && messages().length > 0) {
      showToast("error", t("messageNotLoaded"));
      jumpStart = null;
      props.onJumpHandled?.();
    }
  });

  createEffect(() => {
    const currentFocusRunId = focusRunId();
    if (!currentFocusRunId) return;
    const scrollIntoView = () => {
      focusedRunPanelRef?.scrollIntoView({ behavior: "auto", block: "start" });
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(scrollIntoView);
      return;
    }
    scrollIntoView();
  });

  const handleModelChange = async (model: string) => {
    setSelectedModel(model);
    try {
      const res = await rpc.spaces[":spaceId"].model.$patch({
        param: { spaceId: spaceId() },
        json: { model } as Record<string, string>,
      });
      await rpcJson(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToSaveTier"));
    }
  };

  createEffect(() => {
    mobileHeader.setHeaderContent(
      <ModelSwitcher
        selectedModel={selectedModel()}
        isLoading={isLoading()}
        onModelChange={handleModelChange}
      />,
    );
    onCleanup(() => mobileHeader.setHeaderContent(null));
  });

  // Drag & drop
  const [isDragOver, setIsDragOver] = createSignal(false);
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer?.files) addFiles(Array.from(e.dataTransfer.files));
  };

  const iconBtnClass =
    "min-w-[44px] min-h-[44px] px-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 flex items-center justify-center";

  const headerActions = createMemo(() => (
    <div class="flex items-center gap-1">
      <Show when={props.onOpenSearch}>
        <button
          type="button"
          class="min-h-[44px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 flex items-center gap-2"
          onClick={props.onOpenSearch}
          title={t("search")}
          aria-label={t("search")}
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Icons.Search class="w-4 h-4" />
          <span class="hidden md:inline text-sm">{t("search")}</span>
          <kbd class="hidden lg:flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500">
            <span>⌘</span>
            <span>K</span>
          </kbd>
        </button>
      </Show>
      <button
        type="button"
        class={iconBtnClass}
        onClick={() => sharing.setShowShareModal(true)}
        title={t("shareResource")}
        aria-label={t("shareResource")}
      >
        <Icons.Link class="w-4 h-4" />
      </button>
      <button
        type="button"
        class={iconBtnClass}
        onClick={() => sharing.setShowExportModal(true)}
        title={t("download")}
        aria-label={t("download")}
      >
        <Icons.Download class="w-4 h-4" />
      </button>
    </div>
  ));

  return (
    <div
      class="flex flex-col h-full min-h-0 bg-white dark:bg-zinc-900 relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Show when={isDragOver()}>
        <div class="absolute inset-0 z-50 flex items-center justify-center bg-white/70 dark:bg-zinc-900/70 backdrop-blur-sm border-2 border-dashed border-blue-400 rounded-xl pointer-events-none">
          <div class="flex flex-col items-center gap-2 text-blue-500">
            <Icons.Upload class="w-10 h-10" />
            <span class="text-sm font-medium">{t("dropFilesToUpload")}</span>
          </div>
        </div>
      </Show>
      <ChatHeader
        selectedModel={selectedModel()}
        isLoading={isLoading()}
        onModelChange={handleModelChange}
        actions={headerActions()}
      />

      <Show when={currentTaskContext()}>
        <div class="px-4 pb-3">
          <div class="mx-auto max-w-3xl rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-3">
            <div class="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span class="font-medium text-zinc-900 dark:text-zinc-100">
                {currentTaskContext()!.title}
              </span>
              <span>
                {t(TASK_STATUS_LABEL_KEYS[currentTaskContext()!.status])}
              </span>
              <span>
                {t(TASK_PRIORITY_LABEL_KEYS[currentTaskContext()!.priority])}
              </span>
            </div>
          </div>
        </div>
      </Show>

      <Show when={focusRunId()}>
        <div ref={focusedRunPanelRef} class="px-4 pb-3">
          <div class="mx-auto max-w-3xl rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <span class="font-medium text-zinc-900 dark:text-zinc-100">
                    Run {focusRunId()!.slice(0, 8)}
                  </span>
                  <Show when={focusedRunMeta()}>
                    <span>
                      {t(RUN_STATUS_LABEL_KEYS[focusedRunMeta()!.status])}
                    </span>
                  </Show>
                </div>

                <Show
                  when={focusedRunEntries().length > 0}
                  fallback={
                    <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                      {t("loading")}
                    </p>
                  }
                >
                  <div class="mt-3 space-y-2">
                    <For each={focusedRunEntries()}>
                      {(entry) => (
                        <div
                          class={`rounded-lg border px-3 py-2 ${
                            entry.failed
                              ? "border-red-200 bg-red-50/80 dark:border-red-900/60 dark:bg-red-950/30"
                              : "border-zinc-200 bg-white/80 dark:border-zinc-700 dark:bg-zinc-950"
                          }`}
                        >
                          <p
                            class={`text-sm font-medium ${
                              entry.failed
                                ? "text-red-900 dark:text-red-100"
                                : "text-zinc-900 dark:text-zinc-100"
                            }`}
                          >
                            {entry.message}
                          </p>
                          <Show when={entry.detail}>
                            <p
                              class={`mt-1 whitespace-pre-wrap text-xs ${
                                entry.failed
                                  ? "text-red-700 dark:text-red-200"
                                  : "text-zinc-500 dark:text-zinc-400"
                              }`}
                            >
                              {entry.detail}
                            </p>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              <Show when={props.onRunFocusHandled}>
                <button
                  type="button"
                  class="min-w-[44px] min-h-[44px] px-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 flex items-center justify-center"
                  onClick={() => props.onRunFocusHandled?.()}
                  aria-label={t("close")}
                  title={t("close")}
                >
                  <Icons.X class="w-4 h-4" />
                </button>
              </Show>
            </div>
          </div>
        </div>
      </Show>

      <div class="flex flex-1 min-h-0 overflow-hidden">
        <div ref={messageFeedContainerRef} class="flex flex-col flex-1 min-w-0">
          <ChatMessageFeed
            messages={messages()}
            streaming={streaming()}
            timelineEntries={timelineEntries()}
            runMetaById={runMetaById()}
            isLoading={isLoading()}
            sessionDiff={sessionDiff()}
            onMerge={handleMerge}
            isMerging={isMerging()}
            onDismissDiff={dismissSessionDiff}
            emptyText={t("startConversation")}
            messagesEndRef={messagesEndRef}
            spaceId={props.spaceId}
          />
          <Show when={error()}>
            <ChatErrorBanner
              error={error()!}
              onDismiss={() => setError(null)}
            />
          </Show>
          <ChatInputBar
            input={input()}
            onInputChange={setInput}
            attachedFiles={attachedFiles()}
            onFileSelect={handleFileSelect}
            onRemoveFile={removeAttachedFile}
            onSend={sendMessage}
            isLoading={isLoading()}
            isCancelling={isCancelling()}
            onCancel={handleCancel}
            attachLabel={t("attachFile")}
            placeholder={t("messageInputPlaceholder")}
            inputHint={t("inputHint")}
            onFilePaste={addFiles}
            isDragOver={isDragOver()}
          />
        </div>
      </div>

      <ChatShareModal
        isOpen={sharing.showShareModal()}
        onClose={() => sharing.setShowShareModal(false)}
        sharesLoading={sharing.sharesLoading()}
        shares={sharing.shares()}
        shareMode={sharing.shareMode()}
        onShareModeChange={sharing.setShareMode}
        sharePassword={sharing.sharePassword()}
        onSharePasswordChange={sharing.setSharePassword}
        shareExpiresInDays={sharing.shareExpiresInDays()}
        onShareExpiresInDaysChange={sharing.setShareExpiresInDays}
        shareError={sharing.shareError()}
        creatingShare={sharing.creatingShare()}
        onFetchShares={sharing.fetchShares}
        onCreateShare={sharing.createShare}
        onRevokeShare={sharing.revokeShare}
      />
      <ChatExportModal
        isOpen={sharing.showExportModal()}
        onClose={() => sharing.setShowExportModal(false)}
        onExport={sharing.downloadExport}
      />
    </div>
  );
}
