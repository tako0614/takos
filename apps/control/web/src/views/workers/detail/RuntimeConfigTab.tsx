import { useI18n } from '../../../store/i18n';
import type { RuntimeConfig } from '../worker-models';

interface RuntimeConfigTabProps {
  runtimeConfig: RuntimeConfig;
  onRuntimeConfigChange: (config: RuntimeConfig) => void;
  onSaveRuntimeConfig: () => void;
  savingWorkerSettings: boolean;
}

export function RuntimeConfigTab({
  runtimeConfig,
  onRuntimeConfigChange,
  onSaveRuntimeConfig,
  savingWorkerSettings,
}: RuntimeConfigTabProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('compatibilityDate')}</label>
        <input
          type="date"
          className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50"
          value={runtimeConfig.compatibility_date || ''}
          onChange={(e) => onRuntimeConfigChange({ ...runtimeConfig, compatibility_date: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('compatibilityFlags')}</label>
        <input
          type="text"
          className="w-full px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50"
          value={(runtimeConfig.compatibility_flags || []).join(', ')}
          onChange={(e) => onRuntimeConfigChange({
            ...runtimeConfig,
            compatibility_flags: e.target.value.split(',').map(f => f.trim()).filter(Boolean),
          })}
          placeholder="nodejs_compat, url_standard"
        />
        <span className="text-xs text-zinc-500">{t('compatibilityFlagsHint')}</span>
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('cpuLimit')}</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="w-32 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50"
            value={runtimeConfig.cpu_ms || ''}
            onChange={(e) => onRuntimeConfigChange({ ...runtimeConfig, cpu_ms: parseInt(e.target.value, 10) || undefined })}
            placeholder="50"
            min="10"
            max="30000"
          />
          <span className="text-xs text-zinc-500">ms</span>
        </div>
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('subrequestsLimit')}</label>
        <input
          type="number"
          className="w-32 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50"
          value={runtimeConfig.subrequests || ''}
          onChange={(e) => onRuntimeConfigChange({ ...runtimeConfig, subrequests: parseInt(e.target.value, 10) || undefined })}
          placeholder="50"
          min="1"
          max="1000"
        />
        <span className="text-xs text-zinc-500">{t('subrequestsHint')}</span>
      </div>
      <button
        className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        onClick={onSaveRuntimeConfig}
        disabled={savingWorkerSettings}
      >
        {savingWorkerSettings ? t('saving') : t('saveRuntime')}
      </button>
    </div>
  );
}
