import { createSignal } from 'solid-js';
import { Show, For } from 'solid-js';
import { useI18n } from '../../store/i18n';
import { Icons } from '../../lib/Icons';
import type { SessionDiff } from '../../types';

export function SessionDiffPanel(props: {
  sessionDiff: { sessionId: string; sessionStatus?: string; diff?: SessionDiff };
  onMerge: () => void;
  isMerging: boolean;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const [expandedFiles, setExpandedFiles] = createSignal<Set<string>>(new Set());

  const isAlreadyMerged = () => props.sessionDiff.sessionStatus === 'merged';

  const toggleFile = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const getChangeIcon = (type: string) => {
    switch (type) {
      case 'add': return <Icons.Plus />;
      case 'modify': return <Icons.Edit />;
      case 'delete': return <Icons.Trash />;
      default: return <Icons.File />;
    }
  };

  return (
    <Show when={props.sessionDiff.diff}>
      <div class="mx-4 my-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
        <div class="flex items-center justify-between px-4 py-3 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
          <div class="flex items-center gap-2">
            <Icons.GitMerge />
            <span class="font-medium text-zinc-900 dark:text-zinc-100">{t('fileChanges')}</span>
            <span class="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-medium">{props.sessionDiff.diff!.changes.length}</span>
            <Show when={isAlreadyMerged()}>
              <span class="text-xs text-zinc-500 dark:text-zinc-400">{t('alreadyMerged')}</span>
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <Show when={!isAlreadyMerged()}>
              <button
                class="px-3 py-1.5 text-xs font-medium bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg transition-colors disabled:opacity-50"
                onClick={props.onMerge}
                disabled={props.isMerging}
              >
                {props.isMerging ? t('merging') : t('merge')}
              </button>
            </Show>
            <button class="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-500 dark:text-zinc-400" onClick={props.onDismiss}>
              <Icons.X />
            </button>
          </div>
        </div>

        <div class="p-4 space-y-3">
          <For each={props.sessionDiff.diff!.changes}>{(change) => {
            const isExpanded = () => expandedFiles().has(change.path);
            return (
              <div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <button
                  class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                  onClick={() => toggleFile(change.path)}
                >
                  <span class="text-zinc-500 dark:text-zinc-400">{getChangeIcon(change.type)}</span>
                  <span class="flex-1 text-sm text-zinc-900 dark:text-zinc-100 font-mono">{change.path}</span>
                  <span class="text-xs text-zinc-500 dark:text-zinc-400">{change.type}</span>
                  <span class="text-zinc-500 dark:text-zinc-400">{isExpanded() ? '\u2212' : '+'}</span>
                </button>

                <Show when={isExpanded()}>
                  <div class="border-t border-zinc-200 dark:border-zinc-700">
                    <Show when={change.diff}>
                      <pre class="p-3 text-xs text-zinc-700 dark:text-zinc-300 font-mono overflow-x-auto whitespace-pre-wrap">{change.diff}</pre>
                    </Show>
                    <Show when={change.content && !change.diff}>
                      <pre class="p-3 text-xs text-zinc-700 dark:text-zinc-300 font-mono overflow-x-auto whitespace-pre-wrap">{change.content}</pre>
                    </Show>
                  </div>
                </Show>
              </div>
            );
          }}</For>
        </div>
      </div>
    </Show>
  );
}
