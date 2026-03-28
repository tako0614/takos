import { useMemo, type RefObject } from 'react';
import { useI18n } from '../../store/i18n';
import type { Message, SessionDiff } from '../../types';
import { Icons } from '../../lib/Icons';
import type { ChatStreamingState } from './chat-types';
import { MessageBubble } from './MessageBubble';
import { MarkdownRenderer } from './MarkdownRenderer';
import { SessionDiffPanel } from './SessionDiffPanel';

type LiveToolCall = ChatStreamingState['toolCalls'][number];

function getToolLabel(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.includes('search')) return '検索中…';
  if (normalized.includes('fetch') || normalized.includes('browse')) return 'ページ取得中…';
  if (normalized.includes('read')) return 'ファイル読み込み中…';
  if (normalized.includes('write')) return 'ファイル書き込み中…';
  if (normalized.includes('list')) return 'ファイル一覧取得中…';
  if (normalized.includes('exec')) return 'コマンド実行中…';
  if (normalized.includes('deploy')) return 'デプロイ中…';
  if (normalized.includes('memory') || normalized.includes('remember') || normalized.includes('recall')) return 'メモリ操作中…';
  return `${name}`;
}

function LiveToolCalls({
  toolCalls,
  thinking,
}: {
  toolCalls: LiveToolCall[];
  thinking: string | null;
}) {
  return (
    <div className="py-2 px-4">
      {thinking && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 italic mb-2 animate-pulse">
          {thinking}
        </p>
      )}
      <div className="space-y-0.5">
        {toolCalls.map((tc) => {
          const isRunning = tc.status === 'running' || tc.status === 'pending';
          const isError = tc.status === 'error';
          return (
            <div key={tc.id} className="flex items-center gap-2 text-sm">
              <span className={`text-xs ${isError ? 'text-red-500' : isRunning ? 'text-zinc-400 dark:text-zinc-500' : 'text-green-500'}`}>
                {isError ? '✕' : isRunning ? '●' : '✓'}
              </span>
              <span
                className={
                  isRunning
                    ? 'text-zinc-600 dark:text-zinc-400 animate-pulse'
                    : isError
                      ? 'text-red-500 dark:text-red-400'
                      : 'text-zinc-400 dark:text-zinc-500'
                }
              >
                {isRunning ? getToolLabel(tc.name) : tc.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ChatMessageFeedProps {
  messages: Message[];
  streaming: ChatStreamingState;
  isLoading: boolean;
  sessionDiff: { sessionId: string; diff: SessionDiff } | null;
  onMerge: () => void;
  isMerging: boolean;
  onDismissDiff: () => void;
  emptyText: string;
  messagesEndRef: RefObject<HTMLDivElement>;
  spaceId?: string;
}

export function ChatMessageFeed({
  messages,
  streaming,
  isLoading,
  sessionDiff,
  onMerge,
  isMerging,
  onDismissDiff,
  emptyText,
  messagesEndRef,
  spaceId,
}: ChatMessageFeedProps) {
  const { t } = useI18n();

  const uniqueMessages = useMemo(() => {
    const messageMap = new Map<string, Message>();
    for (const message of messages) {
      messageMap.set(message.id, message);
    }
    return Array.from(messageMap.values());
  }, [messages]);

  const lastAssistantMessage = useMemo(() => {
    for (let i = uniqueMessages.length - 1; i >= 0; i -= 1) {
      const message = uniqueMessages[i];
      if (message.role === 'assistant' && message.content) {
        return message;
      }
    }
    return null;
  }, [uniqueMessages]);

  const showEmpty =
    uniqueMessages.length === 0 &&
    !isLoading &&
    !streaming.currentMessage &&
    !sessionDiff;

  const hasToolCalls = streaming.toolCalls.length > 0;

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="w-full max-w-3xl mx-auto flex-1 flex flex-col">
        {showEmpty && (
          <div className="flex flex-1 flex-col items-center justify-center text-zinc-500 dark:text-zinc-400">
            <span className="w-8 h-8 [&>svg]:w-full [&>svg]:h-full">
              <Icons.MessageSquare />
            </span>
            <p className="mt-2">{emptyText}</p>
          </div>
        )}

        {uniqueMessages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            showToolExecutions
            spaceId={spaceId}
          />
        ))}

        {hasToolCalls && (
          <LiveToolCalls
            toolCalls={streaming.toolCalls}
            thinking={streaming.thinking}
          />
        )}

        {!hasToolCalls && !streaming.currentMessage && streaming.thinking && (
          <div className="py-2 px-4">
            <p className={`text-sm text-zinc-500 dark:text-zinc-400 italic${isLoading ? ' animate-pulse' : ''}`}>
              {streaming.thinking}
            </p>
          </div>
        )}

        {isLoading && !hasToolCalls && !streaming.thinking && (
          <div className="py-2 px-4">
            <p className="text-sm text-zinc-500 dark:text-zinc-400 italic animate-pulse">
              {t('thinking')}
            </p>
          </div>
        )}

        {streaming.currentMessage && streaming.currentMessage !== lastAssistantMessage?.content && (
          <div className="py-3 px-4">
            <div className="prose dark:prose-invert max-w-none text-zinc-900 dark:text-zinc-100">
              <MarkdownRenderer content={streaming.currentMessage} />
            </div>
          </div>
        )}

        {sessionDiff && (
          <SessionDiffPanel
            sessionDiff={sessionDiff}
            onMerge={onMerge}
            isMerging={isMerging}
            onDismiss={onDismissDiff}
          />
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
