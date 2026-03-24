import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useI18n } from '../providers/I18nProvider';
import type { Thread, UserSettings } from '../types';
import { rpc, rpcJson } from '../lib/rpc';
import { useToast } from '../hooks/useToast';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Icons } from '../lib/Icons';
import { ChatErrorBanner } from './chat/ChatErrorBanner';
import { ChatHeader } from './chat/ChatHeader';
import { ModelSwitcher } from './chat/ModelSwitcher';
import { ChatInputBar } from './chat/ChatInputBar';
import { ChatMessageFeed } from './chat/ChatMessageFeed';
import { useChatSession } from '../hooks/useChatSession';
import { getTierFromModel } from '../lib/modelCatalog';
import { useMobileHeader } from '../contexts/MobileHeaderContext';

export interface ChatViewProps {
  thread: Thread;
  spaceId: string;
  userSettings: UserSettings | null;
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

type ThreadShare = {
  id: string;
  thread_id: string;
  space_id: string;
  created_by: string | null;
  token: string;
  mode: 'public' | 'password';
  expires_at: string | null;
  revoked_at: string | null;
  last_accessed_at: string | null;
  created_at: string;
  share_path: string;
  share_url: string;
};

function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) return null;
  const utf8 = /filename\\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(value);
  return plain?.[1] || null;
}

