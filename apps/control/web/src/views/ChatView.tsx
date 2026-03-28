import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useI18n } from '../store/i18n';
import type { Thread } from '../types';
import { rpc, rpcJson } from '../lib/rpc';
import { useToast } from '../store/toast';
import { Icons } from '../lib/Icons';
import { ChatErrorBanner } from './chat/ChatErrorBanner';
import { ChatHeader } from './chat/ChatHeader';
import { ModelSwitcher } from './chat/ModelSwitcher';
import { ChatInputBar } from './chat/ChatInputBar';
import { ChatMessageFeed } from './chat/ChatMessageFeed';
import { ChatShareModal } from './chat/ChatShareModal';
import { ChatExportModal } from './chat/ChatExportModal';
import { useChatSession } from '../hooks/useChatSession';
import { useChatSharing } from '../hooks/useChatSharing';
import { useMobileHeader } from '../store/mobile-header';

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

export function ChatView({
  thread,
  spaceId,
  onUpdateTitle,
  jumpToMessageId,
  jumpToMessageSequence,
  focusRunId,
  onJumpHandled,
  onRunFocusHandled,
  onOpenSearch,
  initialMessage,
  initialFiles,
  onInitialMessageSent,
  initialModel,
}: ChatViewProps) {
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
    threadId: thread.id, spaceId, onUpdateTitle,
    initialMessage, initialModel, focusSequence: jumpToMessageSequence,
  });

  const sharing = useChatSharing(thread.id);

  // Auto-send initialMessage once on mount
  const hasSentInitial = useRef(false);
  const [pendingSendWithFiles, setPendingSendWithFiles] = useState(false);
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  const onInitialMessageSentRef = useRef(onInitialMessageSent);
  onInitialMessageSentRef.current = onInitialMessageSent;
  useEffect(() => {
    if (initialMessage && !hasSentInitial.current) {
      hasSentInitial.current = true;
      if (initialFiles && initialFiles.length > 0) {
        addFiles(initialFiles);
        setPendingSendWithFiles(true);
      } else {
        sendMessageRef.current();
        onInitialMessageSentRef.current?.();
      }
    }
  }, [initialMessage]);
  useEffect(() => {
    if (pendingSendWithFiles) {
      setPendingSendWithFiles(false);
      sendMessageRef.current();
      onInitialMessageSentRef.current?.();
    }
  }, [pendingSendWithFiles]);

  // Cmd+K search shortcut
  useEffect(() => {
    if (!onOpenSearch) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenSearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); };
  }, [onOpenSearch]);

  // Jump-to-message
  const jumpStartRef = useRef<{ id: string; startedAt: number } | null>(null);
  const messageFeedContainerRef = useRef<HTMLDivElement>(null);
  const scrollToMessage = useCallback((messageId: string) => {
    const container = messageFeedContainerRef.current;
    if (!container) return false;
    const el = container.querySelector<HTMLElement>(`#message-${CSS.escape(messageId)}`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return true; }
    return false;
  }, []);
  useEffect(() => {
    if (!jumpToMessageId) { jumpStartRef.current = null; return; }
    if (!jumpStartRef.current || jumpStartRef.current.id !== jumpToMessageId) {
      jumpStartRef.current = { id: jumpToMessageId, startedAt: Date.now() };
    }
    const ok = scrollToMessage(jumpToMessageId);
    if (ok) { jumpStartRef.current = null; onJumpHandled?.(); return; }
    const elapsed = Date.now() - (jumpStartRef.current?.startedAt || Date.now());
    if (elapsed > 2000 && messages.length > 0) {
      showToast('error', t('messageNotLoaded'));
      jumpStartRef.current = null;
      onJumpHandled?.();
    }
  }, [jumpToMessageId, messages, scrollToMessage, onJumpHandled, showToast]);

  useEffect(() => { if (focusRunId) onRunFocusHandled?.(); }, [focusRunId, onRunFocusHandled]);

  const handleModelChange = useCallback(async (model: string) => {
    setSelectedModel(model);
    try {
      const res = await rpc.spaces[':spaceId'].model.$patch({
        param: { spaceId },
        json: { model } as Record<string, string>,
      });
      await rpcJson(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToSaveTier'));
    }
  }, [setSelectedModel, spaceId, setError]);

  useEffect(() => {
    setHeaderContent(
      <ModelSwitcher selectedModel={selectedModel} isLoading={isLoading} onModelChange={handleModelChange} />
    );
    return () => setHeaderContent(null);
  }, [selectedModel, isLoading, handleModelChange, setHeaderContent]);

  // Drag & drop
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDragOver = useCallback((e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback((e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }, []);
  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    if (e.dataTransfer.files) addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const iconBtnClass = "min-w-[44px] min-h-[44px] px-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 flex items-center justify-center";

  const headerActions = useMemo(() => (
    <div className="flex items-center gap-1">
      {onOpenSearch && (
        <button
          type="button"
          className="min-h-[44px] px-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 flex items-center gap-2"
          onClick={onOpenSearch}
          title={t('search')}
          aria-label={t('search')}
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Icons.Search className="w-4 h-4" />
          <span className="hidden md:inline text-sm">{t('search')}</span>
          <kbd className="hidden lg:flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-mono bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500">
            <span>{'\u2318'}</span>
            <span>K</span>
          </kbd>
        </button>
      )}
      <button type="button" className={iconBtnClass} onClick={() => sharing.setShowShareModal(true)} title={t('shareResource')} aria-label={t('shareResource')}>
        <Icons.Link className="w-4 h-4" />
      </button>
      <button type="button" className={iconBtnClass} onClick={() => sharing.setShowExportModal(true)} title={t('download')} aria-label={t('download')}>
        <Icons.Download className="w-4 h-4" />
      </button>
    </div>
  ), [t, iconBtnClass, onOpenSearch, sharing]);

  return (
    <div
      className="flex flex-col h-full min-h-0 bg-white dark:bg-zinc-900 relative"
      onDragOver={handleDragOver as unknown as React.DragEventHandler}
      onDragLeave={handleDragLeave as unknown as React.DragEventHandler}
      onDrop={handleDrop as unknown as React.DragEventHandler}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/70 dark:bg-zinc-900/70 backdrop-blur-sm border-2 border-dashed border-blue-400 rounded-xl pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-blue-500">
            <Icons.Upload className="w-10 h-10" />
            <span className="text-sm font-medium">{t('dropFilesToUpload')}</span>
          </div>
        </div>
      )}
      <ChatHeader selectedModel={selectedModel} isLoading={isLoading} onModelChange={handleModelChange} actions={headerActions} />

      {taskContext && (
        <div className="px-4 pb-3">
          <div className="mx-auto max-w-3xl rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{taskContext.title}</span>
              <span>{t(`taskStatus.${taskContext.status}` as never)}</span>
              <span>{t(`taskPriority.${taskContext.priority}` as never)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div ref={messageFeedContainerRef} className="flex flex-col flex-1 min-w-0">
          <ChatMessageFeed
            messages={messages} streaming={streaming} isLoading={isLoading}
            sessionDiff={sessionDiff} onMerge={handleMerge} isMerging={isMerging}
            onDismissDiff={dismissSessionDiff} emptyText={t('startConversation')}
            messagesEndRef={messagesEndRef} spaceId={spaceId}
          />
          {error && <ChatErrorBanner error={error} onDismiss={() => setError(null)} />}
          <ChatInputBar
            input={input} onInputChange={setInput}
            attachedFiles={attachedFiles} onFileSelect={handleFileSelect}
            onRemoveFile={removeAttachedFile} onSend={sendMessage}
            isLoading={isLoading} isCancelling={isCancelling} onCancel={handleCancel}
            attachLabel={t('attachFile')} placeholder={t('messageInputPlaceholder')}
            inputHint={t('inputHint')} onFilePaste={addFiles} isDragOver={isDragOver}
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
