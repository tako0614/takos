import { Icons } from '../../lib/Icons';
import type { SourceRepo } from '../../types/repos';

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

export function RepoBrowseCard({ repo, showOwner = false, onSelect, onStar }: RepoBrowseCardProps) {
  const ownerUsername = repo.owner?.username?.trim() || null;
  const ownerName = repo.owner?.name || 'unknown';
  const ownerLabel = ownerUsername ? `@${ownerUsername}` : ownerName;
  const ownerInitial = (ownerUsername || ownerName || '?').charAt(0).toUpperCase();

  return (
    <div
      className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all cursor-pointer"
      onClick={() => onSelect(repo)}
    >
      {showOwner && repo.owner && (
        <div className="flex items-center gap-2 mb-2 text-sm text-zinc-500 dark:text-zinc-400">
          {repo.owner.avatar_url ? (
            <img src={repo.owner.avatar_url} alt="" className="w-4 h-4 rounded-full" />
          ) : (
            <div className="w-4 h-4 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-xs">
              {ownerInitial}
            </div>
          )}
          <span>{ownerLabel}</span>
        </div>
      )}
      <div className="flex items-center gap-2 mb-2">
        <Icons.GitBranch className="w-5 h-5 text-zinc-900 dark:text-zinc-100" />
        <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">{repo.name}</span>
        <span
          className={`ml-auto px-2 py-0.5 text-xs rounded-full flex-shrink-0 ${
            repo.visibility === 'public'
              ? 'bg-zinc-200 dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
          }`}
        >
          {repo.visibility === 'public' ? <Icons.Globe /> : <Icons.Lock />}
        </span>
      </div>
      {repo.description && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3 line-clamp-2">{repo.description}</p>
      )}
      <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <button
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
            repo.is_starred ? 'text-zinc-900 dark:text-zinc-100' : 'hover:text-zinc-900 dark:hover:text-zinc-100'
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onStar(repo);
          }}
        >
          <Icons.Star />
          {getRepoStars(repo)}
        </button>
        <span className="flex items-center gap-1">
          <Icons.GitMerge />
          {getRepoForks(repo)}
        </span>
        <span className="ml-auto">{formatRepoDate(repo.updated_at)}</span>
      </div>
    </div>
  );
}
