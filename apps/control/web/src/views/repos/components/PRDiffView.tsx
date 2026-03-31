import { Show, For } from 'solid-js';
import type { FileDiff } from '../../../types/index.ts';
import { Icons } from '../../../lib/Icons.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { useI18n } from '../../../store/i18n.ts';

interface PRDiffViewProps {
  diffs: FileDiff[];
  expandedFiles: Set<string>;
  onToggleFile: (path: string) => void;
}

function getFileStatusIcon(status: FileDiff['status']) {
  switch (status) {
    case 'added':
      return <span class="text-xs font-bold text-zinc-900 dark:text-zinc-100">A</span>;
    case 'modified':
      return <span class="text-xs font-bold text-zinc-600 dark:text-zinc-400">M</span>;
    case 'deleted':
      return <span class="text-xs font-bold text-zinc-400 dark:text-zinc-500">D</span>;
    case 'renamed':
      return <span class="text-xs font-bold text-zinc-500 dark:text-zinc-400">R</span>;
  }
}

export function PRDiffView(props: PRDiffViewProps) {
  const { t } = useI18n();

  const totalChanges = () => props.diffs.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 }
  );

  return (
    <div class="max-w-6xl mx-auto">
      <div class="flex items-center gap-4 mb-4 text-sm text-zinc-500">
        <span>{t('prFilesChanged', { count: props.diffs.length })}</span>
        <span class="text-zinc-900 dark:text-zinc-100 font-medium">{t('additionsLabel', { count: totalChanges().additions })}</span>
        <span class="text-zinc-500 dark:text-zinc-400 font-medium">{t('deletionsLabel', { count: totalChanges().deletions })}</span>
      </div>

      <div class="space-y-2">
        <For each={props.diffs}>{(file) => (
          <Card padding="none" class="overflow-hidden">
            <div
              class="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              onClick={() => props.onToggleFile(file.path)}
            >
              <div class="flex items-center gap-3">
                <Show when={props.expandedFiles.has(file.path)} fallback={
                  <Icons.ChevronRight class="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                }>
                  <Icons.ChevronDown class="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
                </Show>
                {getFileStatusIcon(file.status)}
                <span class="text-sm text-zinc-900 dark:text-zinc-100 font-mono">
                  <Show when={file.old_path && file.old_path !== file.path}>
                    <span class="text-zinc-400 dark:text-zinc-500 line-through">{file.old_path}</span>
                    <Icons.ChevronRight class="w-4 h-4 inline mx-1 text-zinc-400 dark:text-zinc-500" />
                  </Show>
                  {file.path}
                </span>
              </div>
              <div class="flex items-center gap-3 text-xs">
                <span class="text-zinc-900 dark:text-zinc-100 font-medium">+{file.additions}</span>
                <span class="text-zinc-500 dark:text-zinc-400 font-medium">-{file.deletions}</span>
              </div>
            </div>

            <Show when={props.expandedFiles.has(file.path)}>
              <div class="bg-zinc-50 dark:bg-zinc-900 overflow-x-auto border-t" style={{ "border-color": 'var(--color-border-primary)' }}>
                <For each={file.hunks}>{(hunk) => (
                  <div>
                    <div class="px-4 py-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 text-xs font-mono border-b" style={{ "border-color": 'var(--color-border-primary)' }}>
                      @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},{hunk.new_lines} @@
                    </div>
                    <div class="font-mono text-xs">
                      <For each={hunk.lines}>{(line) => (
                        <div
                          class={`flex ${
                            line.type === 'addition'
                              ? 'bg-zinc-100 dark:bg-zinc-800'
                              : line.type === 'deletion'
                              ? 'bg-zinc-50 dark:bg-zinc-850'
                              : ''
                          }`}
                        >
                          <span class="w-12 px-2 text-right text-zinc-400 select-none border-r" style={{ "border-color": 'var(--color-border-primary)' }}>
                            {line.old_line || ''}
                          </span>
                          <span class="w-12 px-2 text-right text-zinc-400 select-none border-r" style={{ "border-color": 'var(--color-border-primary)' }}>
                            {line.new_line || ''}
                          </span>
                          <span class={`w-4 text-center select-none ${
                            line.type === 'addition'
                              ? 'text-zinc-900 dark:text-zinc-100 font-bold'
                              : line.type === 'deletion'
                              ? 'text-zinc-400 dark:text-zinc-500 font-bold'
                              : 'text-zinc-400 dark:text-zinc-500'
                          }`}>
                            {line.type === 'addition' ? '+' : line.type === 'deletion' ? '-' : ' '}
                          </span>
                          <span class={`flex-1 px-2 whitespace-pre ${
                            line.type === 'addition'
                              ? 'text-zinc-900 dark:text-zinc-100'
                              : line.type === 'deletion'
                              ? 'text-zinc-500 dark:text-zinc-400'
                              : 'text-zinc-700 dark:text-zinc-300'
                          }`}>{line.content}</span>
                        </div>
                      )}</For>
                    </div>
                  </div>
                )}</For>
              </div>
            </Show>
          </Card>
        )}</For>
      </div>
    </div>
  );
}
