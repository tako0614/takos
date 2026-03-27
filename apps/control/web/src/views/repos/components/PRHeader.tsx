import { Icons } from '../../../lib/Icons';
import type { PullRequest } from '../../../types';
import { useI18n } from '../../../store/i18n';

interface PRHeaderProps {
  pr: PullRequest;
  diffsCount: number;
  totalAdditions: number;
  totalDeletions: number;
  onBack: () => void;
}

function renderAvatar(author: { name: string; avatar_url?: string }) {
  if (author.avatar_url) {
    return <img src={author.avatar_url} alt={author.name} className="w-5 h-5 rounded-full" />;
  }
  return null;
}

function getStatusIcon(status: PullRequest['status']) {
  switch (status) {
    case 'open':
      return <Icons.GitMerge />;
    case 'merged':
      return <Icons.Check />;
    case 'closed':
      return <Icons.X />;
  }
}

function getStatusBadgeClasses(status: PullRequest['status']) {
  const base = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium capitalize';
  switch (status) {
    case 'open':
      return `${base} bg-zinc-900 text-white`;
    case 'merged':
      return `${base} bg-zinc-700 text-white`;
    case 'closed':
      return `${base} bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-600`;
  }
}

export function PRHeader({ pr, diffsCount, totalAdditions, totalDeletions, onBack }: PRHeaderProps) {
  const { t } = useI18n();

  return (
    <>
      <div className="border-b px-6 py-4" style={{ borderColor: 'var(--color-border-primary)', backgroundColor: 'var(--color-surface-primary)' }}>
        <div className="flex items-center gap-4">
          <button
            className="p-2 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            onClick={onBack}
          >
            <Icons.ArrowLeft />
          </button>
          <div className="flex items-center gap-3 flex-1">
            <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              <span>{pr.title}</span>
              <span className="ml-2 text-zinc-500 dark:text-zinc-400 font-normal">#{pr.number}</span>
            </h1>
            <div className={getStatusBadgeClasses(pr.status)}>
              {getStatusIcon(pr.status)}
              <span>{pr.status}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-b px-6 py-3" style={{ borderColor: 'var(--color-border-primary)', backgroundColor: 'var(--color-surface-primary)' }}>
        <div className="flex items-center gap-4 text-sm text-zinc-500 flex-wrap">
          <span className="flex items-center gap-2">
            {renderAvatar(pr.author)}
            <span className="text-zinc-900 dark:text-zinc-100">{pr.author.name}</span>
          </span>
          <span>{t('wantsToMerge')}</span>
          <code className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-mono border border-zinc-200 dark:border-zinc-700">{pr.source_branch}</code>
          <span>{t('intoLabel')}</span>
          <code className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-mono border border-zinc-200 dark:border-zinc-700">{pr.target_branch}</code>
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
          <span>{t('prCommitsCount', { count: pr.commits_count })}</span>
          <span>{t('prFilesChanged', { count: diffsCount })}</span>
          <span className="text-zinc-900 dark:text-zinc-100 font-medium">+{totalAdditions}</span>
          <span className="text-zinc-500 dark:text-zinc-400 font-medium">-{totalDeletions}</span>
        </div>
      </div>
    </>
  );
}
