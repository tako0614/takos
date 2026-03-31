import type { JSX } from 'solid-js';
import { Icons } from '../../../lib/Icons.tsx';
import { formatNumber } from '../../../lib/format.ts';

interface RepoSummaryCardProps {
  id: string;
  name: string;
  description: string | null;
  stars: number;
  forks: number;
  is_starred: boolean;
  onSelect?: () => void;
  onStarToggle: () => void;
  starringDisabled: boolean;
  /** Rendered in top-right corner (e.g. visibility badge or starred-at date) */
  badge?: JSX.Element;
  /** Rendered in bottom-right corner (e.g. "Updated 3 days ago") */
  footer?: JSX.Element;
}

export function RepoSummaryCard({
  name,
  description,
  stars,
  forks,
  is_starred,
  onSelect,
  onStarToggle,
  starringDisabled,
  badge,
  footer,
}: RepoSummaryCardProps) {
  return (
    <div
      class="p-4 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 cursor-pointer transition-colors"
      onClick={() => onSelect?.()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onSelect?.();
        }
      }}
    >
      <div class="flex items-start justify-between gap-4">
        <h3 class="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-medium hover:underline">
          <Icons.Folder class="w-4 h-4" />
          {name}
        </h3>
        {badge}
      </div>
      {description && (
        <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400 line-clamp-2">{description}</p>
      )}
      <div class="flex items-center justify-between mt-4">
        <div class="flex items-center gap-4">
          <button
            class={`flex items-center gap-1 text-xs transition-colors ${
              is_starred ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100'
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onStarToggle();
            }}
            disabled={starringDisabled}
            aria-label={is_starred ? `Unstar ${name}` : `Star ${name}`}
            aria-pressed={is_starred}
          >
            <Icons.Star class="w-4 h-4" />
            <span>{formatNumber(stars)}</span>
          </button>
          <span class="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <Icons.GitMerge class="w-4 h-4" />
            <span>{formatNumber(forks)}</span>
          </span>
        </div>
        {footer}
      </div>
    </div>
  );
}
