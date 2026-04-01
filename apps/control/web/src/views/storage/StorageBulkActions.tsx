import { Show } from 'solid-js';
import { useI18n } from '../../store/i18n.ts';
import { Icons } from '../../lib/Icons.tsx';

interface StorageBulkActionsProps {
  selectedCount: number;
  onMove: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export function StorageBulkActions(props: StorageBulkActionsProps) {
  const { t } = useI18n();

  return (
    <Show when={props.selectedCount > 0}>
      <div class="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-2xl z-20">
        <span class="text-sm font-medium px-2">
          {t('selectedCount').replace('{count}', String(props.selectedCount))}
        </span>
        <div class="w-px h-5 bg-zinc-700 dark:bg-zinc-300" />
        <button type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
          onClick={props.onMove}
        >
          <Icons.FolderOpen class="w-4 h-4" />
          {t('move') || 'Move'}
        </button>
        <button type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
          onClick={props.onRename}
        >
          <Icons.Edit class="w-4 h-4" />
          {t('rename')}
        </button>
        <button type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-400 dark:text-red-500 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
          onClick={props.onDelete}
        >
          <Icons.Trash class="w-4 h-4" />
          {t('delete')}
        </button>
        <div class="w-px h-5 bg-zinc-700 dark:bg-zinc-300" />
        <button type="button"
          class="p-1.5 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
          onClick={props.onClear}
          title={t('clear')}
        >
          <Icons.X class="w-4 h-4" />
        </button>
      </div>
    </Show>
  );
}
