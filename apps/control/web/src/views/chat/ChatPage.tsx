import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChatView } from '../ChatView';
import { ChatHeader } from './ChatHeader';
import { ModelSwitcher } from './ModelSwitcher';
import { ChatSearchModal } from './ChatSearchModal';
import { useI18n } from '../../store/i18n';
import { useToast } from '../../store/toast';
import { useMobileHeader } from '../../store/mobile-header';
import { rpc, rpcJson } from '../../lib/rpc';
import { DEFAULT_MODEL_ID } from '../../lib/modelCatalog';
import { getPersonalSpace, getSpaceIdentifier, findSpaceByIdentifier } from '../../lib/spaces';
import type { Thread, Space } from '../../types';
import { WelcomeView } from '../app/space/WelcomeView';

interface ChatPageProps {
  spaces: Space[];
  initialSpaceId?: string;
  initialThreadId?: string;
  initialRunId?: string;
  initialMessageId?: string;
  onSpaceChange?: (spaceId: string) => void;
  onThreadChange?: (threadId: string | undefined) => void;
  onUpdateThread?: (threadId: string, updates: Partial<Thread>) => void;
  onNewThreadCreated?: (spaceId: string, thread: Thread) => void;
}

export function ChatPage({
  spaces,
  initialSpaceId,
  initialThreadId,
  initialRunId,
  initialMessageId,
  onSpaceChange,
  onThreadChange,
  onUpdateThread,
  onNewThreadCreated,
}: ChatPageProps) {
  const { t, lang } = useI18n();
  const { showToast } = useToast();
  const { setHeaderContent } = useMobileHeader();

  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(
    initialSpaceId || null
  );

  // Model state for WelcomeView header
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_ID);

  const selectedSpace = useMemo(() => {
    if (selectedSpaceId) {
      return findSpaceByIdentifier(spaces, selectedSpaceId, t('personal'));
    }
    return null;
  }, [spaces, selectedSpaceId, t]);

  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(initialMessageId ?? null);
  const [jumpToMessageSequence, setJumpToMessageSequence] = useState<number | null>(null);
  const [focusRunId, setFocusRunId] = useState<string | null>(initialRunId ?? null);

  useEffect(() => {
    if (spaces.length > 0 && !selectedSpaceId) {
      const ws = getPersonalSpace(spaces, t('personal')) || spaces[0];
      const identifier = getSpaceIdentifier(ws);
      setSelectedSpaceId(identifier);
      onSpaceChange?.(identifier);
    }
  }, [spaces, selectedSpaceId, t, onSpaceChange]);

  useEffect(() => {
    if (!selectedSpaceId) return;
    let cancelled = false;
    const fetchModel = async () => {
      try {
        const res = await rpc.spaces[':spaceId'].model.$get({
          param: { spaceId: selectedSpaceId },
        });
        const data = await rpcJson<{ ai_model?: string; model?: string }>(res);
        if (cancelled) return;
        const model = data.ai_model || data.model || DEFAULT_MODEL_ID;
        setSelectedModel(model);
      } catch {
        // keep default
      }
    };
    fetchModel();
    return () => { cancelled = true; };
  }, [selectedSpaceId]);

  // WelcomeView表示時のみモバイルヘッダーにモデル切り替えを注入（スレッドがあるときはChatViewが担当）
  useEffect(() => {
    if (selectedThread) return;
    setHeaderContent(
      <ModelSwitcher
        selectedModel={selectedModel}
        isLoading={false}
        onModelChange={async (model) => {
          setSelectedModel(model);
          if (selectedSpaceId) {
            try {
              const res = await rpc.spaces[':spaceId'].model.$patch({
                param: { spaceId: selectedSpaceId },
                json: { model } as Record<string, string>,
              });
              await rpcJson(res);
            } catch {
              // non-fatal
            }
          }
        }}
      />
    );
    return () => setHeaderContent(null);
  }, [selectedThread, selectedModel, selectedSpaceId, setHeaderContent]);

  useEffect(() => {
    if (initialThreadId) {
      // Try to find thread from a fresh fetch if needed
      const fetchThread = async () => {
        try {
          const res = await rpc.threads[':id'].$get({ param: { id: initialThreadId } });
          const data = await rpcJson<{ thread: Thread }>(res);
          setSelectedThread(data.thread);
        } catch {
          setSelectedThread(null);
        }
      };
      fetchThread();
    } else {
      setSelectedThread(null);
    }
  }, [initialThreadId]);

  useEffect(() => {
    setFocusRunId(initialRunId ?? null);
  }, [initialRunId]);

  useEffect(() => {
    setJumpToMessageId(initialMessageId ?? null);
  }, [initialMessageId]);

  const openSearchResult = useCallback(async (threadId: string, messageId: string, sequence: number) => {
    try {
      const res = await rpc.threads[':id'].$get({ param: { id: threadId } });
      const data = await rpcJson<{ thread: Thread }>(res);
      const thread = data.thread;
      setSelectedThread(thread);
      onThreadChange?.(thread.id);
      setJumpToMessageId(messageId);
      setJumpToMessageSequence(sequence);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToLoad'));
    }
  }, [onThreadChange, showToast, t]);

  // Called by WelcomeView when user sends a message
  const handleCreateThread = useCallback(async (message: string, files?: File[]) => {
    if (!selectedSpaceId) return;
    try {
      const res = await rpc.spaces[':spaceId'].threads.$post({
        param: { spaceId: selectedSpaceId },
        json: { title: message.slice(0, 60), locale: lang },
      });
      const data = await rpcJson<{ thread: Thread }>(res);
      const thread = data.thread;
      onNewThreadCreated?.(selectedSpaceId, thread);
      setSelectedThread(thread);
      setPendingMessage(message);
      setPendingFiles(files ?? null);
      onThreadChange?.(thread.id);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToCreate'));
    }
  }, [lang, selectedSpaceId, onNewThreadCreated, onThreadChange, showToast, t]);

  return (
    <div className="flex flex-1 h-full bg-white dark:bg-zinc-900">
      <main className="flex-1 flex flex-col min-w-0 h-full">
        {selectedThread && selectedSpace ? (
          <ChatView
            thread={selectedThread}
            spaceId={getSpaceIdentifier(selectedSpace)}
            jumpToMessageId={jumpToMessageId}
            jumpToMessageSequence={jumpToMessageSequence}
            focusRunId={focusRunId}
            onJumpHandled={() => {
              setJumpToMessageId(null);
              setJumpToMessageSequence(null);
            }}
            onRunFocusHandled={() => {
              setFocusRunId(null);
            }}
            onOpenSearch={selectedSpaceId ? () => setShowSearchModal(true) : undefined}
            initialMessage={pendingMessage ?? undefined}
            initialFiles={pendingFiles ?? undefined}
            onInitialMessageSent={() => { setPendingMessage(null); setPendingFiles(null); }}
            onUpdateTitle={(title) => {
              setSelectedThread((prev) => (prev ? { ...prev, title } : prev));
              if (selectedThread) {
                onUpdateThread?.(selectedThread.id, { title });
              }
            }}
          />
        ) : selectedSpace ? (
          <>
            <ChatHeader
              selectedModel={selectedModel}
              isLoading={false}
              onModelChange={async (model) => {
                setSelectedModel(model);
                if (selectedSpaceId) {
                  try {
                    const res = await rpc.spaces[':spaceId'].model.$patch({
                      param: { spaceId: selectedSpaceId },
                      json: { model } as Record<string, string>,
                    });
                    await rpcJson(res);
                  } catch {
                    // non-fatal
                  }
                }
              }}
            />
            <WelcomeView
              space={selectedSpace}
              onNewChat={() => {
                onSpaceChange?.(getSpaceIdentifier(selectedSpace));
              }}
              onCreateThread={handleCreateThread}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
            <p>{t('selectSpaceToChat')}</p>
          </div>
        )}
      </main>

      {showSearchModal && selectedSpaceId && (
        <ChatSearchModal
          spaceId={selectedSpaceId}
          onSelectResult={openSearchResult}
          onClose={() => setShowSearchModal(false)}
        />
      )}
    </div>
  );
}
