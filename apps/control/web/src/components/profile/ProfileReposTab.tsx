import { Show, For } from 'solid-js';
import { Icons } from '../../lib/Icons.tsx';
import { useI18n } from '../../store/i18n.ts';
import { EmptyState } from '../common/EmptyState.tsx';
import { RepoSummaryCard } from '../../views/shared/repos/RepoSummaryCard.tsx';
import type { ProfileRepo } from '../../types/profile.ts';
import { formatDate } from '../../lib/format.ts';

interface ProfileReposTabProps {
  repos: ProfileRepo[];
  onSelectRepo?: (repoName: string) => void;
  onStarToggle: (repo: ProfileRepo) => void;
  starringRepo: string | null;
}

export function ProfileReposTab(props: ProfileReposTabProps) {
  const { t } = useI18n();

  return (
    <Show
      when={props.repos.length > 0}
      fallback={
        <EmptyState
          icon={<Icons.Folder class="w-12 h-12 mb-4" />}
          title={t('noPublicReposYet')}
        />
      }
    >
      <div class="grid gap-4">
        <For each={props.repos}>
          {(repo) => (
            <RepoSummaryCard
              id={repo.id}
              name={repo.name}
              description={repo.description}
              stars={repo.stars}
              forks={repo.forks}
              is_starred={repo.is_starred}
              onSelect={() => props.onSelectRepo?.(repo.name)}
              onStarToggle={() => props.onStarToggle(repo)}
              starringDisabled={props.starringRepo === repo.id}
              badge={
                <span
                  class={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                    repo.visibility === 'public'
                      ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                      : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  <Show when={repo.visibility === 'public'} fallback={<Icons.Eye class="w-3 h-3" />}>
                    <Icons.Globe class="w-3 h-3" />
                  </Show>
                  {repo.visibility}
                </span>
              }
              footer={
                <span class="text-xs text-zinc-500 dark:text-zinc-400">Updated {formatDate(repo.updated_at)}</span>
              }
            />
          )}
        </For>
      </div>
    </Show>
  );
}
