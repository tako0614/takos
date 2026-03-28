import { useI18n } from '../../../store/i18n';
import { Icons } from '../../../lib/Icons';

interface DangerZoneProps {
  onDeleteWorker: () => void;
}

export function DangerZone({ onDeleteWorker }: DangerZoneProps) {
  const { t } = useI18n();

  return (
    <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 mt-8">
      <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">{t('dangerZone')}</h4>
      <button className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors" onClick={onDeleteWorker}>
        <Icons.Trash className="w-4 h-4" />
        <span>{t('deleteWorker')}</span>
      </button>
    </div>
  );
}
