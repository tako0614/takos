import { useI18n } from '../../providers/I18nProvider';
import { Icons } from '../../lib/Icons';

interface StorageBulkActionsProps {
  selectedCount: number;
  onMove: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export function StorageBulkActions({
  selectedCount,
  onMove,
  onRename,
  onDelete,
  onClear,
}: StorageBulkActionsProps) {
  const { t } = useI18n();

  if (selectedCount === 0) return null;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 shadow-2xl z-20">
      <span className="text-sm font-medium px-2">
        {t('selectedCount').replace('{count}', String(selectedCount))}
      </span>
      <div className="w-px h-5 bg-zinc-700 dark:bg-zinc-300" />
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
        onClick={onMove}
      >
        <Icons.FolderOpen className="w-4 h-4" />
        {t('move') || 'Move'}
      </button>
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
        onClick={onRename}
      >
        <Icons.Edit className="w-4 h-4" />
        {t('rename')}
      </button>
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-400 dark:text-red-500 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
        onClick={onDelete}
      >
        <Icons.Trash className="w-4 h-4" />
        {t('delete')}
      </button>
      <div className="w-px h-5 bg-zinc-700 dark:bg-zinc-300" />
      <button
        className="p-1.5 rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
        onClick={onClear}
        title={t('clear')}
      >
        <Icons.X className="w-4 h-4" />
      </button>
    </div>
  );
}
