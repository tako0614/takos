import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import { CreateRepoModal } from '../shared/repos/CreateRepoModal';

import { RepoCollection } from './RepoCollection';
import { RepoSearchResults } from './RepoSearchResults';
import { useReposData } from '../../hooks/useReposData';

interface ReposPanelProps {
  spaceId: string;
  onNavigateToRepo?: (username: string, repoName: string) => void;
}

export function ReposPanel({
  spaceId,
  onNavigateToRepo,
}: ReposPanelProps) {
  const { t } = useI18n();

  const {
    myRepos,
    myReposLoading,
    myReposError,
    searchQuery,
    setSearchQuery,
    searchResults,
    searching,
    searchSort,
    setSearchSort,
    searchOrder,
    setSearchOrder,
    searchHasMore,
    searchTotal,
    loadMoreSearch,
    showCreateModal,
    setShowCreateModal,
    handleCreateRepo,
    handleStar,
  } = useReposData({ selectedSpaceId: spaceId, initialTab: 'repos' });

  const handleSelectRepo = (repo: { owner?: { username?: string | null } | null; name: string }) => {
    if (repo?.owner?.username && repo.name) {
      onNavigateToRepo?.(repo.owner.username, repo.name);
    }
  };

  return (
    <div className="flex flex-col flex-1 h-full bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="max-w-3xl mx-auto w-full px-4">
            <div className="flex flex-wrap items-center gap-3 pt-8 pb-5">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 min-w-0 shrink-0">
                {t('repositories')}
              </h1>
              <div className="relative flex-1 min-w-[140px]">
                <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder={t('searchRepos')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 h-9 text-sm bg-white dark:bg-zinc-800 border-none rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-zinc-400/20 dark:focus:ring-zinc-600/30 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 transition-all"
                />
              </div>
              <button
                className="flex items-center gap-1.5 px-3 h-9 text-sm font-medium text-white bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 rounded-xl hover:bg-zinc-700 dark:hover:bg-zinc-200 transition-colors shrink-0"
                onClick={() => setShowCreateModal(true)}
              >
                <Icons.Plus className="w-4 h-4" />
                {t('createRepo')}
              </button>
            </div>
            <div className="pb-10">
              {searchQuery.trim() ? (
                <RepoSearchResults
                  query={searchQuery}
                  searching={searching}
                  results={searchResults}
                  total={searchTotal}
                  sort={searchSort}
                  order={searchOrder}
                  hasMore={searchHasMore}
                  onSortChange={setSearchSort}
                  onOrderChange={setSearchOrder}
                  onLoadMore={loadMoreSearch}
                  onSelectRepo={handleSelectRepo}
                  onStar={handleStar}
                />
              ) : (
                <RepoCollection
                  selectedSpaceId={spaceId}
                  myRepos={myRepos}
                  myReposLoading={myReposLoading}
                  myReposError={myReposError}
                  onSelectRepo={handleSelectRepo}
                  onStar={handleStar}
                  onOpenCreate={() => setShowCreateModal(true)}
                />
              )}
            </div>
          </div>
        </div>
      </div>
      {showCreateModal && (
        <CreateRepoModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateRepo}
        />
      )}
    </div>
  );
}
