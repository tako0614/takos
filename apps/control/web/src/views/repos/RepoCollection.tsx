import { Icons } from '../../lib/Icons';
import type { SourceRepo } from '../../types/repos';
import { RepoBrowseCard } from './RepoBrowseCard';

function ReposMainContent({
  selectedSpaceId,
  myRepos,
  myReposLoading,
  myReposError,
  onSelectRepo,
  onStar,
  onOpenCreate,
}: {
  selectedSpaceId?: string;
  myRepos: SourceRepo[];
  myReposLoading: boolean;
  myReposError: string | null;
  onSelectRepo: (repo: SourceRepo) => void;
  onStar: (repo: SourceRepo) => void;
  onOpenCreate: () => void;
}) {
  if (!selectedSpaceId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
        <Icons.Folder className="w-12 h-12 mb-3" />
        <p>Select a space</p>
      </div>
    );
  }
  if (myReposLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
      </div>
    );
  }
  if (myReposError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-700 dark:text-zinc-300">
        <Icons.AlertTriangle className="w-12 h-12 mb-3" />
        <span>{myReposError}</span>
      </div>
    );
  }
  if (!myRepos || myRepos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
        <Icons.GitBranch className="w-12 h-12 mb-3" />
        <p className="mb-4">No repositories yet</p>
        <button
          className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors"
          onClick={onOpenCreate}
        >
          <Icons.Plus className="w-4 h-4" />
          Create Repository
        </button>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {myRepos.map((repo) => (
        <RepoBrowseCard key={repo.id} repo={repo} onSelect={onSelectRepo} onStar={onStar} />
      ))}
    </div>
  );
}

interface RepoCollectionProps {
  selectedSpaceId?: string;
  myRepos: SourceRepo[];
  myReposLoading: boolean;
  myReposError: string | null;
  onSelectRepo: (repo: SourceRepo) => void;
  onStar: (repo: SourceRepo) => void;
  onOpenCreate: () => void;
}

export function RepoCollection({
  selectedSpaceId,
  myRepos,
  myReposLoading,
  myReposError,
  onSelectRepo,
  onStar,
  onOpenCreate,
}: RepoCollectionProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <ReposMainContent
        selectedSpaceId={selectedSpaceId}
        myRepos={myRepos}
        myReposLoading={myReposLoading}
        myReposError={myReposError}
        onSelectRepo={onSelectRepo}
        onStar={onStar}
        onOpenCreate={onOpenCreate}
      />
    </div>
  );
}
