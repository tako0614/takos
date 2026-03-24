import { Icons } from '../../lib/Icons';
import { useI18n } from '../../providers/I18nProvider';
import { EmptyState } from '../common/EmptyState';
import { RepoSummaryCard } from '../../views/shared/repos/RepoSummaryCard';
import type { StarredRepo } from '../../types/profile';
import { formatDate } from '../../lib/format';

interface ProfileStarsTabProps {
  starredRepos: StarredRepo[];
  onSelectRepo?: (repoName: string) => void;
  onStarToggle: (repo: StarredRepo) => void;
  starringRepo: string | null;
}

export function ProfileStarsTab({
  starredRepos,
  onSelectRepo,
  onStarToggle,
  starringRepo,
}: ProfileStarsTabProps) {
  const { t } = useI18n();

  if (starredRepos.length === 0) {
    return (
      <EmptyState
        icon={<Icons.Star className="w-12 h-12 mb-4" />}
        title={t('noStarredReposYet')}
      />
    );
  }

  return (
    <div className="grid gap-4">
      {starredRepos.map((repo) => (
        <RepoSummaryCard
          key={repo.id}
          id={repo.id}
          name={repo.name}
          description={repo.description}
          stars={repo.stars}
          forks={repo.forks}
          is_starred={repo.is_starred}
          onSelect={() => onSelectRepo?.(repo.name)}
          onStarToggle={() => onStarToggle(repo)}
          starringDisabled={starringRepo === repo.id}
          badge={
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Starred {formatDate(repo.starred_at)}
            </span>
          }
        />
      ))}
    </div>
  );
}
