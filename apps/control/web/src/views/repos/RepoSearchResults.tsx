import { Show, For } from 'solid-js';
import { Icons } from '../../lib/Icons.tsx';
import type { SearchOrder, SearchSort, SourceRepo } from '../../types/repos.ts';
import { RepoBrowseCard } from './RepoBrowseCard.tsx';

function SearchRepoList(props: {
  searching: boolean;
  results: SourceRepo[];
  hasMore?: boolean;
  onSelectRepo: (repo: SourceRepo) => void;
  onStar: (repo: SourceRepo) => void;
  onLoadMore?: () => void;
}) {
  return (
    <>
      <Show when={props.searching}>
        <div class="flex justify-center py-12">
          <div class="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
        </div>
      </Show>
      <Show when={!props.searching && (!props.results || props.results.length === 0)}>
        <div class="flex flex-col items-center justify-center py-12 text-zinc-500">
          <Icons.Search class="w-12 h-12 mb-3" />
          <p>No repositories found</p>
        </div>
      </Show>
      <Show when={!props.searching && props.results && props.results.length > 0}>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <For each={props.results}>{(repo) => (
            <RepoBrowseCard repo={repo} showOwner onSelect={props.onSelectRepo} onStar={props.onStar} />
          )}</For>
        </div>
        <Show when={props.hasMore && props.onLoadMore}>
          <div class="flex justify-center mt-6">
            <button type="button"
              class="flex items-center gap-2 px-5 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              onClick={props.onLoadMore}
            >
              <Icons.ChevronDown class="w-4 h-4" />
              Load more
            </button>
          </div>
        </Show>
      </Show>
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

export function RepoSearchResults(props: RepoSearchResultsProps) {
  return (
    <div class="p-6">
      <div class="flex flex-wrap items-center gap-3 mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        <h3 class="mr-auto">
          {props.searching ? 'Searching...' : `${props.total ?? props.results?.length ?? 0} results for "${props.query}"`}
        </h3>
        <Show when={props.onSortChange && props.onOrderChange}>
          <div class="flex items-center gap-2">
            <label class="text-xs text-zinc-500">Sort</label>
            <select
              value={props.sort}
              onInput={(e) => props.onSortChange!(e.currentTarget.value as SearchSort)}
              class="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-900 dark:text-zinc-100"
            >
              <option value="stars">Stars</option>
              <option value="updated">Recently updated</option>
              <option value="created">Newest</option>
            </select>
            <select
              value={props.order}
              onInput={(e) => props.onOrderChange!(e.currentTarget.value as SearchOrder)}
              class="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-2 py-1 text-xs text-zinc-900 dark:text-zinc-100"
            >
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </select>
          </div>
        </Show>
      </div>
      <SearchRepoList
        searching={props.searching}
        results={props.results}
        hasMore={props.hasMore}
        onSelectRepo={props.onSelectRepo}
        onStar={props.onStar}
        onLoadMore={props.onLoadMore}
      />
    </div>
  );
}
