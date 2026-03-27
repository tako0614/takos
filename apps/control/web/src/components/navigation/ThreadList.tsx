import { Icons } from '../../lib/Icons';
import { useI18n } from '../../providers/I18nProvider';
import { useSidebarCallbacks } from './SidebarContext';
import type { Thread } from '../../types';

const THREAD_BASE = 'group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors min-h-[36px] text-sm';
const THREAD_DEFAULT = `${THREAD_BASE} text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60 hover:text-zinc-800 dark:hover:text-zinc-200`;
const THREAD_ACTIVE = `${THREAD_BASE} bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100`;

const ACTION_BTN =
  'w-6 h-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all shrink-0';

interface ThreadListProps {
  threads: Thread[];
  selectedThreadId: string | null;
  emptyMessage?: string;
}

export function ThreadList({ threads, selectedThreadId, emptyMessage }: ThreadListProps) {
  const { t } = useI18n();
  const { onSelectThread, onDeleteThread, onToggleArchiveThread } = useSidebarCallbacks();

  const empty = emptyMessage ?? t('startConversation');

  if (threads.length === 0) {
    return (
      <div className="px-1 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
        {empty}
      </div>
    );
  }

  return (
    <>
      {threads.map((thread) => (
        <div
          key={thread.id}
          className={selectedThreadId === thread.id ? THREAD_ACTIVE : THREAD_DEFAULT}
          onClick={() => onSelectThread(thread)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelectThread(thread);
            }
          }}
        >
          <Icons.MessageSquare className="w-4 h-4 shrink-0 opacity-70" />
          <span className="flex-1 truncate">{thread.title}</span>
          <button
            className={ACTION_BTN}
            onClick={(e) => {
              e.stopPropagation();
              onToggleArchiveThread(thread);
            }}
            aria-label={thread.status === 'archived' ? t('unarchiveThread') : t('archiveThread')}
            title={thread.status === 'archived' ? t('unarchiveThread') : t('archiveThread')}
          >
            {thread.status === 'archived' ? (
              <Icons.Refresh className="w-3 h-3" />
            ) : (
              <Icons.Archive className="w-3 h-3" />
            )}
          </button>
          <button
            className={ACTION_BTN}
            onClick={(e) => {
              e.stopPropagation();
              onDeleteThread(thread.id);
            }}
            aria-label={t('deleteThread')}
            title={t('deleteThread')}
          >
            <Icons.Trash className="w-3 h-3" />
          </button>
        </div>
      ))}
    </>
  );
}
