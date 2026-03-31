import { Show, For } from 'solid-js';
import type { Repository, Branch } from '../../../types';
import { Icons } from '../../../lib/Icons';
import { UpstreamSyncWidget } from './UpstreamSyncWidget';
import { useI18n } from '../../../store/i18n';

interface RepoDetailSidebarProps {
  repo: Repository;
  safeHomepage: string | null;
  starsCount: number;
  forksCount: number;
  branches: Branch[];
  isAuthenticated: boolean;
  onSyncComplete: () => void;
}

export function RepoDetailSidebar(props: RepoDetailSidebarProps) {
  const { t } = useI18n();

  return (
    <div class="w-80 flex-shrink-0 space-y-4">
      <div class="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <div class="px-4 py-3 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
          <span class="font-medium text-zinc-900 dark:text-zinc-100">{t('about')}</span>
        </div>
        <div class="p-4 bg-white dark:bg-zinc-900 space-y-4">
          <Show when={props.repo.description} fallback={
            <p class="text-sm text-zinc-500 dark:text-zinc-400 italic">{t('noDescriptionProvided')}</p>
          }>
            <p class="text-sm text-zinc-700 dark:text-zinc-300">{props.repo.description}</p>
          </Show>

          <Show when={props.safeHomepage}>
            <a
              href={props.safeHomepage!}
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              <Icons.Link class="w-4 h-4" />
              <span class="truncate">{props.safeHomepage}</span>
            </a>
          </Show>

          <Show when={props.repo.topics && props.repo.topics.length > 0}>
            <div class="flex flex-wrap gap-2">
              <For each={props.repo.topics}>{(topic) => (
                <span
                  class="px-2.5 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full"
                >
                  {topic}
                </span>
              )}</For>
            </div>
          </Show>
        </div>
      </div>

      <Show when={props.repo.forked_from_id && props.isAuthenticated}>
        <UpstreamSyncWidget
          repoId={props.repo.id}
          onSyncComplete={props.onSyncComplete}
        />
      </Show>

      <div class="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-white dark:bg-zinc-900">
        <div class="grid grid-cols-2 divide-x divide-zinc-200 dark:divide-zinc-700">
          <div class="p-4 text-center">
            <div class="flex items-center justify-center gap-1.5 text-zinc-500 dark:text-zinc-400 mb-1">
              <Icons.Sparkles class="w-4 h-4" />
              <span class="text-xs">{t('starsLabel')}</span>
            </div>
            <span class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{props.starsCount}</span>
          </div>
          <div class="p-4 text-center">
            <div class="flex items-center justify-center gap-1.5 text-zinc-500 dark:text-zinc-400 mb-1">
              <Icons.GitMerge class="w-4 h-4" />
              <span class="text-xs">{t('forksLabel')}</span>
            </div>
            <span class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{props.forksCount}</span>
          </div>
        </div>
        <div class="grid grid-cols-2 divide-x divide-zinc-200 dark:divide-zinc-700 border-t border-zinc-200 dark:border-zinc-700">
          <div class="p-4 text-center">
            <div class="flex items-center justify-center gap-1.5 text-zinc-500 dark:text-zinc-400 mb-1">
              <Icons.Eye class="w-4 h-4" />
              <span class="text-xs">{t('watchersLabel')}</span>
            </div>
            <span class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{props.repo.watchers_count || 0}</span>
          </div>
          <div class="p-4 text-center">
            <div class="flex items-center justify-center gap-1.5 text-zinc-500 dark:text-zinc-400 mb-1">
              <Icons.GitMerge class="w-4 h-4" />
              <span class="text-xs">{t('branchesLabel')}</span>
            </div>
            <span class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{props.branches.length}</span>
          </div>
        </div>
      </div>

      <Show when={props.repo.language}>
        <div class="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-white dark:bg-zinc-900 p-4">
          <div class="flex items-center gap-2 mb-3">
            <span class="font-medium text-zinc-900 dark:text-zinc-100 text-sm">{t('languages')}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="w-3 h-3 rounded-full bg-blue-500"></span>
            <span class="text-sm text-zinc-700 dark:text-zinc-300">{props.repo.language}</span>
          </div>
        </div>
      </Show>
    </div>
  );
}
