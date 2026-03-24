import { useI18n } from '../../../providers/I18nProvider';
import { Icons } from '../../../lib/Icons';

interface ResourceSettingsTabProps {
  onDeleteResource: () => void;
}

export function ResourceSettingsTab({ onDeleteResource }: ResourceSettingsTabProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-6" role="region" aria-label={t('settings')}>
      <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
        <h4 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">{t('dangerZone')}</h4>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">{t('deleteResourceWarning')}</p>
        <button
          className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
          onClick={onDeleteResource}
          aria-label={t('deleteResource')}
        >
          <Icons.Trash className="w-4 h-4" aria-hidden="true" />
          <span>{t('deleteResource')}</span>
        </button>
      </div>
    </div>
  );
}
