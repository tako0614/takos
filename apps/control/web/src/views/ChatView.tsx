import { createSignal, createEffect, createMemo, onCleanup } from 'solid-js';
import { Show } from 'solid-js';
import { useI18n } from '../store/i18n.ts';
import type { Thread } from '../types/index.ts';
import { rpc, rpcJson } from '../lib/rpc.ts';
import { useToast } from '../store/toast.ts';
import { Icons } from '../lib/Icons.tsx';
import { ChatErrorBanner } from './chat/ChatErrorBanner.tsx';
import { ChatHeader } from './chat/ChatHeader.tsx';
import { ModelSwitcher } from './chat/ModelSwitcher.tsx';
import { ChatInputBar } from './chat/ChatInputBar.tsx';
import { ChatMessageFeed } from './chat/ChatMessageFeed.tsx';
import { ChatShareModal } from './chat/ChatShareModal.tsx';
import { ChatExportModal } from './chat/ChatExportModal.tsx';
import { useChatSession } from '../hooks/useChatSession.ts';
import { useChatSharing } from '../hooks/useChatSharing.ts';
import { useMobileHeader } from '../store/mobile-header.ts';

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
  const { setHeaderContent } = useMobileHeader();

  const {
    selectedModel, setSelectedModel,
    messages, input, setInput,
    isLoading, streaming, taskContext,
    sessionDiff, dismissSessionDiff, isMerging, handleMerge,
    isCancelling, handleCancel,
    error, setError,
    attachedFiles, addFiles, handleFileSelect, removeAttachedFile,
    sendMessage, messagesEndRef,
  } = useChatSession({
    threadId: props.thread.id, spaceId: props.spaceId, onUpdateTitle: props.onUpdateTitle,
    initialMessage: props.initialMessage, initialModel: props.initialModel, focusSequence: props.jumpToMessageSequence,
  });

  const sharing = useChatSharing(props.thread.id);

  // Auto-send initialMessage once on mount
  let hasSentInitial = false;
  const [pendingSendWithFiles, setPendingSendWithFiles] = createSignal(false);
  let sendMessageRef = sendMessage;
  createEffect(() => {
    sendMessageRef = sendMessage;
  });
  let onInitialMessageSentRef = props.onInitialMessageSent;
  createEffect(() => {
    onInitialMessageSentRef = props.onInitialMessageSent;
  });
  createEffect(() => {
    if (props.initialMessage && !hasSentInitial) {
      hasSentInitial = true;
      if (props.initialFiles && props.initialFiles.length > 0) {
        addFiles(props.initialFiles);
        setPendingSendWithFiles(true);
      } else {
        sendMessageRef();
        onInitialMessageSentRef?.();
      }
    }
  });
  createEffect(() => {
    if (pendingSendWithFiles()) {
      setPendingSendWithFiles(false);
      sendMessageRef();
      onInitialMessageSentRef?.();
    }
  });

  // Cmd+K search shortcut
  createEffect(() => {
    if (!props.onOpenSearch) return;
    const onOpenSearch = props.onOpenSearch;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenSearch();
      }
    };
    globalThis.addEventListener('keydown', handleKeyDown);
    onCleanup(() => { globalThis.removeEventListener('keydown', handleKeyDown); });
  });

  // Jump-to-message
  let jumpStart: { id: string; startedAt: number } | null = null;
  let messageFeedContainerRef: HTMLDivElement | undefined;
  const scrollToMessage = (messageId: string) => {
    const container = messageFeedContainerRef;
    if (!container) return false;
    const el = container.querySelector<HTMLElement>(`#message-${CSS.escape(messageId)}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return true; }
    return false;
  };
  createEffect(() => {
    const jumpToMessageId = props.jumpToMessageId;
    if (!jumpToMessageId) { jumpStart = null; return; }
    if (!jumpStart || jumpStart.id !== jumpToMessageId) {
      jumpStart = { id: jumpToMessageId, startedAt: Date.now() };
    }
    const ok = scrollToMessage(jumpToMessageId);
    if (ok) { jumpStart = null; props.onJumpHandled?.(); return; }
    const elapsed = Date.now() - (jumpStart?.startedAt || Date.now());
    if (elapsed > 2000 && messages.length > 0) {
      showToast('error', t('messageNotLoaded'));
      jumpStart = null;
      props.onJumpHandled?.();
    }
  });

  createEffect(() => { if (props.focusRunId) props.onRunFocusHandled?.(); });

  const handleModelChange = async (model: string) => {
    setSelectedModel(model);
    try {
      const res = await rpc.spaces[':spaceId'].model.$patch({
        param: { spaceId: props.spaceId },
        json: { model } as Record<string, string>,
      });
      await rpcJson(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToSaveTier'));
    }
  };

  createEffect(() => {
    setHeaderContent(
      <ModelSwitcher selectedModel={selectedModel} isLoading={isLoading} onModelChange={handleModelChange} />
    );
    onCleanup(() => setHeaderContent(null));
  });

  // Drag & drop
  const [isDragOver, setIsDragOver] = createSignal(false);
  const handleDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); };
  const handleDragLeave = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    if (e.dataTransfer?.files) addFiles(Array.from(e.dataTransfer.files));
  };

  const iconBtnClass = "min-w-[44px] min-h-[44px] px-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 flex items-center justify-center";

  const headerActions = createMemo(() => (
    <div class="flex items-center gap-1">
      <Show when={props.onOpenSearch}>
        <button
          type="button"
          class="min-h-[44px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 flex items-center gap-2"
          onClick={props.onOpenSearch}
          title={t('search')}
          aria-label={t('search')}
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Icons.Search class="w-4 h-4" />
          <span class="hidden md:inline text-sm">{t('search')}</span>
          <kbd class="hidden lg:flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500">
            <span>⌘</span>
            <span>K</span>
          </kbd>
        </button>
      </Show>
      <button type="button" class={iconBtnClass} onClick={() => sharing.setShowShareModal(true)} title={t('shareResource')} aria-label={t('shareResource')}>
        <Icons.Link class="w-4 h-4" />
      </button>
      <button type="button" class={iconBtnClass} onClick={() => sharing.setShowExportModal(true)} title={t('download')} aria-label={t('download')}>
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
            <span class="text-sm font-medium">{t('dropFilesToUpload')}</span>
          </div>
        </div>
      </Show>
      <ChatHeader selectedModel={selectedModel} isLoading={isLoading} onModelChange={handleModelChange} actions={headerActions()} />

      <Show when={taskContext}>
        <div class="px-4 pb-3">
          <div class="mx-auto max-w-3xl rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-3">
            <div class="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span class="font-medium text-zinc-900 dark:text-zinc-100">{taskContext!.title}</span>
              <span>{t(`taskStatus.${taskContext!.status}` as never)}</span>
              <span>{t(`taskPriority.${taskContext!.priority}` as never)}</span>
            </div>
          </div>
        </div>
      </Show>

      <div class="flex flex-1 min-h-0 overflow-hidden">
        <div ref={messageFeedContainerRef} class="flex flex-col flex-1 min-w-0">
          <ChatMessageFeed
            messages={messages} streaming={streaming} isLoading={isLoading}
            sessionDiff={sessionDiff} onMerge={handleMerge} isMerging={isMerging}
            onDismissDiff={dismissSessionDiff} emptyText={t('startConversation')}
            messagesEndRef={messagesEndRef} spaceId={props.spaceId}
          />
          <Show when={error}>
            <ChatErrorBanner error={error!} onDismiss={() => setError(null)} />
          </Show>
          <ChatInputBar
            input={input} onInputChange={setInput}
            attachedFiles={attachedFiles} onFileSelect={handleFileSelect}
            onRemoveFile={removeAttachedFile} onSend={sendMessage}
            isLoading={isLoading} isCancelling={isCancelling} onCancel={handleCancel}
            attachLabel={t('attachFile')} placeholder={t('messageInputPlaceholder')}
            inputHint={t('inputHint')} onFilePaste={addFiles} isDragOver={isDragOver()}
          />
        </div>
      </div>

      <ChatShareModal
        isOpen={sharing.showShareModal} onClose={() => sharing.setShowShareModal(false)}
        sharesLoading={sharing.sharesLoading} shares={sharing.shares}
        shareMode={sharing.shareMode} onShareModeChange={sharing.setShareMode}
        sharePassword={sharing.sharePassword} onSharePasswordChange={sharing.setSharePassword}
        shareExpiresInDays={sharing.shareExpiresInDays} onShareExpiresInDaysChange={sharing.setShareExpiresInDays}
        shareError={sharing.shareError} creatingShare={sharing.creatingShare}
        onFetchShares={sharing.fetchShares} onCreateShare={sharing.createShare}
        onRevokeShare={sharing.revokeShare}
      />
      <ChatExportModal
        isOpen={sharing.showExportModal} onClose={() => sharing.setShowExportModal(false)}
        onExport={sharing.downloadExport}
      />
    </div>
  );
}
