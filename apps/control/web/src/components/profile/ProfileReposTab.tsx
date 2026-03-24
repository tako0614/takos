import { Icons } from '../../lib/Icons';
import { useI18n } from '../../providers/I18nProvider';
import { EmptyState } from '../common/EmptyState';
import { RepoSummaryCard } from '../../views/shared/repos/RepoSummaryCard';
import type { ProfileRepo } from '../../types/profile';
import { formatDate } from '../../lib/format';

interface ProfileReposTabProps {
  repos: ProfileRepo[];
  onSelectRepo?: (repoName: string) => void;
  onStarToggle: (repo: ProfileRepo) => void;
  starringRepo: string | null;
}

export function ProfileReposTab({
  repos,
  onSelectRepo,
  onStarToggle,
  starringRepo,
}: ProfileReposTabProps) {
  const { t } = useI18n();

  if (repos.length === 0) {
    return (
      <EmptyState
        icon={<Icons.Folder className="w-12 h-12 mb-4" />}
        title={t('noPublicReposYet')}
      />
    );
  }

  return (
    <div className="grid gap-4">
      {repos.map((repo) => (
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
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
                repo.visibility === 'public'
                  ? 'bg-zinc-100 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
              }`}
            >
              {repo.visibility === 'public' ? (
                <Icons.Globe className="w-3 h-3" />
              ) : (
                <Icons.Eye className="w-3 h-3" />
              )}
              {repo.visibility}
            </span>
          }
          footer={
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Updated {formatDate(repo.updated_at)}</span>
          }
        />
      ))}
    </div>
  );
}
