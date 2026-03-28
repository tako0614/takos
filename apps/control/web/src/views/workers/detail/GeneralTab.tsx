import { useI18n } from '../../../store/i18n';
import { Icons } from '../../../lib/Icons';
import type { Worker } from '../../../types';
import {
  getWorkerDisplayHostname,
  getWorkerStatusIndicatorClass,
  getWorkerUrl,
} from '../utils/workerUtils';

interface GeneralTabProps {
  worker: Worker;
  editSlug: string;
  onEditSlugChange: (value: string) => void;
  onSaveSlug: () => void;
  savingSlug: boolean;
}

export function GeneralTab({
  worker,
  editSlug,
  onEditSlugChange,
  onSaveSlug,
  savingSlug,
}: GeneralTabProps) {
  const { t } = useI18n();
  const platformDomain = worker.hostname?.includes('.') ? worker.hostname.split('.').slice(1).join('.') : '';
  const workerHostname = getWorkerDisplayHostname(worker);
  const workerUrl = getWorkerUrl(worker);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('subdomain')}</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-900/50 dark:focus:ring-zinc-100/50"
            value={editSlug}
            onChange={(e) => onEditSlugChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            placeholder="my-app"
          />
          {platformDomain && (
            <span className="text-sm text-zinc-500 dark:text-zinc-400">.{platformDomain}</span>
          )}
        </div>
        <button
          className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-zinc-100 hover:bg-zinc-700 dark:hover:bg-zinc-300 text-white dark:text-zinc-900 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          onClick={onSaveSlug}
          disabled={savingSlug || !editSlug.trim() || editSlug === (worker.slug ?? '')}
        >
          {savingSlug ? t('saving') : t('saveSubdomain')}
        </button>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('currentUrl')}</label>
        <div className="flex items-center gap-2">
          {workerUrl ? (
            <a
              href={workerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-900 dark:text-zinc-100 hover:underline flex items-center gap-1"
            >
              <Icons.Globe className="w-4 h-4" />
              <span>{workerUrl}</span>
              <Icons.ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span className="text-zinc-500 dark:text-zinc-400">{workerHostname}</span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('status')}</label>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${getWorkerStatusIndicatorClass(worker.status)}`} />
          <span className="text-sm text-zinc-900 dark:text-zinc-100">{worker.status}</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{t('workerId')}</label>
        <div className="flex items-center gap-2">
          <code className="px-2 py-1 bg-zinc-100 dark:bg-zinc-800 rounded text-xs text-zinc-500 dark:text-zinc-400 font-mono">{worker.id}</code>
        </div>
      </div>
    </div>
  );
}