export function ChatView({
  thread,
  spaceId,
  userSettings: _userSettings,
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
  const [showShareModal, setShowShareModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  // Share modal state
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shares, setShares] = useState<ThreadShare[]>([]);
  const [shareMode, setShareMode] = useState<'public' | 'password'>('public');
  const [sharePassword, setSharePassword] = useState('');
  const [shareExpiresInDays, setShareExpiresInDays] = useState<string>('');
  const [shareError, setShareError] = useState<string | null>(null);
  const [creatingShare, setCreatingShare] = useState(false);

  const {
    selectedModel,
    setSelectedModel,
    messages,
    input,
    setInput,
    isLoading,
    streaming,
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
    threadId: thread.id,
    spaceId,
    onUpdateTitle,
    initialMessage,
    initialModel,
    focusSequence: jumpToMessageSequence,
  });

  // Auto-send initialMessage once on mount (input already initialized to initialMessage in useChatSession)
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
        // addFiles queues a state update; defer sendMessage to the next render
        // so that sendMessage's closure captures the updated attachedFiles.
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

  useEffect(() => {
    if (!onOpenSearch) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.altKey || event.shiftKey) return;
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!isShortcut) return;

      event.preventDefault();
      onOpenSearch();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onOpenSearch]);

  const jumpStartRef = useRef<{ id: string; startedAt: number } | null>(null);
  const messageFeedContainerRef = useRef<HTMLDivElement>(null);

  const scrollToMessage = useCallback((messageId: string) => {
    const container = messageFeedContainerRef.current;
    if (!container) return false;
    const el = container.querySelector<HTMLElement>(`#message-${CSS.escape(messageId)}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    if (!jumpToMessageId) {
      jumpStartRef.current = null;
      return;
    }

    if (!jumpStartRef.current || jumpStartRef.current.id !== jumpToMessageId) {
      jumpStartRef.current = { id: jumpToMessageId, startedAt: Date.now() };
    }

    const ok = scrollToMessage(jumpToMessageId);
    if (ok) {
      jumpStartRef.current = null;
      onJumpHandled?.();
      return;
    }

    const elapsed = Date.now() - (jumpStartRef.current?.startedAt || Date.now());
    if (elapsed > 2000 && messages.length > 0) {
      showToast('error', t('messageNotLoaded'));
      jumpStartRef.current = null;
      onJumpHandled?.();
    }
  }, [jumpToMessageId, messages, scrollToMessage, onJumpHandled, showToast]);

  useEffect(() => {
    if (focusRunId) {
      onRunFocusHandled?.();
    }
  }, [focusRunId, onRunFocusHandled]);

  const handleTierChange = useCallback(async (model: string) => {
    setSelectedModel(model);
    try {
      const res = await rpc.spaces[':spaceId'].model.$patch({
        param: { spaceId },
        json: { tier: getTierFromModel(model) } as Record<string, string>,
      });
      await rpcJson(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToSaveTier'));
    }
  }, [setSelectedModel, spaceId, setError]);

  // モバイルヘッダーにモデル切り替えを注入
  useEffect(() => {
    setHeaderContent(
      <ModelSwitcher
        selectedModel={selectedModel}
        isLoading={isLoading}
        onTierChange={handleTierChange}
      />
    );
    return () => setHeaderContent(null);
  }, [selectedModel, isLoading, handleTierChange, setHeaderContent]);

  const fetchShares = useCallback(async () => {
    setSharesLoading(true);
    setShareError(null);
    try {
      const res = await rpc.threads[':id'].shares.$get({ param: { id: thread.id } });
      const data = await rpcJson<{ shares: ThreadShare[] }>(res);
      setShares(data.shares || []);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : t('failedToLoadShares'));
    } finally {
      setSharesLoading(false);
    }
  }, [thread.id]);

  useEffect(() => {
    if (showShareModal) {
      fetchShares();
    }
  }, [showShareModal, fetchShares]);

  const createShare = useCallback(async () => {
    setCreatingShare(true);
    setShareError(null);
    try {
      const expires_in_days = shareExpiresInDays.trim() ? Number.parseInt(shareExpiresInDays.trim(), 10) : undefined;
      const res = await rpc.threads[':id'].share.$post({
        param: { id: thread.id },
        json: {
          mode: shareMode,
          password: shareMode === 'password' ? sharePassword : undefined,
          expires_in_days: typeof expires_in_days === 'number' && Number.isFinite(expires_in_days) ? expires_in_days : undefined,
        },
      });
      const data = await rpcJson<{ share: ThreadShare; share_url: string }>(res);
      showToast('success', t('created') || 'Created');
      if (data.share_url) {
        try {
          await navigator.clipboard.writeText(data.share_url);
          showToast('success', t('copied') || 'Copied');
        } catch { /* ignored */ }
      }
      setSharePassword('');
      setShareExpiresInDays('');
      await fetchShares();
    } catch (err) {
      setShareError(err instanceof Error ? err.message : t('failedToCreateShare'));
    } finally {
      setCreatingShare(false);
    }
  }, [fetchShares, shareExpiresInDays, shareMode, sharePassword, showToast, t, thread.id]);

  const revokeShare = useCallback(async (shareId: string) => {
    try {
      const res = await rpc.threads[':id'].shares[':shareId'].revoke.$post({
        param: { id: thread.id, shareId },
      });
      await rpcJson(res);
      showToast('success', t('revoked') || 'Revoked');
      await fetchShares();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToRevoke'));
    }
  }, [fetchShares, showToast, t, thread.id]);

  const downloadExport = useCallback(async (format: 'markdown' | 'json' | 'pdf') => {
    try {
      const res = await rpc.threads[':id'].export.$get({
        param: { id: thread.id },
        query: { format },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || t('exportFailed'));
      }
      const filename =
        parseContentDispositionFilename(res.headers.get('Content-Disposition')) ||
        `thread-${thread.id}.${format === 'markdown' ? 'md' : format}`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      showToast('success', t('download') || 'Download');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('exportFailed'));
    }
  }, [showToast, t, thread.id]);

  // Drag & drop for file attachment
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
            <span>⌘</span>
            <span>K</span>
          </kbd>
        </button>
      )}
      <button type="button" className={iconBtnClass} onClick={() => setShowShareModal(true)} title={t('shareResource')} aria-label={t('shareResource')}>
        <Icons.Link className="w-4 h-4" />
      </button>
      <button type="button" className={iconBtnClass} onClick={() => setShowExportModal(true)} title={t('download')} aria-label={t('download')}>
        <Icons.Download className="w-4 h-4" />
      </button>
    </div>
  ), [t, iconBtnClass, onOpenSearch]);

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
      <ChatHeader
        selectedModel={selectedModel}
        isLoading={isLoading}
        onTierChange={handleTierChange}
        actions={headerActions}
      />

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
            messages={messages}
            streaming={streaming}
            isLoading={isLoading}
            sessionDiff={sessionDiff}
            onMerge={handleMerge}
            isMerging={isMerging}
            onDismissDiff={dismissSessionDiff}
            emptyText={t('startConversation')}
            messagesEndRef={messagesEndRef}
            spaceId={spaceId}
          />
          {error && <ChatErrorBanner error={error} onDismiss={() => setError(null)} />}
          <ChatInputBar
            input={input}
            onInputChange={setInput}
            attachedFiles={attachedFiles}
            onFileSelect={handleFileSelect}
            onRemoveFile={removeAttachedFile}
            onSend={sendMessage}
            isLoading={isLoading}
            isCancelling={isCancelling}
            onCancel={handleCancel}
            attachLabel={t('attachFile')}
            placeholder={t('messageInputPlaceholder')}
            inputHint={t('inputHint')}
            onFilePaste={addFiles}
            isDragOver={isDragOver}
          />
        </div>
      </div>

      <Modal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        title={t('shareResource')}
        size="lg"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('shareMode')}</div>
              <select
                value={shareMode}
                onChange={(e) => setShareMode(e.target.value === 'password' ? 'password' : 'public')}
                className="w-full min-h-[44px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
              >
                <option value="public">{t('sharePublic')}</option>
                <option value="password">{t('sharePasswordLabel')}</option>
              </select>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('shareExpiresDays')}</div>
              <Input
                value={shareExpiresInDays}
                onChange={(e) => setShareExpiresInDays(e.target.value)}
                placeholder="e.g. 7"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t('sharePasswordLabel')}</div>
              <Input
                type="password"
                value={sharePassword}
                onChange={(e) => setSharePassword(e.target.value)}
                placeholder={shareMode === 'password' ? 'min 8 chars' : '(optional)'}
                disabled={shareMode !== 'password'}
              />
            </div>
          </div>

          {shareError && (
            <div className="text-sm text-red-600 dark:text-red-400">
              {shareError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              onClick={fetchShares}
              disabled={sharesLoading}
              leftIcon={<Icons.Refresh className={'w-4 h-4 ' + (sharesLoading ? 'animate-spin' : '')} />}
            >
              {t('refresh')}
            </Button>
            <Button
              variant="primary"
              onClick={createShare}
              disabled={creatingShare || (shareMode === 'password' && sharePassword.trim().length < 8)}
              isLoading={creatingShare}
              leftIcon={<Icons.Link className="w-4 h-4" />}
            >
              {t('create')}
            </Button>
          </div>

          <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('shareLinks')}</h3>
              {sharesLoading && (
                <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                  <Icons.Loader className="w-4 h-4 animate-spin" />
                  {t('loading')}
                </span>
              )}
            </div>

            {shares.length === 0 && !sharesLoading ? (
              <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                {t('noShareLinks')}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {shares.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                          {s.share_url}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                          {s.mode}
                        </span>
                        {s.revoked_at && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                            {t('revoked') || 'Revoked'}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {s.expires_at ? t('shareExpiresAt', { date: s.expires_at }) : t('shareNoExpiry')}
                        {s.last_accessed_at ? ` · ${t('shareLastAccessed', { date: s.last_accessed_at })}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="min-w-[44px] min-h-[44px] px-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 flex items-center justify-center"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(s.share_url);
                            showToast('success', t('copied') || 'Copied');
                          } catch {
                            showToast('error', t('failedToCopy'));
                          }
                        }}
                        disabled={!!s.revoked_at}
                        title={t('copy')}
                      >
                        <Icons.Copy className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        className="min-w-[44px] min-h-[44px] px-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-zinc-500 dark:text-zinc-400 hover:text-red-700 dark:hover:text-red-300 flex items-center justify-center"
                        onClick={() => revokeShare(s.id)}
                        disabled={!!s.revoked_at}
                        title={t('revoke') || 'Revoke'}
                      >
                        <Icons.Trash className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        title={t('download')}
        size="md"
      >
        <div className="space-y-3">
          <Button variant="secondary" onClick={() => downloadExport('markdown')} leftIcon={<Icons.Download className="w-4 h-4" />}>
            Markdown
          </Button>
          <Button variant="secondary" onClick={() => downloadExport('json')} leftIcon={<Icons.Download className="w-4 h-4" />}>
            JSON
          </Button>
          <Button variant="secondary" onClick={() => downloadExport('pdf')} leftIcon={<Icons.Download className="w-4 h-4" />}>
            PDF
          </Button>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            {t('download')}
          </div>
        </div>
      </Modal>
    </div>
  );
}
