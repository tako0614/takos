import { Icons } from '../../lib/Icons';
import type { SearchOrder, SearchSort, SourceRepo } from '../../types/repos';
import { RepoBrowseCard } from './RepoBrowseCard';

function SearchRepoList({
  searching,
  results,
  hasMore,
  onSelectRepo,
  onStar,
  onLoadMore,
}: {
  searching: boolean;
  results: SourceRepo[];
  hasMore?: boolean;
  onSelectRepo: (repo: SourceRepo) => void;
  onStar: (repo: SourceRepo) => void;
  onLoadMore?: () => void;
}) {
  if (searching) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
      </div>
    );
  }
  if (!results || results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
        <Icons.Search className="w-12 h-12 mb-3" />
        <p>No repositories found</p>
      </div>
    );
  }
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {results.map((repo) => (
          <RepoBrowseCard key={repo.id} repo={repo} showOwner onSelect={onSelectRepo} onStar={onStar} />
        ))}
      </div>
      {hasMore && onLoadMore && (
        <div className="flex justify-center mt-6">
          <button
            className="flex items-center gap-2 px-5 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={onLoadMore}
          >
            <Icons.ChevronDown className="w-4 h-4" />
            Load more
          </button>
        </div>
      )}
    </>
  );
}

interface RepoSearchResultsProps {
  query: string;
  searching: boolean;
  results: SourceRepo[];
  total?: number;
  sort?: SearchSort;
  order?: SearchOrder;
  hasMore?: boolean;
  onSortChange?: (sort: SearchSort) => void;
  onOrderChange?: (order: SearchOrder) => void;
  onLoadMore?: () => void;
  onSelectRepo: (repo: SourceRepo) => void;
  onStar: (repo: SourceRepo) => void;
}

export function RepoSearchResults({
  query,
  searching,
  results,
  total,
  sort,
  order,
  hasMore,
  onSortChange,
  onOrderChange,
  onLoadMore,
  onSelectRepo,
  onStar,
}: RepoSearchResultsProps) {
  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center gap-3 mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        <h3 className="mr-auto">
          {searching ? 'Searching...' : `${total ?? results?.length ?? 0} results for "${query}"`}
        </h3>
        {onSortChange && onOrderChange && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Sort</label>
            <select
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SearchSort)}
              className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-900 dark:text-zinc-100"
            >
              <option value="stars">Stars</option>
              <option value="updated">Recently updated</option>
              <option value="created">Newest</option>
            </select>
            <select
              value={order}
              onChange={(e) => onOrderChange(e.target.value as SearchOrder)}
              className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-900 dark:text-zinc-100"
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </div>
        )}
      </div>
      <SearchRepoList
        searching={searching}
        results={results}
        hasMore={hasMore}
        onSelectRepo={onSelectRepo}
        onStar={onStar}
        onLoadMore={onLoadMore}
      />
    </div>
  );
}
