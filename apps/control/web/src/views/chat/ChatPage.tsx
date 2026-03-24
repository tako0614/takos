import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChatView } from '../ChatView';
import { ChatHeader } from './ChatHeader';
import { ModelSwitcher } from './ModelSwitcher';
import { ChatSearchModal } from './ChatSearchModal';
import { useI18n } from '../../providers/I18nProvider';
import { useToast } from '../../hooks/useToast';
import { useMobileHeader } from '../../contexts/MobileHeaderContext';
import { rpc, rpcJson } from '../../lib/rpc';
import { DEFAULT_MODEL_ID, getTierFromModel } from '../../lib/modelCatalog';
import { getPersonalWorkspace, getWorkspaceIdentifier, findWorkspaceByIdentifier } from '../../lib/workspaces';
import type { Thread, UserSettings, Workspace } from '../../types';
import { WelcomeView } from '../app/workspace/WelcomeView';

interface ChatPageProps {
  workspaces: Workspace[];
  userSettings: UserSettings | null;
  initialWorkspaceId?: string;
  initialThreadId?: string;
  initialRunId?: string;
  initialMessageId?: string;
  onWorkspaceChange?: (spaceId: string) => void;
  onThreadChange?: (threadId: string | undefined) => void;
  onUpdateThread?: (threadId: string, updates: Partial<Thread>) => void;
  onNewThreadCreated?: (spaceId: string, thread: Thread) => void;
}

export function ChatPage({
  workspaces,
  userSettings,
  initialWorkspaceId,
  initialThreadId,
  initialRunId,
  initialMessageId,
  onWorkspaceChange,
  onThreadChange,
  onUpdateThread,
  onNewThreadCreated,
}: ChatPageProps) {
  const { t, lang } = useI18n();
  const { showToast } = useToast();
  const { setHeaderContent } = useMobileHeader();

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    initialWorkspaceId || null
  );

  // Model state for WelcomeView header
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_MODEL_ID);

  const selectedWorkspace = useMemo(() => {
    if (selectedWorkspaceId) {
      return findWorkspaceByIdentifier(workspaces, selectedWorkspaceId, t('personal'));
    }
    return null;
  }, [workspaces, selectedWorkspaceId, t]);

  const [selectedThread, setSelectedThread] = useState<Thread | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(initialMessageId ?? null);
  const [jumpToMessageSequence, setJumpToMessageSequence] = useState<number | null>(null);
  const [focusRunId, setFocusRunId] = useState<string | null>(initialRunId ?? null);

  useEffect(() => {
    if (workspaces.length > 0 && !selectedWorkspaceId) {
      const ws = getPersonalWorkspace(workspaces, t('personal')) || workspaces[0];
      const identifier = getWorkspaceIdentifier(ws);
      setSelectedWorkspaceId(identifier);
      onWorkspaceChange?.(identifier);
    }
  }, [workspaces, selectedWorkspaceId, t, onWorkspaceChange]);

  useEffect(() => {
    if (!selectedWorkspaceId) return;
    let cancelled = false;
    const fetchModel = async () => {
      try {
        const res = await rpc.spaces[':spaceId'].model.$get({
          param: { spaceId: selectedWorkspaceId },
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
  }, [selectedWorkspaceId]);

  // WelcomeView表示時のみモバイルヘッダーにモデル切り替えを注入（スレッドがあるときはChatViewが担当）
  useEffect(() => {
    if (selectedThread) return;
    setHeaderContent(
      <ModelSwitcher
        selectedModel={selectedModel}
        isLoading={false}
        onTierChange={async (model) => {
          setSelectedModel(model);
          if (selectedWorkspaceId) {
            try {
              const res = await rpc.spaces[':spaceId'].model.$patch({
                param: { spaceId: selectedWorkspaceId },
                json: { tier: getTierFromModel(model) } as Record<string, string>,
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
  }, [selectedThread, selectedModel, selectedWorkspaceId, setHeaderContent]);

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
    if (!selectedWorkspaceId) return;
    try {
      const res = await rpc.spaces[':spaceId'].threads.$post({
        param: { spaceId: selectedWorkspaceId },
        json: { title: message.slice(0, 60), locale: lang },
      });
      const data = await rpcJson<{ thread: Thread }>(res);
      const thread = data.thread;
      onNewThreadCreated?.(selectedWorkspaceId, thread);
      setSelectedThread(thread);
      setPendingMessage(message);
      setPendingFiles(files ?? null);
      onThreadChange?.(thread.id);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToCreate'));
    }
  }, [lang, selectedWorkspaceId, onNewThreadCreated, onThreadChange, showToast, t]);

  return (
    <div className="flex flex-1 h-full bg-white dark:bg-zinc-900">
      <main className="flex-1 flex flex-col min-w-0 h-full">
        {selectedThread && selectedWorkspace ? (
          <ChatView
            thread={selectedThread}
            spaceId={getWorkspaceIdentifier(selectedWorkspace)}
            userSettings={userSettings}
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
            onOpenSearch={selectedWorkspaceId ? () => setShowSearchModal(true) : undefined}
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
        ) : selectedWorkspace ? (
          <>
            <ChatHeader
              selectedModel={selectedModel}
              isLoading={false}
              onTierChange={async (model) => {
                setSelectedModel(model);
                if (selectedWorkspaceId) {
                  try {
                    const res = await rpc.spaces[':spaceId'].model.$patch({
                      param: { spaceId: selectedWorkspaceId },
                      json: { tier: getTierFromModel(model) } as Record<string, string>,
                    });
                    await rpcJson(res);
                  } catch {
                    // non-fatal
                  }
                }
              }}
            />
            <WelcomeView
              workspace={selectedWorkspace}
              onNewChat={() => {
                onWorkspaceChange?.(getWorkspaceIdentifier(selectedWorkspace));
              }}
              onCreateThread={handleCreateThread}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
            <p>{t('selectWorkspaceToChat')}</p>
          </div>
        )}
      </main>

      {showSearchModal && selectedWorkspaceId && (
        <ChatSearchModal
          spaceId={selectedWorkspaceId}
          onSelectResult={openSearchResult}
          onClose={() => setShowSearchModal(false)}
        />
      )}
    </div>
  );
}
