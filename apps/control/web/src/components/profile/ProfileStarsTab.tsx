import { For, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { EmptyState } from "../common/EmptyState.tsx";
import { RepoSummaryCard } from "../../views/shared/repos/RepoSummaryCard.tsx";
import type { StarredRepo } from "../../types/profile.ts";
import { formatDate } from "../../lib/format.ts";

interface ProfileStarsTabProps {
  starredRepos: StarredRepo[];
  onSelectRepo?: (repoName: string) => void;
  onStarToggle: (repo: StarredRepo) => void;
  starringRepo: string | null;
}

export function ProfileStarsTab(props: ProfileStarsTabProps) {
  const { t } = useI18n();

  return (
    <Show
      when={props.starredRepos.length > 0}
      fallback={
        <EmptyState
          icon={<Icons.Star class="w-12 h-12 mb-4" />}
          title={t("noStarredReposYet")}
        />
      }
    >
      <div class="grid gap-4">
        <For each={props.starredRepos}>
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
                <span class="text-xs text-zinc-500 dark:text-zinc-400">
                  Starred {formatDate(repo.starred_at)}
                </span>
              }
            />
          )}
        </For>
      </div>
    </Show>
  );
}
