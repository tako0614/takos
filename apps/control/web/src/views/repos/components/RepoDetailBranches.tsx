import { createSignal, createEffect, onCleanup, Show, For } from 'solid-js';
import type { Branch } from '../../../types/index.ts';
import { Icons } from '../../../lib/Icons.tsx';
import { useI18n } from '../../../store/i18n.ts';

interface RepoDetailBranchesProps {
  branches: Branch[];
  currentBranch: string;
  onBranchChange: (branch: string) => void;
}

export function RepoDetailBranches(props: RepoDetailBranchesProps) {
  const { t } = useI18n();
  const [branchDropdownOpen, setBranchDropdownOpen] = createSignal(false);
  let branchDropdownRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!branchDropdownOpen()) return;

    function handleClickOutside(event: MouseEvent): void {
      if (branchDropdownRef && !branchDropdownRef.contains(event.target as Node)) {
        setBranchDropdownOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    onCleanup(() => {
      document.removeEventListener('mousedown', handleClickOutside);
    });
  });

  return (
    <div class="flex items-center gap-3">
      <div class="relative" ref={branchDropdownRef}>
        <button
          class="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-zinc-300 dark:border-zinc-600 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={() => setBranchDropdownOpen(!branchDropdownOpen())}
        >
          <Icons.GitMerge class="w-4 h-4" />
          <span class="font-medium">{props.currentBranch}</span>
          <Icons.ChevronDown class="w-4 h-4" />
        </button>
        <Show when={branchDropdownOpen()}>
          <div class="absolute left-0 top-full mt-1 w-72 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg z-20">
            <div class="px-3 py-2 border-b border-zinc-200 dark:border-zinc-700">
              <span class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{t('switchBranches')}</span>
            </div>
            <div class="max-h-64 overflow-y-auto">
              <For each={props.branches}>{(branch) => (
                <button
                  class={`flex items-center justify-between w-full px-3 py-2 text-sm text-left transition-colors ${
                    branch.name === props.currentBranch
                      ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                      : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                  }`}
                  onClick={() => {
                    props.onBranchChange(branch.name);
                    setBranchDropdownOpen(false);
                  }}
                >
                  <div class="flex items-center gap-2">
                    <Show when={branch.name === props.currentBranch}>
                      <Icons.Check class="w-4 h-4" />
                    </Show>
                    <span>{branch.name}</span>
                  </div>
                  <Show when={branch.is_default}>
                    <span class="px-1.5 py-0.5 text-xs rounded bg-zinc-200 dark:bg-zinc-600 text-zinc-600 dark:text-zinc-400">{t('default')}</span>
                  </Show>
                </button>
              )}</For>
            </div>
          </div>
        </Show>
      </div>

      <span class="text-sm text-zinc-500 dark:text-zinc-400">
        {t('branchCount', { count: props.branches.length })}
      </span>
    </div>
  );
}
