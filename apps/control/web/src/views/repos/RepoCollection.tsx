import { Show, For } from 'solid-js';
import { Icons } from '../../lib/Icons.tsx';
import type { SourceRepo } from '../../types/repos.ts';
import { RepoBrowseCard } from './RepoBrowseCard.tsx';

function ReposMainContent(props: {
  selectedSpaceId?: string;
  myRepos: SourceRepo[];
  myReposLoading: boolean;
  myReposError: string | null;
  onSelectRepo: (repo: SourceRepo) => void;
  onStar: (repo: SourceRepo) => void;
  onOpenCreate: () => void;
}) {
  return (
    <>
      <Show when={!props.selectedSpaceId}>
        <div class="flex flex-col items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
          <Icons.Folder class="w-12 h-12 mb-3" />
          <p>Select a space</p>
        </div>
      </Show>
      <Show when={props.selectedSpaceId && props.myReposLoading}>
        <div class="flex justify-center py-12">
          <div class="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
        </div>
      </Show>
      <Show when={props.selectedSpaceId && !props.myReposLoading && props.myReposError}>
        <div class="flex flex-col items-center justify-center h-full text-zinc-700 dark:text-zinc-300">
          <Icons.AlertTriangle class="w-12 h-12 mb-3" />
          <span>{props.myReposError}</span>
        </div>
      </Show>
      <Show when={props.selectedSpaceId && !props.myReposLoading && !props.myReposError && (!props.myRepos || props.myRepos.length === 0)}>
        <div class="flex flex-col items-center justify-center h-full text-zinc-500 dark:text-zinc-400">
          <Icons.GitBranch class="w-12 h-12 mb-3" />
          <p class="mb-4">No repositories yet</p>
          <button type="button"
            class="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 transition-colors"
            onClick={props.onOpenCreate}
          >
            <Icons.Plus class="w-4 h-4" />
            Create Repository
          </button>
        </div>
      </Show>
      <Show when={props.selectedSpaceId && !props.myReposLoading && !props.myReposError && props.myRepos && props.myRepos.length > 0}>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <For each={props.myRepos}>{(repo) => (
            <RepoBrowseCard repo={repo} onSelect={props.onSelectRepo} onStar={props.onStar} />
          )}</For>
        </div>
      </Show>
    </>
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

export function RepoCollection(props: RepoCollectionProps) {
  return (
    <div class="flex-1 overflow-y-auto p-6">
      <ReposMainContent
        selectedSpaceId={props.selectedSpaceId}
        myRepos={props.myRepos}
        myReposLoading={props.myReposLoading}
        myReposError={props.myReposError}
        onSelectRepo={props.onSelectRepo}
        onStar={props.onStar}
        onOpenCreate={props.onOpenCreate}
      />
    </div>
  );
}
