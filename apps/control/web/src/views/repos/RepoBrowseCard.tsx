import { Show } from 'solid-js';
import { Icons } from '../../lib/Icons.tsx';
import type { SourceRepo } from '../../types/repos.ts';

const formatRepoDate = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
};

const getRepoStars = (repo: { stars?: number; stars_count?: number }) =>
  repo.stars_count ?? repo.stars ?? 0;

const getRepoForks = (repo: { forks?: number; forks_count?: number }) =>
  repo.forks_count ?? repo.forks ?? 0;

interface RepoBrowseCardProps {
  repo: SourceRepo;
  showOwner?: boolean;
  onSelect: (repo: SourceRepo) => void;
  onStar: (repo: SourceRepo) => void;
}

export function RepoBrowseCard(props: RepoBrowseCardProps) {
  const ownerUsername = () => props.repo.owner?.username?.trim() || null;
  const ownerName = () => props.repo.owner?.name || 'unknown';
  const ownerLabel = () => ownerUsername() ? `@${ownerUsername()}` : ownerName();
  const ownerInitial = () => (ownerUsername() || ownerName() || '?').charAt(0).toUpperCase();

  return (
    <div
      class="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all cursor-pointer"
      onClick={() => props.onSelect(props.repo)}
    >
      <Show when={props.showOwner && props.repo.owner}>
        <div class="flex items-center gap-2 mb-2 text-sm text-zinc-500 dark:text-zinc-400">
          {props.repo.owner?.avatar_url ? (
            <img src={props.repo.owner.avatar_url} alt="" class="w-4 h-4 rounded-full" />
          ) : (
            <div class="w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-xs">
              {ownerInitial()}
            </div>
          )}
          <span>{ownerLabel()}</span>
        </div>
      </Show>
      <div class="flex items-center gap-2 mb-2">
        <Icons.GitBranch class="w-5 h-5 text-zinc-900 dark:text-zinc-100" />
        <span class="font-medium text-zinc-900 dark:text-zinc-100 truncate">{props.repo.name}</span>
        <span
          class={`ml-auto px-2 py-0.5 text-xs rounded-full flex-shrink-0 ${
            props.repo.visibility === 'public'
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
          }`}
        >
          {props.repo.visibility === 'public' ? <Icons.Globe /> : <Icons.Lock />}
        </span>
      </div>
      <Show when={props.repo.description}>
        <p class="text-sm text-zinc-500 dark:text-zinc-400 mb-3 line-clamp-2">{props.repo.description}</p>
      </Show>
      <div class="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <button
          class={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
            props.repo.is_starred ? 'text-zinc-900 dark:text-zinc-100' : 'hover:text-zinc-900 dark:hover:text-zinc-100'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            props.onStar(props.repo);
          }}
        >
          <Icons.Star />
          {getRepoStars(props.repo)}
        </button>
        <span class="flex items-center gap-1">
          <Icons.GitMerge />
          {getRepoForks(props.repo)}
        </span>
        <span class="ml-auto">{formatRepoDate(props.repo.updated_at)}</span>
      </div>
    </div>
  );
}
