import { Show } from 'solid-js';
import { Icons } from '../../../lib/Icons.tsx';
import type { PullRequest } from '../../../types/index.ts';
import { useI18n } from '../../../store/i18n.ts';

interface PRHeaderProps {
  pr: PullRequest;
  diffsCount: number;
  totalAdditions: number;
  totalDeletions: number;
  onBack: () => void;
}

function renderAvatar(author: { name: string; avatar_url?: string }) {
  if (author.avatar_url) {
    return <img src={author.avatar_url} alt={author.name} class="w-5 h-5 rounded-full" />;
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

export function PRHeader(props: PRHeaderProps) {
  const { t } = useI18n();

  return (
    <>
      <div class="border-b px-6 py-4" style={{ "border-color": 'var(--color-border-primary)', "background-color": 'var(--color-surface-primary)' }}>
        <div class="flex items-center gap-4">
          <button
            class="p-2 rounded-lg text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            onClick={props.onBack}
          >
            <Icons.ArrowLeft />
          </button>
          <div class="flex items-center gap-3 flex-1">
            <h1 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              <span>{props.pr.title}</span>
              <span class="ml-2 text-zinc-500 dark:text-zinc-400 font-normal">#{props.pr.number}</span>
            </h1>
            <div class={getStatusBadgeClasses(props.pr.status)}>
              {getStatusIcon(props.pr.status)}
              <span>{props.pr.status}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="border-b px-6 py-3" style={{ "border-color": 'var(--color-border-primary)', "background-color": 'var(--color-surface-primary)' }}>
        <div class="flex items-center gap-4 text-sm text-zinc-500 flex-wrap">
          <span class="flex items-center gap-2">
            {renderAvatar(props.pr.author)}
            <span class="text-zinc-900 dark:text-zinc-100">{props.pr.author.name}</span>
          </span>
          <span>{t('wantsToMerge')}</span>
          <code class="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-mono border border-zinc-200 dark:border-zinc-700">{props.pr.source_branch}</code>
          <span>{t('intoLabel')}</span>
          <code class="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-mono border border-zinc-200 dark:border-zinc-700">{props.pr.target_branch}</code>
        </div>
        <div class="flex items-center gap-4 mt-2 text-xs text-zinc-500">
          <span>{t('prCommitsCount', { count: props.pr.commits_count })}</span>
          <span>{t('prFilesChanged', { count: props.diffsCount })}</span>
          <span class="text-zinc-900 dark:text-zinc-100 font-medium">+{props.totalAdditions}</span>
          <span class="text-zinc-500 dark:text-zinc-400 font-medium">-{props.totalDeletions}</span>
        </div>
      </div>
    </>
  );
}
