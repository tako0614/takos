import { useI18n } from '../../../store/i18n';
import { Icons } from '../../../lib/Icons';

interface ResourceSettingsTabProps {
  onDeleteResource: () => void;
}

export function ResourceSettingsTab({ onDeleteResource }: ResourceSettingsTabProps) {
  const { t } = useI18n();

  return (
    <div class="space-y-6" role="region" aria-label={t('settings')}>
      <div class="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
        <h4 class="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-2">{t('dangerZone')}</h4>
        <p class="text-sm text-zinc-500 dark:text-zinc-400 mb-4">{t('deleteResourceWarning')}</p>
        <button
          class="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
          onClick={onDeleteResource}
          aria-label={t('deleteResource')}
        >
          <Icons.Trash class="w-4 h-4" aria-hidden="true" />
          <span>{t('deleteResource')}</span>
        </button>
      </div>
    </div>
  );
}
